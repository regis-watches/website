import { api } from "./api";
import type { SiteConfig, User } from "./types";

type Listener = () => void;

export interface CartEntry {
  slug: string;
  /** Colour id. Null only for a bag saved before colours existed, which is settled when the bag is shown. */
  color: number | null;
  qty: number;
}

const KEY = "regis.bag.v2";
const OLD_KEY = "regis.bag.v1"; // slug and quantity only
const listeners = new Set<Listener>();

function loadCart(): CartEntry[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? localStorage.getItem(OLD_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((x) => x && typeof x.slug === "string" && /^[a-z0-9\-]{1,80}$/.test(x.slug) && Number.isInteger(x.qty))
      .map((x) => ({
        slug: x.slug as string,
        color: Number.isInteger(x.color) && x.color > 0 ? (x.color as number) : null,
        qty: Math.min(5, Math.max(1, x.qty as number)),
      }))
      .slice(0, 20);
  } catch {
    return [];
  }
}

const same = (l: CartEntry, slug: string, color: number | null): boolean => l.slug === slug && l.color === color;

export const state = {
  cart: loadCart(),
  user: null as User | null,
  config: null as SiteConfig | null,
};

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state.cart));
  } catch {
    /* private mode: the bag just will not persist */
  }
  listeners.forEach((fn) => fn());
}

export const cartCount = (): number => state.cart.reduce((n, l) => n + l.qty, 0);

export function addToCart(slug: string, color: number | null, qty = 1): void {
  const line = state.cart.find((l) => same(l, slug, color));
  if (line) line.qty = Math.min(5, line.qty + qty);
  else state.cart.push({ slug, color, qty: Math.min(5, qty) });
  emit();
}

export const qtyInBag = (slug: string, color: number | null): number => state.cart.find((l) => same(l, slug, color))?.qty ?? 0;

export function setQty(slug: string, color: number | null, qty: number): void {
  const line = state.cart.find((l) => same(l, slug, color));
  if (!line) return;
  line.qty = Math.min(5, Math.max(1, qty));
  emit();
}

export function removeLine(slug: string, color: number | null): void {
  state.cart = state.cart.filter((l) => !same(l, slug, color));
  emit();
}

/** A bag saved before colours existed has no colour on its lines. Give each one its watch's first colour that is in stock. */
export function settleColors(lookup: (slug: string) => { colors: { id: number; in_stock: boolean }[] } | undefined): void {
  let changed = false;
  for (const l of state.cart) {
    if (l.color !== null) continue;
    const cols = lookup(l.slug)?.colors ?? [];
    const pick = cols.find((c) => c.in_stock) ?? cols[0];
    if (pick) { l.color = pick.id; changed = true; }
  }
  // two old lines may now point at the same colour: merge them
  const merged: CartEntry[] = [];
  for (const l of state.cart) {
    const twin = merged.find((m) => same(m, l.slug, l.color));
    if (twin) twin.qty = Math.min(5, twin.qty + l.qty); else merged.push(l);
  }
  if (merged.length !== state.cart.length) { state.cart = merged; changed = true; }
  if (changed) emit();
}

export function clearCart(): void {
  state.cart = [];
  emit();
}

export async function refreshUser(): Promise<void> {
  try {
    state.user = (await api<{ user: User | null }>("GET", "/api/auth/me")).user;
  } catch {
    state.user = null;
  }
  listeners.forEach((fn) => fn());
}

export function setUser(u: User | null): void {
  state.user = u;
  listeners.forEach((fn) => fn());
}
