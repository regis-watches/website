"""Customer-facing API."""
import json
import logging
import secrets
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.responses import RedirectResponse

import clients
import config
import db
import orders
import security as sec
import variants
from schemas import (CartIn, CheckoutIn, ClientErrorIn, ContactIn, Email, LoginIn, NG_STATES, RegisterIn, TrackIn)

router = APIRouter(prefix="/api")
log = logging.getLogger("regis.public")


# ---------- helpers ----------
def image_names(r) -> list:
    return variants.parse_images(r["images"])


def color_out(col: dict) -> dict:
    return {"id": col["id"], "name": col["name"], "hex": col["hex"], "stock": col["stock"],
            "in_stock": col["stock"] > 0, "images": [f"/uploads/{n}" for n in col["images"]]}


def watch_out(r, colors: list) -> dict:
    return {
        "id": r["id"], "slug": r["slug"], "name": r["name"], "collection": r["collection"],
        "tagline": r["tagline"], "description": r["description"], "price_kobo": r["price_kobo"],
        "stock": r["stock"], "in_stock": r["stock"] > 0, "featured": bool(r["featured"]),
        "specs": {
            "Movement": r["movement"], "Case": ", ".join(x for x in ((f"{r['case_mm']} mm" if r["case_mm"] else ""), r["case_material"]) if x),
            "Strap": r["strap"], "Water resistance": r["water_resistance"], "Crystal": r["crystal"],
            "Power": r["power_reserve"], "Warranty": r["warranty"],
        },
        # The cover photos (the first colour that has any). Cards and share images use these.
        "images": [f"/uploads/{n}" for n in image_names(r)],
        # Every colour of this watch, each with its own photos and stock.
        "colors": [color_out(x) for x in colors],
    }


def watches_out(rows) -> list:
    """Serialise several watches with a single query for all their colours."""
    by_watch = variants.colors_for(db.conn(), [r["id"] for r in rows])
    return [watch_out(r, by_watch[r["id"]]) for r in rows]


# ---------- site ----------
@router.get("/config")
def site_config():
    return {
        "business": config.BUSINESS_NAME, "support_email": config.SUPPORT_EMAIL, "support_phone": config.SUPPORT_PHONE,
        "whatsapp": config.SUPPORT_WHATSAPP,
        "plausible": config.PLAUSIBLE_DOMAIN, "states": NG_STATES,
    }


# ---------- catalogue ----------
@router.get("/watches")
def list_watches(collection: Optional[str] = Query(default=None, pattern="^(men|women|neutral)$"),
                 q: Optional[str] = Query(default=None, max_length=60),
                 sort: str = Query(default="featured", pattern="^(featured|price_asc|price_desc|newest)$")):
    sql, args = "SELECT * FROM watches WHERE active=1", []
    if collection:
        sql += " AND collection=?"
        args.append(collection)
    if q:
        like = "%" + q.replace("%", "").replace("_", "") + "%"
        sql += " AND (name LIKE ? OR tagline LIKE ? OR description LIKE ?)"
        args += [like, like, like]
    order = {"featured": "featured DESC, id ASC", "price_asc": "price_kobo ASC", "price_desc": "price_kobo DESC",
             "newest": "created_at DESC, id DESC"}[sort]
    rows = db.conn().execute(f"{sql} ORDER BY {order}", args).fetchall()
    return {"watches": watches_out(rows)}


@router.get("/watches/{slug}")
def get_watch(slug: str):
    r = db.conn().execute("SELECT * FROM watches WHERE slug=? AND active=1", (slug[:80],)).fetchone()
    if not r:
        raise HTTPException(404, "We could not find that watch.")
    related = db.conn().execute(
        "SELECT * FROM watches WHERE active=1 AND collection=? AND id!=? ORDER BY featured DESC, id LIMIT 3",
        (r["collection"], r["id"])).fetchall()
    both = watches_out([r, *related])
    return {"watch": both[0], "related": both[1:]}


@router.post("/cart/price")
def cart_price(body: CartIn):
    lines, total = orders.price_cart(body.items)
    return {"lines": lines, "total_kobo": total}


