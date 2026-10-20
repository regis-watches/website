"""Run with:  cd services/core && python -m pytest -q"""
import os
import sys
import tempfile
from pathlib import Path

os.environ["APP_ENV"] = "test"
os.environ["DB_PATH"] = str(Path(tempfile.mkdtemp()) / "test.db")
os.environ["UPLOAD_DIR"] = str(Path(tempfile.mkdtemp()))
os.environ["ADMIN_EMAIL"] = "owner@regis.test"
os.environ["ADMIN_PASSWORD"] = "correct-horse-battery"
os.environ["SITE_URL"] = "http://testserver"
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest
from fastapi.testclient import TestClient

import clients
import db
import main
import security

H = {"Origin": "http://testserver", "X-Requested-With": "regis"}
CUSTOMER = {"name": "Ada Obi", "email": "ada@example.com", "phone": "08012345678",
            "address": "12 Unity Road", "city": "Ilorin", "state": "Kwara", "notes": ""}

sent_mail: list = []
initialised: list = []
paystack = {"fees_kobo": 40000}


@pytest.fixture(autouse=True)
def fakes(monkeypatch):
    sent_mail.clear()
    initialised.clear()
    security.limiter.hits.clear()
    monkeypatch.setattr(clients, "send_mail", lambda m: sent_mail.extend(m) or True)

    def init(reference, email, amount_kobo, callback_url, order_ref):
        initialised.append(amount_kobo)
        return {"authorization_url": "https://checkout.paystack.com/abc", "reference": reference}

    def verify(reference):
        o = db.conn().execute("SELECT total_kobo FROM orders WHERE ref=?", (reference,)).fetchone()
        return {"status": "success", "amount_kobo": o["total_kobo"], "currency": "NGN", "fees_kobo": paystack["fees_kobo"],
                "paid_at": "2026-10-01T10:00:00Z",
                "authorization": {"authorization_code": "AUTH_x1", "signature": "SIG_1", "last4": "4081",
                                  "card_type": "visa ", "exp_month": "12", "exp_year": "2030", "bank": "TEST BANK", "reusable": True}}
    monkeypatch.setattr(clients, "pay_initialize", init)
    monkeypatch.setattr(clients, "pay_verify", verify)


@pytest.fixture(scope="module")
def client():
    with TestClient(main.app) as c:
        yield c


PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


def admin_session() -> TestClient:
    a = TestClient(main.app)
    r = a.post("/api/admin/login", json={"email": "owner@regis.test", "password": "correct-horse-battery"}, headers=H)
    assert r.status_code == 200, r.text
    return a


@pytest.fixture(scope="module")
def shop(client):
    """The shop starts empty, so these tests stock it through the admin API, exactly like the owner would."""
    security.limiter.hits.clear()
    a = admin_session()
    img = a.post("/api/admin/uploads", content=PNG, headers={**H, "Content-Type": "image/png"}).json()["image"]
    for name, col, naira, stock, photos in [
        ("Sable Quartz", "men", 20000, 25, []), ("Meridian 38", "men", 385000, 6, [img]), ("Calla", "women", 245000, 7, []),
        ("Dune", "neutral", 210000, 7, []), ("Argent", "neutral", 340000, 4, []), ("Ember Square", "neutral", 150000, 10, []),
    ]:
        r = a.post("/api/admin/watches", json={"name": name, "collection": col, "price_naira": naira,
                                               "colors": [{"name": "", "stock": stock, "images": photos}]}, headers=H)
        assert r.status_code == 201, r.text
    return a


def test_a_new_shop_starts_empty(client):
    assert client.get("/api/watches").json() == {"watches": []}
    assert client.get("/sitemap.xml").text.count("/watch/") == 0


def test_catalogue_lists_three_collections(client, shop):
    for col in ("men", "women", "neutral"):
        r = client.get(f"/api/watches?collection={col}")
        assert r.status_code == 200 and len(r.json()["watches"]) >= 1
    assert client.get("/api/watches/nope-nope").status_code == 404


def test_customer_pays_exactly_list_price_and_merchant_nets_price_minus_fee(client, shop):
    slug = "sable-quartz"  # N20,000 in the seed
    r = client.post("/api/checkout", json={"items": [{"slug": slug, "qty": 1}], "customer": CUSTOMER}, headers=H)
    assert r.status_code == 200, r.text
    ref = r.json()["ref"]
    assert initialised == [20000 * 100]  # exactly N20,000 sent to Paystack, no fee added

    paystack["fees_kobo"] = 20000  # N200 fee, as in the brief
    v = client.get(f"/api/checkout/verify?reference={ref}")
    assert v.json()["paid"] is True
    row = db.conn().execute("SELECT total_kobo,fee_kobo,net_kobo,status FROM orders WHERE ref=?", (ref,)).fetchone()
    assert (row["total_kobo"], row["fee_kobo"], row["net_kobo"]) == (2_000_000, 20_000, 1_980_000)
    assert row["status"] == "processing"
    # verifying again must not double-count stock or send a second mail
    before = db.conn().execute("SELECT stock FROM watches WHERE slug=?", (slug,)).fetchone()["stock"]
    client.get(f"/api/checkout/verify?reference={ref}")
    after = db.conn().execute("SELECT stock FROM watches WHERE slug=?", (slug,)).fetchone()["stock"]
    assert before == after and sum(1 for m in sent_mail if m["kind"] == "order_confirmation") == 1


