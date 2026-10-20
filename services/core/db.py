"""SQLite access. All queries are parameterised. Money is stored as integer kobo."""
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime, timezone

import config

_local = threading.local()

SCHEMA = """
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  pw_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('customer','admin')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS watches (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  collection TEXT NOT NULL CHECK (collection IN ('men','women','neutral')),
  tagline TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  price_kobo INTEGER NOT NULL CHECK (price_kobo > 0),
  stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  movement TEXT NOT NULL DEFAULT '',
  case_mm INTEGER NOT NULL DEFAULT 38,
  case_material TEXT NOT NULL DEFAULT '',
  strap TEXT NOT NULL DEFAULT '',
  water_resistance TEXT NOT NULL DEFAULT '',
  crystal TEXT NOT NULL DEFAULT '',
  power_reserve TEXT NOT NULL DEFAULT '',
  warranty TEXT NOT NULL DEFAULT '',
  images TEXT NOT NULL DEFAULT '[]',
  featured INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- One row per colour or shade of a watch. Photos and stock live here, so a watch that comes in five colours
-- is added once. watches.stock and watches.images are kept as a summary of these rows (see variants.sync_watch).
CREATE TABLE IF NOT EXISTS watch_colors (
  id INTEGER PRIMARY KEY,
  watch_id INTEGER NOT NULL REFERENCES watches(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  hex TEXT NOT NULL DEFAULT '',
  stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  images TEXT NOT NULL DEFAULT '[]',
  position INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_colors_watch ON watch_colors(watch_id, position);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY,
  ref TEXT NOT NULL UNIQUE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  address TEXT NOT NULL,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  total_kobo INTEGER NOT NULL,
  fee_kobo INTEGER,
  net_kobo INTEGER,
  status TEXT NOT NULL CHECK (status IN ('pending_payment','processing','out_for_delivery','delivered','cancelled')),
  save_card INTEGER NOT NULL DEFAULT 0,
  newsletter INTEGER NOT NULL DEFAULT 0,
  paid_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_paid ON orders(paid_at);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  watch_id INTEGER REFERENCES watches(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '',
  color_id INTEGER REFERENCES watch_colors(id) ON DELETE SET NULL,
  unit_price_kobo INTEGER NOT NULL,
  qty INTEGER NOT NULL CHECK (qty > 0)
);

CREATE TABLE IF NOT EXISTS order_events (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS saved_cards (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  auth_code TEXT NOT NULL,
  signature TEXT NOT NULL,
  last4 TEXT NOT NULL,
  brand TEXT NOT NULL,
  exp_month TEXT NOT NULL,
  exp_year TEXT NOT NULL,
  bank TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE (user_id, signature)
);

CREATE TABLE IF NOT EXISTS subscribers (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  token TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS processed_events (
  key TEXT PRIMARY KEY,
  at TEXT NOT NULL
);
"""


def now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def conn() -> sqlite3.Connection:
    c = getattr(_local, "conn", None)
    if c is None:
        config.DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        c = sqlite3.connect(config.DB_PATH, timeout=15, isolation_level=None)
        c.row_factory = sqlite3.Row
        c.execute("PRAGMA foreign_keys=ON")
        c.execute("PRAGMA busy_timeout=10000")
        _local.conn = c
    return c


@contextmanager
def tx():
    """Immediate write transaction, so stock checks and decrements cannot interleave."""
    c = conn()
    c.execute("BEGIN IMMEDIATE")
    try:
        yield c
        c.execute("COMMIT")
    except BaseException:
        c.execute("ROLLBACK")
        raise


def init() -> None:
    c = conn()
    c.executescript(SCHEMA)
    migrate(c)


def _has_table(c: sqlite3.Connection, name: str) -> bool:
    return c.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)).fetchone() is not None


def migrate(c: sqlite3.Connection) -> None:
    """Bring a database made by an older version up to date. Safe to run every start."""
    cols = {r["name"] for r in c.execute("PRAGMA table_info(watches)")}
    if "images" not in cols:
        c.execute("ALTER TABLE watches ADD COLUMN images TEXT NOT NULL DEFAULT '[]'")
        if "image" in cols:  # the single photo of the old version becomes the first of the list
            c.execute("UPDATE watches SET images = json_array(image) WHERE image IS NOT NULL")

    if _has_table(c, "order_items"):
        item_cols = {r["name"] for r in c.execute("PRAGMA table_info(order_items)")}
        if "color" not in item_cols:
            c.execute("ALTER TABLE order_items ADD COLUMN color TEXT NOT NULL DEFAULT ''")
        if "color_id" not in item_cols:
            c.execute("ALTER TABLE order_items ADD COLUMN color_id INTEGER REFERENCES watch_colors(id) ON DELETE SET NULL")

    # Every watch has at least one colour row. A watch made before colours existed gets one unnamed colour that
    # carries its photos and stock, so nothing changes for the customer until the owner adds more colours.
    if _has_table(c, "watch_colors") and "stock" in cols:
        c.execute(
            """INSERT INTO watch_colors (watch_id,name,hex,stock,images,position)
               SELECT id,'','',stock,images,0 FROM watches
               WHERE id NOT IN (SELECT DISTINCT watch_id FROM watch_colors)""")
