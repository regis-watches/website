"""Clients for the internal services (Rust payments, Java analytics, C# mailer).

They listen on loopback only and require a shared secret. Mail failures never block an order.
"""
import logging
from typing import Any, Optional

import httpx

import config

log = logging.getLogger("regis.clients")
HEADERS = {"X-Internal-Token": config.INTERNAL_TOKEN}


class ServiceError(Exception):
    pass


def _client(timeout: float) -> httpx.Client:
    return httpx.Client(timeout=timeout, headers=HEADERS)


# ---------- payments (Rust) ----------
def pay_initialize(reference: str, email: str, amount_kobo: int, callback_url: str, order_ref: str) -> dict:
    try:
        with _client(20) as c:
            r = c.post(f"{config.PAYMENTS_URL}/internal/initialize", json={
                "reference": reference, "email": email, "amount_kobo": amount_kobo,
                "callback_url": callback_url, "order_ref": order_ref,
            })
        if r.status_code != 200:
            log.error("payments initialize failed: %s %s", r.status_code, r.text[:300])
            raise ServiceError("We could not start your payment. Please try again.")
        return r.json()
    except httpx.HTTPError as exc:
        log.error("payments unreachable: %s", exc)
        raise ServiceError("Payments are temporarily unavailable. Please try again shortly.")


def pay_verify(reference: str) -> dict:
    try:
        with _client(20) as c:
            r = c.get(f"{config.PAYMENTS_URL}/internal/verify/{reference}")
        if r.status_code != 200:
            raise ServiceError("We could not confirm your payment yet.")
        return r.json()
    except httpx.HTTPError as exc:
        log.error("payments unreachable: %s", exc)
        raise ServiceError("We could not confirm your payment yet.")


def pay_charge_saved(reference: str, email: str, amount_kobo: int, authorization_code: str) -> dict:
    try:
        with _client(30) as c:
            r = c.post(f"{config.PAYMENTS_URL}/internal/charge", json={
                "reference": reference, "email": email, "amount_kobo": amount_kobo,
                "authorization_code": authorization_code,
            })
        if r.status_code != 200:
            raise ServiceError("Your saved card could not be charged.")
        return r.json()
    except httpx.HTTPError as exc:
        log.error("payments unreachable: %s", exc)
        raise ServiceError("Payments are temporarily unavailable. Please try again shortly.")


def pay_check_webhook(raw_body: bytes, signature: str) -> Optional[dict]:
    try:
        with _client(10) as c:
            r = c.post(f"{config.PAYMENTS_URL}/internal/webhook", content=raw_body,
                       headers={**HEADERS, "X-Paystack-Signature": signature, "Content-Type": "application/json"})
        if r.status_code != 200:
            return None
        data = r.json()
        return data if data.get("valid") else None
    except httpx.HTTPError:
        return None


# ---------- analytics (Java) ----------
def analytics_report(tsv: str) -> dict:
    try:
        with _client(15) as c:
            r = c.post(f"{config.ANALYTICS_URL}/internal/report?tz=Africa/Lagos", content=tsv.encode("utf-8"),
                       headers={**HEADERS, "Content-Type": "text/tab-separated-values; charset=utf-8"})
        if r.status_code != 200:
            raise ServiceError("Reports are unavailable right now.")
        return r.json()
    except httpx.HTTPError as exc:
        log.error("analytics unreachable: %s", exc)
        raise ServiceError("Reports are unavailable right now.")


# ---------- mailer (C#) ----------
def send_mail(messages: list[dict[str, Any]]) -> bool:
    """Fire and forget. Returns False on failure but never raises."""
    if not messages:
        return True
    try:
        with _client(10) as c:
            r = c.post(f"{config.MAILER_URL}/internal/send", json={"messages": messages})
        return r.status_code in (200, 202)
    except httpx.HTTPError as exc:
        log.warning("mailer unreachable: %s", exc)
        return False


def health() -> dict:
    out = {}
    for name, url in (("payments", config.PAYMENTS_URL), ("analytics", config.ANALYTICS_URL), ("mailer", config.MAILER_URL)):
        try:
            with _client(2) as c:
                out[name] = c.get(f"{url}/healthz").status_code == 200
        except httpx.HTTPError:
            out[name] = False
    return out
