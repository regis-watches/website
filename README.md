# Regis. Time, by appointment.

A complete watch shop: customers browse, view, pay with Paystack and track their order. The owner runs the
catalogue, orders, newsletter and sales reports from a private admin. The shop has a light and a dark theme. Built with five languages, each doing
the job it is best at.

| Part | Language | What it does |
|---|---|---|
| `web/` | **TypeScript** | The storefront and admin console (Vite). No UI framework, no Tailwind, no animation library. |
| `services/core/` | **Python** (FastAPI) | Catalogue, accounts, orders, admin API, security, SEO pages. Serves the site. |
| `services/payments/` | **Rust** (axum) | The only process that holds the Paystack secret key. Starts payments, verifies them, checks webhook signatures, charges saved cards. |
| `services/analytics/` | **Java** (JDK only) | Turns paid orders into sales and revenue per day, week and month, in Lagos time. |
| `services/mailer/` | **C#** (.NET 8) | Order, status, welcome and newsletter emails over SMTP. |

The three small services listen on `127.0.0.1` only and need a shared secret, so only the Python core can talk to them.

## Run it (about 5 minutes)

You need: Python 3.11+, Node 20+, Rust (rustup.rs), .NET 8 SDK, JDK 17+.
Four small processes run together. They use roughly 250 MB of RAM in total, so an 8 GB laptop is fine.

```
pip install -r services/core/requirements.txt
copy .env.example .env          (macOS and Linux: cp .env.example .env)
```

Edit `.env`: set `ADMIN_EMAIL` and a long `ADMIN_PASSWORD` (12+ characters). Then:

```
python scripts/dev.py
```

It builds everything and starts the stack. Open http://localhost:8000. The admin is at http://localhost:8000/admin.
Next time use `python scripts/dev.py --no-build`.

**The shop starts empty.** The catalogue pages show empty spaces marked "Coming soon". Sign in to the admin, open
Catalogue, click **Add a watch**, fill in the name and price, then add its colours (see below) and save. The watch takes
the first empty space in the shop straight away. Photos are resized in your browser first, so phone photos upload quickly.

## One watch, many colours

A watch that comes in five colours or shades is added **once**. In the form, the *Colours, photos and stock* section has one
card per colour. Each card has:

* a **name** (for example Midnight, Sand) and a **swatch** colour,
* its own **stock** count,
* its own **photos**, up to 4 (the first is the main photo for that colour).

Click **Add another colour** for each one, up to 12. Price, description and details are shared by all colours. If the watch
comes in a single colour, leave the name blank and customers see no colour picker.

On the watch page customers pick a colour from round swatches. The photos, the stock line and the Add to bag button follow
the chosen colour, and a sold-out colour is crossed out but still viewable. Catalogue cards show small colour dots. The bag,
checkout, order emails, tracking page and the admin Orders page all name the colour. Stock is counted per colour: paying takes
one unit from that colour, and cancelling an order puts it back into the same colour. Removing a colour in the admin never
changes past orders, which keep the colour name they were bought with.

Watches made before colours existed are upgraded automatically on start: each gets one unnamed colour that keeps its photos
and stock. Bags saved in a customer's browser before the upgrade are settled to the first colour in stock.

## Dark mode

A moon and sun button in the header (and in the admin sidebar and admin sign-in page) switches between light and dark on every
page. The choice is kept on the visitor's device. Until they choose, the site follows their device setting. The theme is applied
before the first paint by `web/public/theme.js`, so there is no flash. It is a separate file because the Content Security Policy
forbids inline scripts. The dark colours are the `:root[data-theme="dark"]` block at the top of `web/src/styles/main.css`.

With no Paystack key, payments run in **test mode** with a built-in fake checkout page, so you can try the whole
flow offline. With no SMTP settings, emails are saved as HTML files in `data/outbox/` so you can open and read them.

## How the money works

* The customer is charged **exactly the listed price**. Nothing is added for card, handling or delivery.
* Paystack's fee is taken from your side at settlement (`bearer: account`).
* After each payment, Paystack reports the real fee. Regis stores it, so every order shows
  *customer paid*, *Paystack fee* and *you receive*. A 20,000 watch with a 200 fee shows 20,000 paid and 19,800 received.
* Prices are re-read from the database on the server. The browser can never set or change a price.
* Amounts are integer kobo everywhere. No floating point touches money.

## Going live checklist