def test_client_cannot_set_price(client, shop):
    r = client.post("/api/checkout", json={"items": [{"slug": "meridian-38", "qty": 1, "price": 1}], "customer": CUSTOMER}, headers=H)
    assert r.status_code == 422  # unknown fields are rejected
    r = client.post("/api/checkout", json={"items": [{"slug": "meridian-38", "qty": 1}], "customer": CUSTOMER}, headers=H)
    assert initialised[-1] == 385000 * 100


def test_validation_and_csrf(client, shop):
    bad = dict(CUSTOMER, email="not-an-email")
    assert client.post("/api/checkout", json={"items": [{"slug": "dune", "qty": 1}], "customer": bad}, headers=H).status_code == 422
    assert client.post("/api/checkout", json={"items": [{"slug": "dune", "qty": 1}], "customer": CUSTOMER}).status_code == 403
    xss = dict(CUSTOMER, name="<script>alert(1)</script>")
    r = client.post("/api/checkout", json={"items": [{"slug": "dune", "qty": 1}], "customer": xss}, headers=H)
    assert r.status_code == 200  # stored as plain text; the front end escapes on output


def test_stock_is_enforced(client, shop):
    r = client.post("/api/checkout", json={"items": [{"slug": "dune", "qty": 5}, {"slug": "dune", "qty": 5}], "customer": CUSTOMER}, headers=H)
    assert r.status_code in (409, 422)


def test_admin_routes_require_admin(client):
    assert client.get("/api/admin/watches").status_code == 401
    c2 = TestClient(main.app)
    c2.post("/api/auth/register", json={"name": "Bola", "email": "bola@example.com", "password": "longenough1"}, headers=H)
    assert c2.get("/api/admin/watches").status_code == 403
    assert c2.post("/api/admin/watches", json={}, headers=H).status_code == 403


def test_admin_crud_and_status_flow(client, shop):
    assert TestClient(main.app).post("/api/admin/login", json={"email": "owner@regis.test", "password": "wrong-password-x"}, headers=H).status_code == 401
    a = admin_session()
    body = {"name": "Test Piece", "collection": "neutral", "price_naira": 99000, "colors": [{"name": "", "stock": 3}]}
    r = a.post("/api/admin/watches", json=body, headers=H)
    assert r.status_code == 201
    wid = r.json()["watch"]["id"]
    body["price_naira"] = 101000
    assert a.put(f"/api/admin/watches/{wid}", json=body, headers=H).json()["watch"]["price_kobo"] == 10_100_000
    assert a.delete(f"/api/admin/watches/{wid}", headers=H).status_code == 200

    ref = client.post("/api/checkout", json={"items": [{"slug": "ember-square", "qty": 1}], "customer": CUSTOMER}, headers=H).json()["ref"]
    client.get(f"/api/checkout/verify?reference={ref}")
    assert a.patch(f"/api/admin/orders/{ref}/status", json={"status": "delivered"}, headers=H).status_code == 409  # cannot skip a step
    assert a.patch(f"/api/admin/orders/{ref}/status", json={"status": "out_for_delivery"}, headers=H).status_code == 200
    assert a.patch(f"/api/admin/orders/{ref}/status", json={"status": "delivered"}, headers=H).status_code == 200
    assert any(m["kind"] == "order_status" for m in sent_mail)


def test_tracking_needs_matching_email(client, shop):
    ref = client.post("/api/checkout", json={"items": [{"slug": "argent", "qty": 1}], "customer": CUSTOMER}, headers=H).json()["ref"]
    client.get(f"/api/checkout/verify?reference={ref}")
    assert client.post("/api/orders/track", json={"ref": ref, "email": "someone@else.com"}, headers=H).status_code == 404
    ok = client.post("/api/orders/track", json={"ref": ref, "email": "ada@example.com"}, headers=H)
    assert ok.status_code == 200 and ok.json()["order"]["status_label"] == "Order Processing"
    assert "email" not in ok.json()["order"] and "fee_kobo" not in ok.json()["order"]


def test_login_rate_limited(client):
    codes = [client.post("/api/auth/login", json={"email": "x@example.com", "password": "nopenope1"}, headers=H).status_code for _ in range(10)]
    assert 429 in codes


