"""Colours (shades) of a watch.

A watch is added once. Each colour has its own name, swatch, photos and stock, and customers pick one on the
watch page. These helpers use plain sqlite3 and know nothing about the web layer, so they are easy to test.

watches.stock and watches.images are a summary of the colour rows (total stock, first colour's photos). They are
refreshed by sync_watch() after every change, so catalogue cards and SEO pages can keep reading them directly.
"""
import json
import re
import sqlite3
from typing import Iterable, Optional

HEX_RE = re.compile(r"^#[0-9a-f]{6}$")


def parse_images(raw: Optional[str]) -> list[str]:
    try:
        return [n for n in json.loads(raw or "[]") if isinstance(n, str)]
    except ValueError:
        return []


def colors_for(c: sqlite3.Connection, watch_ids: Iterable[int]) -> dict[int, list[dict]]:
    """All colours of the given watches, in the order the owner set, keyed by watch id."""
    ids = list(watch_ids)
    out: dict[int, list[dict]] = {i: [] for i in ids}
    if not ids:
        return out
    marks = ",".join("?" for _ in ids)
    for r in c.execute(f"SELECT * FROM watch_colors WHERE watch_id IN ({marks}) ORDER BY position, id", ids):
        out[r["watch_id"]].append({"id": r["id"], "name": r["name"], "hex": r["hex"], "stock": r["stock"],
                                   "images": parse_images(r["images"])})
    return out


def label(watch_name: str, color_name: str) -> str:
    """How a line is named for a customer: 'Meridian 38 (Midnight)', or just the watch name for a single colour."""
    return f"{watch_name} ({color_name})" if color_name else watch_name


def sync_watch(c: sqlite3.Connection, watch_id: int, now: Optional[str] = None) -> None:
    """Refresh the summary columns on the watch from its colour rows."""
    rows = c.execute("SELECT stock,images FROM watch_colors WHERE watch_id=? ORDER BY position, id", (watch_id,)).fetchall()
    total = sum(r["stock"] for r in rows)
    cover: list[str] = []
    for r in rows:
        imgs = parse_images(r["images"])
        if imgs:
            cover = imgs
            break
    if now is None:
        c.execute("UPDATE watches SET stock=?, images=? WHERE id=?", (total, json.dumps(cover), watch_id))
    else:
        c.execute("UPDATE watches SET stock=?, images=?, updated_at=? WHERE id=?", (total, json.dumps(cover), now, watch_id))


def take_stock(c: sqlite3.Connection, watch_id: int, qty: int) -> None:
    """Take units from a watch's colours, first colour first. Used only for order lines that predate colours."""
    for r in c.execute("SELECT id,stock FROM watch_colors WHERE watch_id=? ORDER BY position, id", (watch_id,)).fetchall():
        if qty <= 0:
            return
        use = min(qty, r["stock"])
        if use:
            c.execute("UPDATE watch_colors SET stock=stock-? WHERE id=?", (use, r["id"]))
            qty -= use


def give_stock(c: sqlite3.Connection, watch_id: int, qty: int) -> None:
    """Return units to a watch's first colour. Used only for order lines that predate colours."""
    r = c.execute("SELECT id FROM watch_colors WHERE watch_id=? ORDER BY position, id LIMIT 1", (watch_id,)).fetchone()
    if r:
        c.execute("UPDATE watch_colors SET stock=stock+? WHERE id=?", (qty, r["id"]))


def all_image_names(c: sqlite3.Connection) -> set[str]:
    """Every photo file that any watch still uses."""
    used: set[str] = set()
    for r in c.execute("SELECT images FROM watch_colors"):
        used.update(parse_images(r["images"]))
    for r in c.execute("SELECT images FROM watches"):
        used.update(parse_images(r["images"]))
    return used
