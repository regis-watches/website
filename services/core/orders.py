"""Order lifecycle. Prices always come from the database, never from the browser.

Money rule: the customer is charged exactly the catalogue total. Paystack's fee is taken from the
merchant's side at settlement (we never add it to the customer's amount), so net = charged - fee.
"""
import logging
import secrets
from typing import Optional

from fastapi import HTTPException

import clients
import config
import db
import variants
from schemas import CartLine, Customer

log = logging.getLogger("regis.orders")

ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
STATUS_LABEL = {
    "pending_payment": "Awaiting payment",
    "processing": "Order Processing",
    "out_for_delivery": "Out for Delivery",
    "delivered": "Delivered",
    "cancelled": "Cancelled",
}
STATUS_MESSAGE = {
    "processing": "We have received your payment and are preparing your watch.",
    "out_for_delivery": "Your watch has left us and is on its way to you.",
    "delivered": "Your watch has been delivered. We hope it keeps good time for you.",
    "cancelled": "This order was cancelled. If you were charged, you will be refunded.",
}
# Forward-only progress, with cancellation allowed until delivery.
TRANSITIONS = {
    "processing": {"out_for_delivery", "cancelled"},
    "out_for_delivery": {"delivered", "cancelled"},
    "delivered": set(),
    "cancelled": set(),
    "pending_payment": {"cancelled"},
}


def naira(kobo: int) -> str:
    whole, cents = divmod(kobo, 100)
    return f"\u20a6{whole:,}" + (f".{cents:02d}" if cents else "")


def new_ref() -> str:
    return "RG-" + "".join(secrets.choice(ALPHABET) for _ in range(8))


def price_cart(lines: list[CartLine]) -> tuple[list[dict], int]:
    """Look up every line, merge duplicates, enforce stock per colour. Returns (priced lines, total kobo)."""
    merged: dict[tuple[str, Optional[int]], int] = {}
    for ln in lines:
        key = (ln.slug, ln.color)
        merged[key] = merged.get(key, 0) + ln.qty
    c = db.conn()
    out, total = [], 0
    for (slug, color_id), qty in merged.items():
        w = c.execute("SELECT * FROM watches WHERE slug=? AND active=1", (slug,)).fetchone()
        if not w:
            raise HTTPException(409, "One of the watches in your cart is no longer available.")
        colors = variants.colors_for(c, [w["id"]])[w["id"]]
        if color_id is None:
            if len(colors) != 1:
                raise HTTPException(422, f"Choose a colour for {w['name']}.")
            col = colors[0]
        else:
            col = next((x for x in colors if x["id"] == color_id), None)
            if col is None:
                raise HTTPException(409, f"That colour of {w['name']} is no longer available.")
        name = variants.label(w["name"], col["name"])
        if qty > 5:
            raise HTTPException(422, "You can order up to 5 of the same watch at a time.")
        if col["stock"] < qty:
            msg = f"{name} is sold out." if col["stock"] == 0 else f"Only {col['stock']} of {name} left."
            raise HTTPException(409, msg)
        line_total = w["price_kobo"] * qty
        total += line_total
        out.append({"watch_id": w["id"], "slug": slug, "name": w["name"], "color_id": col["id"], "color": col["name"],
                    "qty": qty, "unit_price_kobo": w["price_kobo"], "line_total_kobo": line_total})
    return out, total


def create_order(lines: list[dict], total: int, cust: Customer, user_id: Optional[int],
                 save_card: bool, newsletter: bool) -> str:
    ref = new_ref()
    t = db.now()
    with db.tx() as c:
        cur = c.execute(
            """INSERT INTO orders (ref,user_id,email,name,phone,address,city,state,notes,total_kobo,status,
               save_card,newsletter,created_at,updated_at)
               VALUES (?,?,?,?,?,?,?,?,?,?, 'pending_payment', ?,?,?,?)""",
            (ref, user_id, cust.email, cust.name, cust.phone, cust.address, cust.city, cust.state, cust.notes,
             total, int(save_card), int(newsletter), t, t),
        )
        oid = cur.lastrowid
        for ln in lines:
            c.execute("INSERT INTO order_items (order_id,watch_id,name,color,color_id,unit_price_kobo,qty) VALUES (?,?,?,?,?,?,?)",
                      (oid, ln["watch_id"], ln["name"], ln["color"], ln["color_id"], ln["unit_price_kobo"], ln["qty"]))
        c.execute("INSERT INTO order_events (order_id,status,at) VALUES (?,?,?)", (oid, "pending_payment", t))
    return ref


def cancel_pending(ref: str) -> None:
    with db.tx() as c:
        c.execute("UPDATE orders SET status='cancelled',updated_at=? WHERE ref=? AND status='pending_payment'",
                  (db.now(), ref))


def get_order(ref: str) -> Optional[dict]:
    c = db.conn()
    row = c.execute("SELECT * FROM orders WHERE ref=?", (ref,)).fetchone()
    if not row:
        return None
    o = dict(row)
    o["items"] = [dict(r) for r in c.execute(
        "SELECT name,color,qty,unit_price_kobo FROM order_items WHERE order_id=? ORDER BY id", (o["id"],))]
    o["events"] = [dict(r) for r in c.execute(
        "SELECT status,at FROM order_events WHERE order_id=? AND status!='pending_payment' ORDER BY id", (o["id"],))]
    return o


