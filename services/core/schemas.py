"""Request models. Anything a user can type is length-limited, stripped of control characters and validated."""
import re
from typing import Annotated, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+\-']{1,64}@[A-Za-z0-9.\-]{1,190}\.[A-Za-z]{2,24}$")
PHONE_RE = re.compile(r"^\+?[0-9][0-9\s\-]{6,18}$")
CTRL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\u2028\u2029]")

NG_STATES = [
    "Abia", "Adamawa", "Akwa Ibom", "Anambra", "Bauchi", "Bayelsa", "Benue", "Borno", "Cross River", "Delta",
    "Ebonyi", "Edo", "Ekiti", "Enugu", "FCT Abuja", "Gombe", "Imo", "Jigawa", "Kaduna", "Kano", "Katsina", "Kebbi",
    "Kogi", "Kwara", "Lagos", "Nasarawa", "Niger", "Ogun", "Ondo", "Osun", "Oyo", "Plateau", "Rivers", "Sokoto",
    "Taraba", "Yobe", "Zamfara",
]


def clean(value: str) -> str:
    return CTRL_RE.sub("", value).strip()


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


def _email(v: str) -> str:
    v = clean(v).lower()
    if len(v) > 254 or not EMAIL_RE.match(v):
        raise ValueError("Enter a valid email address.")
    return v


class Email(Strict):
    email: str

    _v = field_validator("email")(lambda cls, v: _email(v))


class RegisterIn(Strict):
    name: str = Field(min_length=2, max_length=80)
    email: str
    password: str = Field(min_length=8, max_length=128)
    phone: str = Field(default="", max_length=20)

    _e = field_validator("email")(lambda cls, v: _email(v))

    @field_validator("name")
    @classmethod
    def _n(cls, v: str) -> str:
        return clean(v)

    @field_validator("phone")
    @classmethod
    def _p(cls, v: str) -> str:
        v = clean(v)
        if v and not PHONE_RE.match(v):
            raise ValueError("Enter a valid phone number.")
        return v


class LoginIn(Strict):
    email: str
    password: str = Field(min_length=1, max_length=128)

    _e = field_validator("email")(lambda cls, v: _email(v))


class CartLine(Strict):
    slug: str = Field(min_length=1, max_length=80, pattern=r"^[a-z0-9\-]+$")
    qty: int = Field(ge=1, le=5)
    # Which colour of the watch. May be left out only for a watch that comes in a single colour.
    color: Optional[int] = Field(default=None, ge=1)


class CartIn(Strict):
    items: list[CartLine] = Field(min_length=1, max_length=20)


class Customer(Strict):
    name: str = Field(min_length=2, max_length=80)
    email: str
    phone: str
    address: str = Field(min_length=5, max_length=200)
    city: str = Field(min_length=2, max_length=80)
    state: str
    notes: str = Field(default="", max_length=300)

    _e = field_validator("email")(lambda cls, v: _email(v))

    @field_validator("name", "address", "city", "notes")
    @classmethod
    def _t(cls, v: str) -> str:
        return clean(v)

    @field_validator("phone")
    @classmethod
    def _p(cls, v: str) -> str:
        v = clean(v)
        if not PHONE_RE.match(v):
            raise ValueError("Enter a valid phone number.")
        return v

    @field_validator("state")
    @classmethod
    def _s(cls, v: str) -> str:
        if v not in NG_STATES:
            raise ValueError("Choose a state from the list.")
        return v


class CheckoutIn(Strict):
    items: list[CartLine] = Field(min_length=1, max_length=20)
    customer: Customer
    save_card: bool = False
    newsletter: bool = False
    saved_card_id: Optional[int] = Field(default=None, ge=1)


class TrackIn(Strict):
    ref: str = Field(min_length=4, max_length=24, pattern=r"^[A-Za-z0-9\-]+$")
    email: str

    _e = field_validator("email")(lambda cls, v: _email(v))