# ---------- accounts ----------
@router.post("/auth/register", dependencies=[Depends(sec.rate_limit("register", 5, 600))])
def register(body: RegisterIn, response: Response):
    c = db.conn()
    if c.execute("SELECT 1 FROM users WHERE email=?", (body.email,)).fetchone():
        raise HTTPException(409, "An account with this email already exists. Try signing in.")
    cur = c.execute("INSERT INTO users (email,name,phone,pw_hash,role,created_at) VALUES (?,?,?,?, 'customer', ?)",
                    (body.email, body.name, body.phone, sec.hash_password(body.password), db.now()))
    sec.create_session(response, cur.lastrowid, "customer")
    return {"user": {"id": cur.lastrowid, "email": body.email, "name": body.name, "phone": body.phone, "role": "customer"}}


@router.post("/auth/login", dependencies=[Depends(sec.rate_limit("login", 8, 300))])
def login(body: LoginIn, request: Request, response: Response):
    sec.limiter.check(f"login-email:{body.email}", 10, 900)
    row = db.conn().execute("SELECT * FROM users WHERE email=? AND role='customer'", (body.email,)).fetchone()
    if not row:
        sec.burn_time(body.password)
        raise HTTPException(401, "That email and password do not match.")
    if not sec.verify_password(body.password, row["pw_hash"]):
        raise HTTPException(401, "That email and password do not match.")
    sec.create_session(response, row["id"], "customer")
    return {"user": {"id": row["id"], "email": row["email"], "name": row["name"], "phone": row["phone"], "role": "customer"}}


@router.post("/auth/logout")
def logout(request: Request, response: Response):
    sec.destroy_session(request, response)
    return {"ok": True}


@router.get("/auth/me")
def me(user=Depends(sec.current_user)):
    if not user:
        return {"user": None}
    return {"user": {k: user[k] for k in ("id", "email", "name", "phone", "role")}}


@router.get("/me/orders")
def my_orders(user=Depends(sec.require_user)):
    refs = db.conn().execute("SELECT ref FROM orders WHERE user_id=? AND status!='pending_payment' ORDER BY id DESC LIMIT 50",
                             (user["id"],)).fetchall()
    return {"orders": [orders.public_view(orders.get_order(r["ref"])) for r in refs]}


@router.get("/me/cards")
def my_cards(user=Depends(sec.require_user)):
    rows = db.conn().execute(
        "SELECT id,last4,brand,exp_month,exp_year,bank FROM saved_cards WHERE user_id=? ORDER BY id DESC", (user["id"],)).fetchall()
    return {"cards": [dict(r) for r in rows]}


@router.delete("/me/cards/{card_id}")
def delete_card(card_id: int, user=Depends(sec.require_user)):
    db.conn().execute("DELETE FROM saved_cards WHERE id=? AND user_id=?", (card_id, user["id"]))
    return {"ok": True}


# ---------- checkout ----------
@router.post("/checkout", dependencies=[Depends(sec.rate_limit("checkout", 10, 600))])
def checkout(body: CheckoutIn, user=Depends(sec.current_user)):
    lines, total = orders.price_cart(body.items)
    user_id = user["id"] if user and user["role"] == "customer" else None
    card = None
    if body.saved_card_id is not None:
        if not user_id:
            raise HTTPException(401, "Sign in to use a saved card.")
        card = db.conn().execute("SELECT * FROM saved_cards WHERE id=? AND user_id=?", (body.saved_card_id, user_id)).fetchone()
        if not card:
            raise HTTPException(404, "That saved card was not found.")
    if body.save_card and not user_id:
        raise HTTPException(401, "Create an account or sign in if you want to save your card.")

    ref = orders.create_order(lines, total, body.customer, user_id, body.save_card, body.newsletter)
    try:
        if card:
            res = clients.pay_charge_saved(ref, body.customer.email, total, card["auth_code"])
            if res.get("status") == "success":
                final = orders.confirm_payment(ref)
                return {"paid": True, "ref": ref, "status": final["status"] if final else "processing"}
            orders.cancel_pending(ref)
            raise HTTPException(402, "Your bank did not approve that saved card. Please try a different card.")
        init = clients.pay_initialize(ref, body.customer.email, total, f"{config.SITE_URL}/checkout/complete", ref)
        return {"paid": False, "ref": ref, "authorization_url": init["authorization_url"]}
    except clients.ServiceError as exc:
        orders.cancel_pending(ref)
        raise HTTPException(502, str(exc))


