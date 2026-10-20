"""Authentication, authorisation, CSRF and rate limiting. Every check happens on the server."""
import hashlib
import hmac
import secrets
import threading
import time
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import Depends, HTTPException, Request, Response

import config
import db

COOKIE = "regis_session"


# ---------- passwords (scrypt, standard library) ----------
def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1, dklen=32)
    return f"scrypt${salt.hex()}${dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        scheme, salt_hex, dk_hex = stored.split("$")
        if scheme != "scrypt":
            return False
        dk = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt_hex), n=2**14, r=8, p=1, dklen=32)
        return hmac.compare_digest(dk.hex(), dk_hex)
    except Exception:
        return False


# A real hash to burn the same CPU time when the email does not exist (prevents user enumeration by timing).
_DUMMY = hash_password("not-a-real-password")


def burn_time(password: str) -> None:
    verify_password(password, _DUMMY)


# ---------- sessions ----------
def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def create_session(response: Response, user_id: int, role: str) -> None:
    token = secrets.token_urlsafe(32)
    ttl = timedelta(hours=config.ADMIN_SESSION_HOURS) if role == "admin" else timedelta(days=config.SESSION_DAYS)
    exp = datetime.now(timezone.utc) + ttl
    c = db.conn()
    c.execute(
        "INSERT INTO sessions (token_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)",
        (_hash_token(token), user_id, exp.strftime("%Y-%m-%dT%H:%M:%SZ"), db.now()),
    )
    c.execute("DELETE FROM sessions WHERE expires_at < ?", (db.now(),))
    response.set_cookie(
        COOKIE, token, max_age=int(ttl.total_seconds()), httponly=True,
        secure=config.COOKIE_SECURE, samesite="lax", path="/",
    )


def destroy_session(request: Request, response: Response) -> None:
    token = request.cookies.get(COOKIE)
    if token:
        db.conn().execute("DELETE FROM sessions WHERE token_hash=?", (_hash_token(token),))
    response.delete_cookie(COOKIE, path="/")


def current_user(request: Request) -> Optional[dict]:
    token = request.cookies.get(COOKIE)
    if not token:
        return None
    row = db.conn().execute(
        """SELECT u.id,u.email,u.name,u.phone,u.role,s.expires_at FROM sessions s
           JOIN users u ON u.id=s.user_id WHERE s.token_hash=?""",
        (_hash_token(token),),
    ).fetchone()
    if not row or row["expires_at"] < db.now():
        return None
    return dict(row)


def require_user(user: Optional[dict] = Depends(current_user)) -> dict:
    if not user:
        raise HTTPException(401, "Please sign in to continue.")
    return user


def require_admin(user: Optional[dict] = Depends(current_user)) -> dict:
    if not user:
        raise HTTPException(401, "Please sign in to continue.")
    if user["role"] != "admin":
        raise HTTPException(403, "You do not have access to this area.")
    return user


# ---------- CSRF: same-origin check on every state-changing request ----------
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


def origin_ok(request: Request) -> bool:
    if request.method in SAFE_METHODS:
        return True
    # Server-to-server calls from Paystack are authenticated by signature instead.
    if request.url.path == "/api/paystack/webhook":
        return True
    origin = request.headers.get("origin") or ""
    if not origin:
        referer = request.headers.get("referer") or ""
        origin = "/".join(referer.split("/")[:3]) if referer else ""
    host = request.headers.get("host", "")
    allowed = {config.SITE_URL, f"http://{host}", f"https://{host}"}
    if not origin or origin.rstrip("/") not in allowed:
        return False
    return request.headers.get("x-requested-with") == "regis"


# ---------- rate limiting (in memory, per client key) ----------
class RateLimiter:
    def __init__(self) -> None:
        self.hits: dict = defaultdict(deque)
        self.lock = threading.Lock()

    def check(self, key: str, limit: int, window: int) -> None:
        now = time.monotonic()
        with self.lock:
            q = self.hits[key]
            while q and now - q[0] > window:
                q.popleft()
            if len(q) >= limit:
                raise HTTPException(429, "Too many attempts. Please wait a moment and try again.")
            q.append(now)
            if len(self.hits) > 20000:
                for k in [k for k, v in self.hits.items() if not v][:5000]:
                    self.hits.pop(k, None)


limiter = RateLimiter()


def client_ip(request: Request) -> str:
    # Behind a trusted reverse proxy, the proxy sets X-Forwarded-For. Only trust it in production.
    if config.IS_PROD:
        fwd = request.headers.get("x-forwarded-for", "")
        if fwd:
            return fwd.split(",")[-1].strip()
    return request.client.host if request.client else "unknown"


def rate_limit(name: str, limit: int, window: int):
    def dep(request: Request) -> None:
        limiter.check(f"{name}:{client_ip(request)}", limit, window)
    return dep