def test_seo_endpoints(client, shop):
    assert "Disallow: /admin" in client.get("/robots.txt").text
    assert "/watch/meridian-38" in client.get("/sitemap.xml").text
    assert "/uploads/" in client.get("/watch/meridian-38").text  # the first photo is the share image
    page = client.get("/watch/meridian-38")
    assert page.status_code == 200 and "Meridian 38 | Regis" in page.text and "application/ld+json" in page.text
    assert client.get("/watch/does-not-exist").status_code == 404
    assert client.get("/healthz").status_code in (200, 503)


def test_photos_upload_attach_and_clean_up(client, shop):
    a = admin_session()
    bad = a.post("/api/admin/uploads", content=b"not an image at all", headers={**H, "Content-Type": "image/png"})
    assert bad.status_code == 415
    up = a.post("/api/admin/uploads", content=PNG, headers={**H, "Content-Type": "image/png"}).json()
    assert up["url"] == f"/uploads/{up['image']}" and client.get(up["url"]).status_code == 200

    body = {"name": "Photo Test", "collection": "women", "price_naira": 50000, "colors": [{"name": "", "stock": 2, "images": [up["image"]]}]}
    w = a.post("/api/admin/watches", json=body, headers=H).json()["watch"]
    assert w["images"] == [up["url"]] and w["colors"][0]["image_names"] == [up["image"]]
    assert client.get(f"/api/watches/{w['slug']}").json()["watch"]["images"] == [up["url"]]

    def with_images(name, images):
        return {**body, "name": name, "colors": [{"name": "", "stock": 2, "images": images}]}

    # a photo that was never uploaded, or a made-up name, is refused
    assert a.post("/api/admin/watches", json=with_images("Ghost", ["0" * 32 + ".png"]), headers=H).status_code == 422
    assert a.post("/api/admin/watches", json=with_images("Evil", ["../../etc/passwd"]), headers=H).status_code == 422
    assert a.post("/api/admin/watches", json=with_images("Five", [f"{i:032x}.png" for i in range(5)]), headers=H).status_code == 422

    # removing the photo from the watch deletes the file; the shop no longer serves it
    cid = w["colors"][0]["id"]
    a.put(f"/api/admin/watches/{w['id']}", json={**body, "colors": [{"id": cid, "name": "", "stock": 2, "images": []}]}, headers=H)
    assert client.get(up["url"]).status_code == 404
    a.delete(f"/api/admin/watches/{w['id']}", headers=H)


def upload(a) -> str:
    return a.post("/api/admin/uploads", content=PNG, headers={**H, "Content-Type": "image/png"}).json()["image"]


@pytest.fixture(scope="module")
def multi(client, shop):
    """One watch that comes in three colours, added once."""
    a = admin_session()
    p1, p2 = upload(a), upload(a)
    body = {"name": "Tri Tone", "collection": "neutral", "price_naira": 150000, "colors": [
        {"name": "Midnight", "hex": "#112233", "stock": 4, "images": [p1, p2]},
        {"name": "Sand", "hex": "#C8B79A", "stock": 2, "images": []},
        {"name": "Moss", "hex": "#4a5a2e", "stock": 0, "images": []}]}
    r = a.post("/api/admin/watches", json=body, headers=H)
    assert r.status_code == 201, r.text
    return r.json()["watch"]


def test_one_watch_has_many_colours(client, multi):
    listed = [w for w in client.get("/api/watches").json()["watches"] if w["slug"] == multi["slug"]]
    assert len(listed) == 1  # added once, listed once
    w = listed[0]
    assert [c["name"] for c in w["colors"]] == ["Midnight", "Sand", "Moss"]
    assert w["stock"] == 6 and w["in_stock"] is True
    assert w["colors"][0]["hex"] == "#112233" and w["colors"][1]["hex"] == "#c8b79a"  # normalised to lower case
    assert len(w["colors"][0]["images"]) == 2 and w["images"] == w["colors"][0]["images"]  # cover = first colour's photos
    assert w["colors"][2]["in_stock"] is False


