"""Regis core service: catalogue, accounts, orders, admin, and the web app itself."""
import logging
import re
import secrets
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, PlainTextResponse, Response
from starlette.middleware.gzip import GZipMiddleware

import clients
import config
import db
import pages
import security as sec
from routes_admin import router as admin_router, sweep_uploads
from routes_public import router as public_router

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("regis")

if config.SENTRY_DSN:
    try:
        import sentry_sdk
        sentry_sdk.init(dsn=config.SENTRY_DSN, environment=config.APP_ENV, traces_sample_rate=0.0, send_default_pii=False)
    except ImportError:
        log.warning("SENTRY_DSN is set but sentry-sdk is not installed. Run: pip install sentry-sdk")


def bootstrap_admin() -> None:
    c = db.conn()
    if c.execute("SELECT 1 FROM users WHERE role='admin'").fetchone():
        return
    if not (config.ADMIN_EMAIL and config.ADMIN_PASSWORD):
        log.warning("No admin account exists. Set ADMIN_EMAIL and ADMIN_PASSWORD in .env and restart.")
        return
    if len(config.ADMIN_PASSWORD) < 12:
        raise SystemExit("ADMIN_PASSWORD must be at least 12 characters.")
    c.execute("INSERT INTO users (email,name,phone,pw_hash,role,created_at) VALUES (?,?,?,?, 'admin', ?)",
              (config.ADMIN_EMAIL, "Regis Admin", "", sec.hash_password(config.ADMIN_PASSWORD), db.now()))
    log.info("Admin account created for %s", config.ADMIN_EMAIL)


@asynccontextmanager
async def lifespan(_: FastAPI):
    db.init()
    bootstrap_admin()
    config.UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    sweep_uploads()
    yield


app = FastAPI(title="Regis", docs_url=None if config.IS_PROD else "/api/docs", redoc_url=None,
              openapi_url=None if config.IS_PROD else "/api/openapi.json", lifespan=lifespan)
app.add_middleware(GZipMiddleware, minimum_size=800)


def csp() -> str:
    script = "'self'"
    connect = "'self'"
    if config.PLAUSIBLE_DOMAIN:
        script += " https://plausible.io"
        connect += " https://plausible.io"
    return (f"default-src 'self'; script-src {script}; style-src 'self'; img-src 'self' data: blob:; "
            f"font-src 'self'; connect-src {connect}; frame-ancestors 'none'; form-action 'self'; base-uri 'self'; object-src 'none'")


@app.middleware("http")
async def guard(request: Request, call_next):
    path = request.url.path
    if not sec.origin_ok(request):
        return JSONResponse({"detail": "Request blocked for your safety. Please reload the page."}, status_code=403)
    limit = 3_500_000 if path == "/api/admin/uploads" else 100_000
    if int(request.headers.get("content-length") or 0) > limit:
        return JSONResponse({"detail": "That request is too large."}, status_code=413)
    try:
        response: Response = await call_next(request)
    except Exception:  # last line of defence, never leak a stack trace
        log.exception("Unhandled error on %s", path)
        response = JSONResponse({"detail": "Something went wrong on our side. Please try again."}, status_code=500)
    h = response.headers
    h["Content-Security-Policy"] = csp()
    h["X-Content-Type-Options"] = "nosniff"
    h["X-Frame-Options"] = "DENY"
    h["Referrer-Policy"] = "strict-origin-when-cross-origin"
    h["Permissions-Policy"] = "camera=(), microphone=(), geolocation=(), payment=()"
    h["Cross-Origin-Opener-Policy"] = "same-origin"
    if config.IS_PROD:
        h["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    if path.startswith("/api/"):
        h["Cache-Control"] = "no-store"
    return response


@app.exception_handler(RequestValidationError)
async def validation_handler(_: Request, exc: RequestValidationError):
    fields = {}
    for err in exc.errors():
        loc = [str(p) for p in err["loc"] if p not in ("body", "query")]
        msg = err["msg"].removeprefix("Value error, ")
        fields[".".join(loc[-2:]) if loc else "form"] = msg
    first = next(iter(fields.values()), "Please check the details you entered.")
    return JSONResponse({"detail": first, "fields": fields}, status_code=422)


app.include_router(public_router)
app.include_router(admin_router)


@app.get("/healthz")
def healthz():
    try:
        db.conn().execute("SELECT 1").fetchone()
        ok_db = True
    except Exception:
        ok_db = False
    services = clients.health()
    ok = ok_db and all(services.values())
    return JSONResponse({"ok": ok, "db": ok_db, **services}, status_code=200 if ok else 503)


@app.get("/robots.txt")
def robots():
    return PlainTextResponse(pages.robots())


@app.get("/sitemap.xml")
def sitemap():
    return Response(pages.sitemap(), media_type="application/xml")


UPLOAD_RE = re.compile(r"^[a-f0-9]{32}\.(jpg|png|webp)$")
MIME = {"jpg": "image/jpeg", "png": "image/png", "webp": "image/webp"}


@app.get("/uploads/{name}")
def uploads(name: str):
    if not UPLOAD_RE.match(name):
        raise HTTPException(404, "Not found.")
    f = config.UPLOAD_DIR / name
    if not f.is_file():
        raise HTTPException(404, "Not found.")
    return FileResponse(f, media_type=MIME[name.rsplit(".", 1)[1]], headers={"Cache-Control": "public, max-age=31536000, immutable"})


@app.get("/{full_path:path}")
def spa(full_path: str, request: Request):
    if full_path.startswith("api/"):
        raise HTTPException(404, "Not found.")
    dist = config.WEB_DIST.resolve()
    target = (dist / full_path).resolve()
    if full_path and target.is_file() and dist in target.parents:
        cache = "public, max-age=31536000, immutable" if full_path.startswith("assets/") else "public, max-age=3600"
        return FileResponse(target, headers={"Cache-Control": cache})
    body, status = pages.render("/" + full_path)
    return HTMLResponse(body, status_code=status, headers={"Cache-Control": "no-cache"})
