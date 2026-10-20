"""Serves the single-page app with per-route SEO tags, plus sitemap.xml and robots.txt."""
import html
import json
import re

import config
import db

SLOGAN = "Time, by appointment."
DESC_DEFAULT = ("Regis is a considered watch house in Nigeria. Browse wristwatches for men, women and everyone, "
                "paid securely through Paystack and delivered to your door.")

STATIC_META = {
    "/": ("Regis | Time, by appointment.", DESC_DEFAULT),
    "/collection": ("The Collection | Regis", "Every Regis wristwatch in one place. Automatic, quartz and hand-wound, for men, women and gender neutral wear."),
    "/collection/men": ("Watches for Men | Regis", "Automatic, chronograph and dress watches for men, with insured delivery across Nigeria."),
    "/collection/women": ("Watches for Women | Regis", "Delicate, bold and everyday watches for women, with insured delivery across Nigeria."),
    "/collection/neutral": ("Gender Neutral Watches | Regis", "Watches cut for any wrist. Designed without a label, worn by anyone."),
    "/orders": ("Track your order | Regis", "Follow your Regis order from processing to delivery."),
    "/account": ("Your account | Regis", "Sign in to see your orders and manage saved cards."),
    "/contact": ("Contact | Regis", "Talk to the Regis team about an order, a watch or a repair."),
    "/privacy": ("Privacy Policy | Regis", "How Regis collects, uses and protects your personal data."),
    "/terms": ("Terms of Service | Regis", "The terms that apply when you shop with Regis."),
    "/delivery": ("Delivery and Returns | Regis", "How Regis delivers across Nigeria, and how returns and warranty work."),
    "/checkout": ("Checkout | Regis", "Complete your order securely with Paystack."),
    "/about": ("About Regis | Regis", "Why Regis exists, and what time by appointment means."),
}
NOINDEX = ("/checkout", "/checkout/complete", "/account", "/orders", "/admin", "/unsubscribed")

_template_cache: dict = {}


def _template() -> str:
    f = config.WEB_DIST / "index.html"
    if not f.exists():
        return ("<!doctype html><html lang=en><head><meta charset=utf-8><!--@META@--></head><body>"
                "<p>The web app has not been built yet. Run <code>npm run build</code> in /web.</p></body></html>")
    mtime = f.stat().st_mtime
    if _template_cache.get("m") != mtime:
        _template_cache.update(m=mtime, t=f.read_text(encoding="utf-8"))
    return _template_cache["t"]


def _meta(title: str, desc: str, path: str, image: str = "/og.png", noindex: bool = False, jsonld=None) -> str:
    e = html.escape
    url = f"{config.SITE_URL}{path}"
    parts = [
        f"<title>{e(title)}</title>",
        f'<meta name="description" content="{e(desc, quote=True)}">',
        f'<link rel="canonical" href="{e(url, quote=True)}">',
        '<meta name="robots" content="noindex,nofollow">' if noindex else '<meta name="robots" content="index,follow,max-image-preview:large">',
        '<meta property="og:site_name" content="Regis">',
        '<meta property="og:type" content="website">',
        f'<meta property="og:title" content="{e(title, quote=True)}">',
        f'<meta property="og:description" content="{e(desc, quote=True)}">',
        f'<meta property="og:url" content="{e(url, quote=True)}">',
        f'<meta property="og:image" content="{e(config.SITE_URL + image, quote=True)}">',
        '<meta name="twitter:card" content="summary_large_image">',
        f'<meta name="twitter:title" content="{e(title, quote=True)}">',
        f'<meta name="twitter:description" content="{e(desc, quote=True)}">',
        f'<meta name="twitter:image" content="{e(config.SITE_URL + image, quote=True)}">',
    ]
    if jsonld:
        # Escape "<" so JSON can never close the script tag.
        parts.append('<script type="application/ld+json">' + json.dumps(jsonld).replace("<", "\\u003c") + "</script>")
    return "\n    ".join(parts)


def render(path: str) -> tuple[str, int]:
    path = "/" + path.strip("/") if path.strip("/") else "/"
    status, jsonld, image = 200, None, "/og.png"
    m = re.fullmatch(r"/watch/([a-z0-9\-]{1,80})", path)
    if m:
        r = db.conn().execute("SELECT * FROM watches WHERE slug=? AND active=1", (m.group(1),)).fetchone()
        if r:
            title = f"{r['name']} | Regis"
            desc = (r["tagline"] + " " + r["description"])[:155].strip()
            photos = json.loads(r["images"] or "[]")
            img = f"/uploads/{photos[0]}" if photos else "/og.png"
            image = img
            jsonld = {
                "@context": "https://schema.org", "@type": "Product", "name": r["name"], "description": r["description"],
                "brand": {"@type": "Brand", "name": "Regis"}, "category": "Wristwatches",
                "image": config.SITE_URL + img,
                "offers": {"@type": "Offer", "priceCurrency": "NGN", "price": str(r["price_kobo"] // 100),
                           "availability": "https://schema.org/InStock" if r["stock"] > 0 else "https://schema.org/OutOfStock",
                           "url": f"{config.SITE_URL}{path}"},
            }
        else:
            title, desc, status = "Watch not found | Regis", "This watch is no longer in the collection.", 404
    elif path in STATIC_META:
        title, desc = STATIC_META[path]
    elif path == "/admin" or path.startswith("/admin/"):
        title, desc = "Regis Admin", "Private."
    elif path in ("/checkout/complete", "/unsubscribed"):
        title, desc = "Regis", DESC_DEFAULT
    else:
        title, desc, status = "Page not found | Regis", "That page does not exist.", 404
    if path == "/":
        jsonld = {"@context": "https://schema.org", "@type": "Organization", "name": "Regis", "url": config.SITE_URL,
                  "slogan": SLOGAN, "logo": f"{config.SITE_URL}/logo-512.png"}
    noindex = status == 404 or path.startswith("/admin") or path in NOINDEX
    page = _template().replace("<!--@META@-->", _meta(title, desc, path, image, noindex, jsonld))
    return page, status


def sitemap() -> str:
    urls = ["/", "/collection", "/collection/men", "/collection/women", "/collection/neutral", "/about", "/contact",
            "/delivery", "/privacy", "/terms"]
    for r in db.conn().execute("SELECT slug FROM watches WHERE active=1 ORDER BY id"):
        urls.append(f"/watch/{r['slug']}")
    body = "".join(f"<url><loc>{html.escape(config.SITE_URL + u)}</loc></url>" for u in urls)
    return f'<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{body}</urlset>'


def robots() -> str:
    return (f"User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\nDisallow: /checkout\n"
            f"Sitemap: {config.SITE_URL}/sitemap.xml\n")