def public_view(o: dict) -> dict:
    """What a customer is allowed to see about their own order."""
    return {
        "ref": o["ref"], "status": o["status"], "status_label": STATUS_LABEL[o["status"]],
        "status_message": STATUS_MESSAGE.get(o["status"], ""),
        "total_kobo": o["total_kobo"], "city": o["city"], "state": o["state"],
        "created_at": o["created_at"], "paid_at": o["paid_at"],
        "items": [{"name": i["name"], "color": i["color"], "qty": i["qty"], "unit_price_kobo": i["unit_price_kobo"]} for i in o["items"]],
        "events": [{"status": e["status"], "label": STATUS_LABEL[e["status"]], "at": e["at"]} for e in o["events"]],
    }


def _mail_confirmation(o: dict) -> None:
    clients.send_mail([{
        "kind": "order_confirmation", "to": o["email"],
        "data": {
            "name": o["name"], "order_ref": o["ref"], "total": naira(o["total_kobo"]),
            "items": [{"name": variants.label(i["name"], i["color"]), "qty": i["qty"], "price": naira(i["unit_price_kobo"] * i["qty"])} for i in o["items"]],
            "track_url": f"{config.SITE_URL}/orders?ref={o['ref']}",
        },
    }])


def confirm_payment(ref: str) -> Optional[dict]:
    """Verify with Paystack (via the Rust service) and finalise the order exactly once."""
    order = get_order(ref)
    if not order:
        return None
    if order["status"] != "pending_payment":
        return order  # already handled, idempotent

    try:
        result = clients.pay_verify(ref)
    except clients.ServiceError:
        return order

    if result.get("status") != "success":
        return order
    # Defence in depth: the amount and currency Paystack collected must match what we asked for.
    if result.get("amount_kobo") != order["total_kobo"] or result.get("currency") != "NGN":
        log.error("Amount mismatch on %s: paid=%s expected=%s", ref, result.get("amount_kobo"), order["total_kobo"])
        with db.tx() as c:
            c.execute("UPDATE orders SET notes=notes||' [PAYMENT MISMATCH, review in Paystack]',updated_at=? WHERE ref=?",
                      (db.now(), ref))
        return get_order(ref)

    fee = int(result.get("fees_kobo") or 0)
    net = order["total_kobo"] - fee
    t = db.now()
    with db.tx() as c:
        cur = c.execute(
            """UPDATE orders SET status='processing',fee_kobo=?,net_kobo=?,paid_at=?,updated_at=?
               WHERE ref=? AND status='pending_payment'""", (fee, net, result.get("paid_at") or t, t, ref))
        if cur.rowcount == 0:
            return get_order(ref)  # a concurrent confirm won the race
        c.execute("INSERT INTO order_events (order_id,status,at) VALUES (?,?,?)", (order["id"], "processing", t))
        for it in c.execute("SELECT watch_id,color_id,color,qty FROM order_items WHERE order_id=?", (order["id"],)).fetchall():
            if it["color_id"]:
                c.execute("UPDATE watch_colors SET stock=MAX(stock-?,0) WHERE id=?", (it["qty"], it["color_id"]))
            elif it["watch_id"] and not it["color"]:
                variants.take_stock(c, it["watch_id"], it["qty"])  # a line made before colours existed
            if it["watch_id"]:
                variants.sync_watch(c, it["watch_id"], t)
        auth = result.get("authorization") or {}
        if order["save_card"] and order["user_id"] and auth.get("reusable") and auth.get("authorization_code"):
            c.execute(
                """INSERT OR IGNORE INTO saved_cards (user_id,auth_code,signature,last4,brand,exp_month,exp_year,bank,created_at)
                   VALUES (?,?,?,?,?,?,?,?,?)""",
                (order["user_id"], auth["authorization_code"], auth.get("signature") or auth["authorization_code"],
                 str(auth.get("last4", ""))[:4], str(auth.get("card_type", "card")).strip()[:20],
                 str(auth.get("exp_month", ""))[:2], str(auth.get("exp_year", ""))[:4], str(auth.get("bank", ""))[:60], t))
        if order["newsletter"]:
            import secrets as _s
            c.execute("INSERT OR IGNORE INTO subscribers (email,token,active,created_at) VALUES (?,?,1,?)",
                      (order["email"], _s.token_urlsafe(24), t))
    final = get_order(ref)
    if final:
        _mail_confirmation(final)
    return final


def set_status(ref: str, new_status: str) -> dict:
    o = get_order(ref)
    if not o:
        raise HTTPException(404, "Order not found.")
    if new_status not in TRANSITIONS.get(o["status"], set()):
        raise HTTPException(409, f"An order that is '{STATUS_LABEL[o['status']]}' cannot move to '{STATUS_LABEL[new_status]}'.")
    t = db.now()
    with db.tx() as c:
        c.execute("UPDATE orders SET status=?,updated_at=? WHERE ref=?", (new_status, t, ref))
        c.execute("INSERT INTO order_events (order_id,status,at) VALUES (?,?,?)", (o["id"], new_status, t))
        if new_status == "cancelled" and o["status"] in ("processing", "out_for_delivery"):
            for it in c.execute("SELECT watch_id,color_id,color,qty FROM order_items WHERE order_id=?", (o["id"],)).fetchall():
                if it["color_id"]:
                    c.execute("UPDATE watch_colors SET stock=stock+? WHERE id=?", (it["qty"], it["color_id"]))
                elif it["watch_id"] and not it["color"]:
                    variants.give_stock(c, it["watch_id"], it["qty"])  # a line made before colours existed
                if it["watch_id"]:
                    variants.sync_watch(c, it["watch_id"], t)
    clients.send_mail([{
        "kind": "order_status", "to": o["email"],
        "data": {"name": o["name"], "order_ref": ref, "status_label": STATUS_LABEL[new_status],
                 "message": STATUS_MESSAGE.get(new_status, ""), "track_url": f"{config.SITE_URL}/orders?ref={ref}"},
    }])
    return get_order(ref)  # type: ignore[return-value]
