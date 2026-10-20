"""Runtime configuration. Everything secret comes from environment variables."""
import os
import secrets
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
ROOT_DIR = BASE_DIR.parent.parent


def _load_dotenv() -> None:
    env_file = ROOT_DIR / ".env"
    if not env_file.exists():
        return
    for line in env_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


_load_dotenv()


def env(name: str, default: str = "") -> str:
    return os.environ.get(name, default)


APP_ENV = env("APP_ENV", "development")  # development | production
IS_PROD = APP_ENV == "production"
SITE_URL = env("SITE_URL", "http://localhost:8000").rstrip("/")
DB_PATH = Path(env("DB_PATH", str(ROOT_DIR / "data" / f"regis-{APP_ENV}.db")))
UPLOAD_DIR = Path(env("UPLOAD_DIR", str(ROOT_DIR / "data" / "uploads")))
WEB_DIST = Path(env("WEB_DIST", str(ROOT_DIR / "web" / "dist")))

PAYMENTS_URL = env("PAYMENTS_URL", "http://127.0.0.1:8101")
ANALYTICS_URL = env("ANALYTICS_URL", "http://127.0.0.1:8102")
MAILER_URL = env("MAILER_URL", "http://127.0.0.1:8103")
INTERNAL_TOKEN = env("INTERNAL_TOKEN", "")

ADMIN_EMAIL = env("ADMIN_EMAIL", "").lower()
ADMIN_PASSWORD = env("ADMIN_PASSWORD", "")

SUPPORT_EMAIL = env("SUPPORT_EMAIL", "").strip() or "inbox.regis@gmail.com"
SUPPORT_PHONE = env("SUPPORT_PHONE", "")
SUPPORT_WHATSAPP = env("SUPPORT_WHATSAPP", "")
BUSINESS_NAME = env("BUSINESS_NAME", "Regis")

PLAUSIBLE_DOMAIN = env("PLAUSIBLE_DOMAIN", "")
SENTRY_DSN = env("SENTRY_DSN", "")

SESSION_DAYS = 14
ADMIN_SESSION_HOURS = 8
COOKIE_SECURE = IS_PROD

if IS_PROD and len(INTERNAL_TOKEN) < 32:
    raise SystemExit("INTERNAL_TOKEN must be set to 32+ random characters in production.")
if not INTERNAL_TOKEN:
    # Development convenience only. Services started by scripts share the .env token.
    INTERNAL_TOKEN = "dev-internal-token-change-me-0000000000"

# Paystack pricing used ONLY for the estimate shown before Paystack reports the real fee.
FEE_PERCENT_BP = int(env("PAYSTACK_FEE_BP", "150"))      # 1.5 percent in basis points
FEE_FLAT_KOBO = int(env("PAYSTACK_FEE_FLAT_KOBO", "10000"))  # N100
FEE_WAIVE_BELOW_KOBO = int(env("PAYSTACK_FEE_WAIVE_BELOW_KOBO", "250000"))  # N2,500
FEE_CAP_KOBO = int(env("PAYSTACK_FEE_CAP_KOBO", "200000"))  # N2,000

random_dev_secret = secrets.token_urlsafe(24)