1. In `.env`: `APP_ENV=production`, `SITE_URL=https://your-domain`, a 48+ character `INTERNAL_TOKEN`, your **live** `PAYSTACK_SECRET_KEY`, and real SMTP settings (any provider: Brevo, Zoho, Gmail app password, SES).
2. Set `SUPPORT_EMAIL` (defaults to `inbox.regis@gmail.com`), `SUPPORT_PHONE` and `SUPPORT_WHATSAPP`. They appear on the contact page and legal pages.
3. In the Paystack dashboard set the webhook URL to `https://your-domain/api/paystack/webhook`.
4. Run the stack on a server you control (a small VPS is enough). It cannot run on Vercel, Netlify or other static or
   serverless hosts, because it runs four long-lived processes and keeps its database and photo uploads on disk. Put a
   reverse proxy with HTTPS in front of port 8000. With Caddy it is two lines: `your-domain { reverse_proxy 127.0.0.1:8000 }`. In production, cookies become `Secure` and HSTS is sent.
5. Add your real watches in the admin (Catalogue), each with its colours and photos. There are no sample watches. Photos are stored in `data/uploads`, which the backup script includes.
6. Have a Nigerian lawyer read Privacy, Terms and Delivery and returns (in `web/src/pages/static.ts`) and adjust them to how you really operate.
7. Schedule `python scripts/backup.py` daily and copy `data/backups` off the machine. Restore with `python scripts/backup.py --restore FILE`.
8. Point UptimeRobot (free) at `https://your-domain/healthz`. It reports 503 if any of the four services is down.
9. Optional: set `SENTRY_DSN` (and `pip install sentry-sdk`) for error alerts, and `PLAUSIBLE_DOMAIN` for privacy-friendly analytics, loaded only after a visitor agrees.
10. Keep a separate `.env` and database for development and production. `APP_ENV` is part of the database file name, so they cannot mix.

## Security notes

* No secrets in the browser or the repository. `.env` is git-ignored. Only the Rust service reads the Paystack key.
* Every admin endpoint checks the session and role on the server. Hidden buttons are not the protection.
* Passwords use scrypt. Sessions are random tokens stored hashed, in `HttpOnly`, `SameSite=Lax` cookies.
* State-changing requests must come from the same origin and carry a custom header (CSRF defence).
* All input is validated (length, type, format). Unknown fields are rejected. The front end escapes all output.
* Strict Content Security Policy, `X-Frame-Options`, `nosniff`, referrer and permissions policies.
* Rate limits on sign in, sign up, checkout, order lookup, newsletter, contact and campaigns.
* Webhooks are authenticated by Paystack's HMAC-SHA512 signature (constant-time compare), then re-verified with Paystack.
* Saved cards are Paystack tokens, saved only if the customer ticks the box.
* Uploaded photos are checked by their real file signature, size-capped and renamed.

## Tests

```
cd services/core && python -m pytest -q                            # Python
cd services/payments && cargo test                                 # Rust
cd services/analytics && java -cp out ng.regis.analytics.SelfTest  # Java
cd web && npm run typecheck                                        # TypeScript
```

## Design

Forest ink and warm ivory paper, with a restrained brass accent, in light and dark. All colours are variables at the top of
`web/src/styles/main.css` (and `Templates.cs` for emails). The site is deliberately quiet: one soft fade between pages, a
drawer that slides, and a plain clock on the home page that tells Lagos time. There are no drawn watches. Every watch is shown
through the owner's photos.

## Upgrading an older copy

An older database (made when the shop used drawn watches) is migrated automatically on start: each watch keeps its
single photo, and the old drawing fields are simply ignored. Delete any old sample watches in the admin, or start
fresh by deleting the `data` folder (this also removes orders).

## The logo

The brand artwork is kept in `brand/regis-logo-original.png`. To rebuild the site's logo from it:

```
pip install pillow numpy fonttools
python scripts/make_logo.py      # cuts web/public/logo.png (the compass badge) and brand/regis-wordmark.png
python scripts/make_assets.py    # rebuilds the favicons, app icon and social share image (run `npm install` in web/ once first)
```

To use different artwork, replace `brand/regis-logo-original.png` (or just `web/public/logo.png`, a square with transparent
corners) and run the same commands. The header and footer set the name in wide-spaced capitals to match the logo.

## Honest limits

* Until Paystack reports a fee for a payment, Regis estimates it (1.5% + 100, flat part waived under 2,500, capped at 2,000).
  Real reported fees replace the estimate. Adjust it with the `PAYSTACK_FEE_*` settings if your pricing differs.
* Cancelling an order in the admin restocks the watch and emails the customer. The refund itself is done in your Paystack dashboard.
* In-memory rate limiting suits one server process. If you ever run several, move it to Redis.
#   w e b s i t e  
 #   w e b s i t e  
 