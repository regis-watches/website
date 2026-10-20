"""Business-owner API. Every route depends on require_admin, so permission is checked on the server."""
import json
import re
import secrets

from fastapi import APIRouter, Depends, HTTPException, Request, Response

import clients
import config
import db
import orders
import security as sec
import variants
from routes_public import watch_out
from schemas import CampaignIn, ColorIn, LoginIn, StatusIn, WatchIn

router = APIRouter(prefix="/api/admin")
MAX_UPLOAD = 3 * 1024 * 1024


@router.post("/login", dependencies=[Depends(sec.rate_limit("admin-login", 6, 300))])
def admin_login(body: LoginIn, response: Response):
    sec.limiter.check(f"admin-email:{body.email}", 8, 900)
    row = db.conn().execute("SELECT * FROM users WHERE email=? AND role='admin'", (body.email,)).fetchone()
    if not row or not sec.verify_password(body.password, row["pw_hash"]):
        if not row:
            sec.burn_time(body.password)
        raise HTTPException(401, "Those details are not right.")
    sec.create_session(response, row["id"], "admin")
    return {"user": {"id": row["id"], "email": row["email"], "name": row["name"], "role": "admin"}}


@router.get("/me")
def admin_me(user=Depends(sec.require_admin)):
    return {"user": {k: user[k] for k in ("id", "email", "name", "role")}}