def test_customer_must_pick_a_colour_and_stock_is_per_colour(client, multi):
    slug = multi["slug"]
    mid, sand, moss = (c["id"] for c in multi["colors"])
    pay = lambda items: client.post("/api/checkout", json={"items": items, "customer": CUSTOMER}, headers=H)
    assert pay([{"slug": slug, "qty": 1}]).status_code == 422                     # no colour chosen
    assert pay([{"slug": slug, "qty": 1, "color": moss}]).status_code == 409      # that colour is sold out
    assert pay([{"slug": slug, "qty": 3, "color": sand}]).status_code == 409      # only 2 in Sand
    assert pay([{"slug": slug, "qty": 1, "color": 999999}]).status_code == 409    # no such colour

    r = pay([{"slug": slug, "qty": 2, "color": mid}, {"slug": slug, "qty": 1, "color": sand}])
    assert r.status_code == 200, r.text
    assert initialised[-1] == 3 * 150000 * 100
    ref = r.json()["ref"]
    v = client.get(f"/api/checkout/verify?reference={ref}").json()
    assert v["paid"] is True and {(i["name"], i["color"]) for i in v["items"]} == {("Tri Tone", "Midnight"), ("Tri Tone", "Sand")}
    left = {c["name"]: c["stock"] for c in client.get(f"/api/watches/{slug}").json()["watch"]["colors"]}
    assert left == {"Midnight": 2, "Sand": 1, "Moss": 0}
    assert any(i["name"] == "Tri Tone (Midnight)" for m in sent_mail if m["kind"] == "order_confirmation" for i in m["data"]["items"])

    # cancelling puts each unit back into its own colour
    a = admin_session()
    assert a.patch(f"/api/admin/orders/{ref}/status", json={"status": "cancelled"}, headers=H).status_code == 200
    back = {c["name"]: c["stock"] for c in client.get(f"/api/watches/{slug}").json()["watch"]["colors"]}
    assert back == {"Midnight": 4, "Sand": 2, "Moss": 0}


def test_editing_colours_adds_updates_and_removes(client, multi):
    a = admin_session()
    mid, sand, _moss = (c["id"] for c in multi["colors"])
    base = {"name": "Tri Tone", "collection": "neutral", "price_naira": 150000}
    body = {**base, "colors": [{"id": sand, "name": "Sand", "hex": "#c8b79a", "stock": 9},
                               {"name": "Ink", "hex": "#000000", "stock": 3},
                               {"id": mid, "name": "Midnight", "hex": "#112233", "stock": 4}]}
    r = a.put(f"/api/admin/watches/{multi['id']}", json=body, headers=H)
    assert r.status_code == 200, r.text
    got = r.json()["watch"]
    assert [c["name"] for c in got["colors"]] == ["Sand", "Ink", "Midnight"] and got["stock"] == 16
    assert got["colors"][0]["id"] == sand and got["colors"][2]["id"] == mid  # existing colours keep their identity
    # a colour id that does not belong to this watch is refused
    bad = {**base, "colors": [{"id": 999999, "name": "Ghost", "stock": 1}]}
    assert a.put(f"/api/admin/watches/{multi['id']}", json=bad, headers=H).status_code == 422


def test_colour_validation(client, shop):
    a = admin_session()
    base = {"name": "Colour Rules", "collection": "men", "price_naira": 1000}
    post = lambda colors: a.post("/api/admin/watches", json={**base, "colors": colors}, headers=H).status_code
    assert post([]) == 422                                                                    # at least one colour
    assert post([{"name": "A", "stock": 1}, {"name": "", "stock": 1}]) == 422                 # several colours need names
    assert post([{"name": "Red", "stock": 1}, {"name": "red", "stock": 1}]) == 422            # no duplicate names
    assert post([{"name": "Red", "hex": "red", "stock": 1}]) == 422                           # swatch must be #rrggbb
    assert post([{"name": "Red", "stock": -1}]) == 422
    assert post([{"name": f"C{i}", "stock": 1} for i in range(13)]) == 422                    # at most 12
    assert post([{"name": "Red", "hex": "#FF0000", "stock": 1}]) == 201


def test_old_database_is_migrated(tmp_path):
    import sqlite3
    old = sqlite3.connect(tmp_path / "old.db")
    old.executescript("CREATE TABLE watches (id INTEGER PRIMARY KEY, name TEXT, image TEXT, stock INTEGER);"
                      "INSERT INTO watches (name, image, stock) VALUES ('Old One', 'a' || '0123456789abcdef0123456789abcde' || '.jpg', 4);")
    old.row_factory = sqlite3.Row
    db.migrate(old)
    assert old.execute("SELECT images FROM watches").fetchone()["images"] == '["a0123456789abcdef0123456789abcde.jpg"]'


def test_watches_without_colours_get_one_on_upgrade(tmp_path):
    import sqlite3
    c = sqlite3.connect(tmp_path / "pre-colours.db")
    c.row_factory = sqlite3.Row
    c.executescript(db.SCHEMA)
    c.execute("DROP TABLE watch_colors")
    c.execute("INSERT INTO watches (id,slug,name,collection,price_kobo,stock,images,created_at,updated_at) "
              "VALUES (1,'old','Old','men',100,5,'[\"a0123456789abcdef0123456789abcde.jpg\"]','t','t')")
    c.executescript(db.SCHEMA)  # recreates watch_colors, as init() does on start
    db.migrate(c)
    db.migrate(c)  # safe to run every start
    rows = c.execute("SELECT * FROM watch_colors").fetchall()
    assert len(rows) == 1 and rows[0]["stock"] == 5 and rows[0]["name"] == ""