@router.get("/checkout/verify", dependencies=[Depends(sec.rate_limit("verify", 30, 300))])
def checkout_verify(reference: str = Query(min_length=4, max_length=24, pattern=r"^[A-Za-z0-9\-]+$")):
    o = orders.confirm_payment(reference)
    if not o:
        raise HTTPException(404, "We could not find that order.")
    paid = o["status"] != "pending_payment" and o["status"] != "cancelled"
    return {"paid": paid, "ref": o["ref"], "total_kobo": o["total_kobo"],
            "items": [{"name": i["name"], "color": i["color"], "qty": i["qty"]} for i in o["items"]]}


@router.post("/paystack/webhook")
async def paystack_webhook(request: Request):
    raw = await request.body()
    if len(raw) > 100_000:
        raise HTTPException(413, "Too large.")
    verdict = clients.pay_check_webhook(raw, request.headers.get("x-paystack-signature", ""))
    if not verdict:
        raise HTTPException(401, "Invalid signature.")
    if verdict.get("event") == "charge.success" and verdict.get("reference"):
        orders.confirm_payment(str(verdict["reference"]))
    return {"ok": True}


@router.post("/orders/track", dependencies=[Depends(sec.rate_limit("track", 12, 300))])
def track(body: TrackIn):
    o = orders.get_order(body.ref.upper())
    if not o or o["email"] != body.email or o["status"] == "pending_payment":
        raise HTTPException(404, "We could not find an order with those details.")
    return {"order": orders.public_view(o)}


# ---------- newsletter and contact ----------
@router.post("/newsletter/subscribe", dependencies=[Depends(sec.rate_limit("subscribe", 5, 600))])
def subscribe(body: Email):
    c = db.conn()
    row = c.execute("SELECT token,active FROM subscribers WHERE email=?", (body.email,)).fetchone()
    if row:
        token = row["token"]
        if not row["active"]:
            c.execute("UPDATE subscribers SET active=1 WHERE email=?", (body.email,))
    else:
        token = secrets.token_urlsafe(24)
        c.execute("INSERT INTO subscribers (email,token,active,created_at) VALUES (?,?,1,?)", (body.email, token, db.now()))
    if not row or not row["active"]:
        clients.send_mail([{"kind": "welcome", "to": body.email,
                            "data": {"unsubscribe_url": f"{config.SITE_URL}/api/newsletter/unsubscribe?token={token}"}}])
    return {"ok": True}  # same answer whether or not the address was already subscribed


@router.get("/newsletter/unsubscribe")
def unsubscribe(token: str = Query(min_length=10, max_length=64)):
    db.conn().execute("UPDATE subscribers SET active=0 WHERE token=?", (token,))
    return RedirectResponse("/unsubscribed", status_code=303)


@router.post("/contact", dependencies=[Depends(sec.rate_limit("contact", 4, 600))])
def contact(body: ContactIn):
    if not config.SUPPORT_EMAIL:
        raise HTTPException(503, "Messages are not set up yet. Please call or WhatsApp us instead.")
    ok = clients.send_mail([{"kind": "contact", "to": config.SUPPORT_EMAIL,
                             "data": {"from_name": body.name, "from_email": body.email, "message": body.message}}])
    if not ok:
        raise HTTPException(502, "We could not send your message. Please try again shortly.")
    return {"ok": True}


@router.post("/client-errors", dependencies=[Depends(sec.rate_limit("client-errors", 10, 300))])
def client_errors(body: ClientErrorIn):
    log.warning("client error: %s @ %s", body.message, body.where)
    return {"ok": True}