# ---------- catalogue ----------
def slugify(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return s[:60] or "watch"


def unique_slug(base: str, exclude_id: int = 0) -> str:
    slug, n = base, 2
    while db.conn().execute("SELECT 1 FROM watches WHERE slug=? AND id!=?", (slug, exclude_id)).fetchone():
        slug = f"{base}-{n}"
        n += 1
    return slug


def admin_watches(rows) -> list:
    """Owner view of watches: everything the shop shows, plus the raw fields and photo file names to edit."""
    by_watch = variants.colors_for(db.conn(), [r["id"] for r in rows])
    out = []
    for r in rows:
        cols = by_watch[r["id"]]
        d = watch_out(r, cols)
        for shown, col in zip(d["colors"], cols):
            shown["image_names"] = col["images"]
        d.update({"active": bool(r["active"]), "price_naira": r["price_kobo"] // 100,
                  "raw": {k: r[k] for k in ("movement", "case_mm", "case_material", "strap", "water_resistance", "crystal",
                                            "power_reserve", "warranty")}})
        out.append(d)
    return out


@router.get("/watches")
def admin_list(_=Depends(sec.require_admin)):
    rows = db.conn().execute("SELECT * FROM watches ORDER BY id DESC").fetchall()
    return {"watches": admin_watches(rows)}


COLS = ("name", "collection", "tagline", "description", "movement", "case_mm", "case_material", "strap",
        "water_resistance", "crystal", "power_reserve", "warranty")


def check_images(names: list) -> None:
    for n in names:
        if not (config.UPLOAD_DIR / n).is_file():
            raise HTTPException(422, "One of the photos is missing. Please upload it again.")


def purge_unused(candidates: set) -> None:
    """Delete photo files that no watch uses any more."""
    if not candidates:
        return
    in_use = variants.all_image_names(db.conn())
    for n in candidates - in_use:
        if re.fullmatch(r"[a-f0-9]{32}\.(jpg|png|webp)", n):
            (config.UPLOAD_DIR / n).unlink(missing_ok=True)


def sweep_uploads(max_age_hours: int = 24) -> None:
    """Remove uploads that were never attached to a watch (an admin who uploaded, then closed the form)."""
    if not config.UPLOAD_DIR.exists():
        return
    in_use = variants.all_image_names(db.conn())
    import time
    cutoff = time.time() - max_age_hours * 3600
    for f in config.UPLOAD_DIR.iterdir():
        if f.is_file() and f.name not in in_use and f.stat().st_mtime < cutoff:
            f.unlink(missing_ok=True)


def write_colors(c, wid: int, colors: list[ColorIn]) -> None:
    """Make the watch's colour rows match the list the owner sent: update the ones that exist, add the new ones,
    and remove the ones left out. Runs inside the caller's transaction."""
    have = {r["id"] for r in c.execute("SELECT id FROM watch_colors WHERE watch_id=?", (wid,))}
    sent = {col.id for col in colors if col.id is not None}
    if not sent <= have:
        raise HTTPException(422, "One of the colours was changed by someone else. Reload the page and try again.")
    for pos, col in enumerate(colors):
        if col.id is None:
            c.execute("INSERT INTO watch_colors (watch_id,name,hex,stock,images,position) VALUES (?,?,?,?,?,?)",
                      (wid, col.name, col.hex, col.stock, json.dumps(col.images), pos))
        else:
            c.execute("UPDATE watch_colors SET name=?,hex=?,stock=?,images=?,position=? WHERE id=? AND watch_id=?",
                      (col.name, col.hex, col.stock, json.dumps(col.images), pos, col.id, wid))
    for gone in have - sent:
        c.execute("DELETE FROM watch_colors WHERE id=?", (gone,))


def used_by_colors(c, wid: int) -> set:
    names: set = set()
    for r in c.execute("SELECT images FROM watch_colors WHERE watch_id=?", (wid,)):
        names.update(variants.parse_images(r["images"]))
    return names


@router.post("/watches", status_code=201)
def admin_create(body: WatchIn, _=Depends(sec.require_admin)):
    check_images([n for col in body.colors for n in col.images])
    data = body.model_dump()
    t = db.now()
    slug = unique_slug(slugify(body.name))
    cols = ",".join(COLS)
    marks = ",".join("?" for _ in COLS)
    with db.tx() as c:
        cur = c.execute(
            f"INSERT INTO watches (slug,price_kobo,stock,featured,active,images,created_at,updated_at,{cols}) VALUES (?,?,0,?,?,'[]',?,?,{marks})",
            (slug, body.price_naira * 100, int(body.featured), int(body.active), t, t, *[data[k] for k in COLS]))
        wid = cur.lastrowid
        write_colors(c, wid, body.colors)
        variants.sync_watch(c, wid)
    r = db.conn().execute("SELECT * FROM watches WHERE id=?", (wid,)).fetchone()
    return {"watch": admin_watches([r])[0]}


@router.put("/watches/{wid}")
def admin_update(wid: int, body: WatchIn, _=Depends(sec.require_admin)):
    old = db.conn().execute("SELECT * FROM watches WHERE id=?", (wid,)).fetchone()
    if not old:
        raise HTTPException(404, "Watch not found.")
    check_images([n for col in body.colors for n in col.images])
    data = body.model_dump()
    sets = ",".join(f"{k}=?" for k in COLS)
    slug = old["slug"] if old["name"] == body.name else unique_slug(slugify(body.name), wid)
    with db.tx() as c:
        before = used_by_colors(c, wid)
        c.execute(
            f"UPDATE watches SET slug=?,price_kobo=?,featured=?,active=?,updated_at=?,{sets} WHERE id=?",
            (slug, body.price_naira * 100, int(body.featured), int(body.active), db.now(), *[data[k] for k in COLS], wid))
        write_colors(c, wid, body.colors)
        variants.sync_watch(c, wid, db.now())
        after = used_by_colors(c, wid)
    purge_unused(before - after)
    r = db.conn().execute("SELECT * FROM watches WHERE id=?", (wid,)).fetchone()
    return {"watch": admin_watches([r])[0]}


@router.delete("/watches/{wid}")
def admin_delete(wid: int, _=Depends(sec.require_admin)):
    # Past orders keep the watch name, colour and price (snapshotted), so deleting is safe.
    if not db.conn().execute("SELECT 1 FROM watches WHERE id=?", (wid,)).fetchone():
        raise HTTPException(404, "Watch not found.")
    with db.tx() as c:
        photos = used_by_colors(c, wid)
        c.execute("DELETE FROM watches WHERE id=?", (wid,))  # its colours go with it
    purge_unused(photos)
    return {"ok": True}


def sniff_image(head: bytes):
    if head.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "webp"
    return None


@router.post("/uploads", status_code=201)
async def admin_upload(request: Request, _=Depends(sec.require_admin)):
    size = int(request.headers.get("content-length") or 0)
    if size > MAX_UPLOAD:
        raise HTTPException(413, "Images must be under 3 MB.")
    buf = bytearray()
    async for chunk in request.stream():
        buf.extend(chunk)
        if len(buf) > MAX_UPLOAD:
            raise HTTPException(413, "Images must be under 3 MB.")
    ext = sniff_image(bytes(buf[:16]))
    if not ext:
        raise HTTPException(415, "Upload a JPG, PNG or WebP image.")
    name = f"{secrets.token_hex(16)}.{ext}"
    config.UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    (config.UPLOAD_DIR / name).write_bytes(bytes(buf))
    return {"image": name, "url": f"/uploads/{name}"}


# ---------- orders ----------
@router.get("/orders")
def admin_orders(status: str = "", _=Depends(sec.require_admin)):
    if status and status not in orders.STATUS_LABEL:
        raise HTTPException(422, "Unknown status.")
    sql = "SELECT ref FROM orders WHERE status!='pending_payment'"
    args = []
    if status:
        sql += " AND status=?"
        args.append(status)
    refs = db.conn().execute(sql + " ORDER BY id DESC LIMIT 200", args).fetchall()
    out = []
    for r in refs:
        o = orders.get_order(r["ref"])
        out.append({**orders.public_view(o), "name": o["name"], "email": o["email"], "phone": o["phone"],
                    "address": o["address"], "notes": o["notes"], "fee_kobo": o["fee_kobo"], "net_kobo": o["net_kobo"],
                    "allowed": sorted(orders.TRANSITIONS[o["status"]])})
    return {"orders": out}


@router.patch("/orders/{ref}/status")
def admin_set_status(ref: str, body: StatusIn, _=Depends(sec.require_admin)):
    o = orders.set_status(ref.upper(), body.status)
    return {"order": orders.public_view(o)}


# ---------- reports ----------
def _clean_field(s: str) -> str:
    return re.sub(r"[\t\r\n]+", " ", s)


@router.get("/stats")
def admin_stats(_=Depends(sec.require_admin)):
    c = db.conn()
    rows = c.execute("""SELECT id,ref,paid_at,total_kobo,COALESCE(fee_kobo,0) AS fee,COALESCE(net_kobo,total_kobo) AS net
                        FROM orders WHERE paid_at IS NOT NULL AND status!='cancelled' ORDER BY paid_at""").fetchall()
    lines = []
    for o in rows:
        lines.append(f"O\t{o['ref']}\t{o['paid_at']}\t{o['total_kobo']}\t{o['fee']}\t{o['net']}")
        for it in c.execute("SELECT name,qty,unit_price_kobo FROM order_items WHERE order_id=?", (o["id"],)):
            lines.append(f"I\t{o['ref']}\t{_clean_field(it['name'])}\t{it['qty']}\t{it['qty'] * it['unit_price_kobo']}")
    try:
        report = clients.analytics_report("\n".join(lines) + "\n")
    except clients.ServiceError as exc:
        raise HTTPException(502, str(exc))
    counts = {r["status"]: r["n"] for r in c.execute("SELECT status,COUNT(*) AS n FROM orders GROUP BY status")}
    low = c.execute("""SELECT w.name AS name, k.name AS color, k.stock AS stock FROM watch_colors k
                       JOIN watches w ON w.id=k.watch_id WHERE w.active=1 AND k.stock<=2
                       ORDER BY k.stock, w.name, k.position LIMIT 8""").fetchall()
    return {"report": report, "counts": counts,
            "low_stock": [{"name": variants.label(r["name"], r["color"]), "stock": r["stock"]} for r in low],
            "subscribers": c.execute("SELECT COUNT(*) FROM subscribers WHERE active=1").fetchone()[0]}


# ---------- subscribers and campaigns ----------
@router.get("/subscribers")
def admin_subscribers(_=Depends(sec.require_admin)):
    rows = db.conn().execute("SELECT email,active,created_at FROM subscribers ORDER BY id DESC LIMIT 1000").fetchall()
    return {"subscribers": [dict(r) for r in rows]}


@router.post("/campaign", dependencies=[Depends(sec.rate_limit("campaign", 5, 3600))])
def admin_campaign(body: CampaignIn, user=Depends(sec.require_admin)):
    if body.test_only:
        recipients = [{"email": user["email"], "token": "test-token-not-real"}]
    else:
        recipients = [dict(r) for r in db.conn().execute("SELECT email,token FROM subscribers WHERE active=1 LIMIT 5000")]
    if not recipients:
        raise HTTPException(409, "You have no subscribers yet.")
    cta_url = f"{config.SITE_URL}{body.cta_path}" if body.cta_path else ""
    msgs = [{"kind": "campaign", "to": r["email"], "data": {
        "subject": body.subject, "headline": body.headline, "body": body.body,
        "cta_label": body.cta_label if cta_url else "", "cta_url": cta_url,
        "unsubscribe_url": f"{config.SITE_URL}/api/newsletter/unsubscribe?token={r['token']}"}} for r in recipients]
    if not clients.send_mail(msgs):
        raise HTTPException(502, "The mail service could not accept the campaign.")
    return {"queued": len(msgs)}