class ContactIn(Strict):
    name: str = Field(min_length=2, max_length=80)
    email: str
    message: str = Field(min_length=10, max_length=2000)

    _e = field_validator("email")(lambda cls, v: _email(v))

    @field_validator("name", "message")
    @classmethod
    def _t(cls, v: str) -> str:
        return clean(v)


IMAGE_RE = re.compile(r"^[a-f0-9]{32}\.(jpg|png|webp)$")


HEX_RE = re.compile(r"^(#[0-9A-Fa-f]{6})?$")
MAX_COLORS = 12
MAX_PHOTOS = 4


class ColorIn(Strict):
    """One colour of a watch: its name, swatch, stock and photos."""
    id: Optional[int] = Field(default=None, ge=1)  # present when editing a colour that already exists
    name: str = Field(default="", max_length=40)
    hex: str = Field(default="", max_length=7)
    stock: int = Field(ge=0, le=10_000)
    images: list[str] = Field(default_factory=list, max_length=MAX_PHOTOS)

    @field_validator("name")
    @classmethod
    def _n(cls, v: str) -> str:
        return clean(v)

    @field_validator("hex")
    @classmethod
    def _h(cls, v: str) -> str:
        if not HEX_RE.match(v):
            raise ValueError("Pick the swatch colour again.")
        return v.lower()

    @field_validator("images")
    @classmethod
    def _imgs(cls, v: list[str]) -> list[str]:
        if any(not IMAGE_RE.match(n) for n in v) or len(set(v)) != len(v):
            raise ValueError("One of the photos is not valid. Upload it again.")
        return v


class WatchIn(Strict):
    name: str = Field(min_length=2, max_length=80)
    collection: Literal["men", "women", "neutral"]
    tagline: str = Field(default="", max_length=140)
    description: str = Field(default="", max_length=2000)
    price_naira: int = Field(ge=1, le=100_000_000)
    movement: str = Field(default="", max_length=80)
    case_mm: int = Field(default=0, ge=0, le=60)  # 0 means "not given"
    case_material: str = Field(default="", max_length=80)
    strap: str = Field(default="", max_length=80)
    water_resistance: str = Field(default="", max_length=40)
    crystal: str = Field(default="", max_length=60)
    power_reserve: str = Field(default="", max_length=60)
    warranty: str = Field(default="", max_length=40)
    # The same watch in different colours or shades, added once. Price and details are shared.
    colors: list[ColorIn] = Field(min_length=1, max_length=MAX_COLORS)
    featured: bool = False
    active: bool = True

    @field_validator("name", "tagline", "description", "movement", "case_material", "strap",
                     "water_resistance", "crystal", "power_reserve", "warranty")
    @classmethod
    def _t(cls, v: str) -> str:
        return clean(v)

    @field_validator("colors")
    @classmethod
    def _colors(cls, v: list[ColorIn]) -> list[ColorIn]:
        if len(v) > 1:
            names = [c.name.lower() for c in v]
            if any(not n for n in names):
                raise ValueError("Give every colour a name.")
            if len(set(names)) != len(names):
                raise ValueError("Two colours have the same name.")
        ids = [c.id for c in v if c.id is not None]
        if len(set(ids)) != len(ids):
            raise ValueError("A colour appears twice.")
        return v


class StatusIn(Strict):
    status: Literal["processing", "out_for_delivery", "delivered", "cancelled"]


class CampaignIn(Strict):
    subject: str = Field(min_length=3, max_length=120)
    headline: str = Field(min_length=3, max_length=120)
    body: str = Field(min_length=10, max_length=3000)
    cta_label: str = Field(default="", max_length=40)
    cta_path: str = Field(default="", max_length=120, pattern=r"^(/[A-Za-z0-9\-_/]*)?$")
    test_only: bool = False

    @field_validator("subject", "headline", "body", "cta_label")
    @classmethod
    def _t(cls, v: str) -> str:
        return clean(v)


class ClientErrorIn(Strict):
    message: str = Field(max_length=300)
    where: str = Field(default="", max_length=200)
