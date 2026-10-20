import logo128 from "../assets/logo-128.png";
import { api } from "../lib/api";
import { colorOf, colorPhoto, lineName, watchMap } from "../lib/catalog";
import { naira } from "../lib/format";
import { $, $$, h, mountHtml, raw } from "../lib/html";
import { lockScroll, toast } from "../lib/motion";
import { navigate, currentPath } from "../lib/router";
import { cartCount, removeLine, setQty, settleColors, state, subscribe } from "../lib/store";
import { themeToggle } from "../lib/theme";
import type { Watch } from "../lib/types";

const tinyClock = raw(`<img class="logo-mark" src="${logo128}" width="36" height="36" alt="" decoding="async">`);

export function renderHeader(): void {
  const user = state.user?.role === "customer" ? state.user : null; // an admin session is not shown as a customer
  const el = $("#site-header")!;
  mountHtml(el, h`
    <div class="hdr">
      <a class="logo" href="/" aria-label="Regis, home">${tinyClock}<span class="logo-word">Regis</span></a>
      <nav class="nav" aria-label="Primary">
        <a href="/collection" data-nav="/collection">Collection</a>
        <a href="/collection/men" data-nav="/collection/men">Men</a>
        <a href="/collection/women" data-nav="/collection/women">Women</a>
        <a href="/collection/neutral" data-nav="/collection/neutral">Gender neutral</a>
      </nav>
      <div class="hdr-right">
        <a class="hdr-link" href="/orders" data-nav="/orders">Orders</a>
        <a class="hdr-link" href="/account" data-nav="/account">${user ? user.name.split(" ")[0] : "Sign in"}</a>
        ${themeToggle()}
        <button class="bag" id="bag-button" type="button" aria-haspopup="dialog" aria-label="Open bag, ${cartCount()} items">
          Bag <span id="bag-count" class="bag-count">${cartCount()}</span>
        </button>
        <button class="menu-btn" id="menu-btn" type="button" aria-expanded="false" aria-controls="mobile-menu" aria-label="Menu"><span></span><span></span></button>
      </div>
    </div>
    <div class="mobile-menu" id="mobile-menu" hidden>
      <a href="/collection">Collection</a><a href="/collection/men">Men</a><a href="/collection/women">Women</a><a href="/collection/neutral">Gender neutral</a>
      <a href="/orders">Orders</a><a href="/account">${user ? "Account" : "Sign in"}</a><a href="/contact">Contact</a>
    </div>`);
  $("#bag-button")!.addEventListener("click", openDrawer);
  const btn = $("#menu-btn")!;
  const menu = $("#mobile-menu")!;
  btn.addEventListener("click", () => {
    const open = btn.getAttribute("aria-expanded") !== "true";
    btn.setAttribute("aria-expanded", String(open));
    menu.hidden = !open;
    document.body.classList.toggle("menu-open", open);
  });
  menu.addEventListener("click", () => { btn.setAttribute("aria-expanded", "false"); menu.hidden = true; document.body.classList.remove("menu-open"); });
  markActive();
}

export function markActive(): void {
  const path = currentPath().split("?")[0];
  $$("[data-nav]").forEach((a) => {
    const p = a.dataset.nav!;
    const on = p === "/collection" ? path === p : path.startsWith(p);
    if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
}

export function updateBagCount(): void {
  const n = cartCount();
  const c = $("#bag-count");
  if (c) c.textContent = String(n);
  $("#bag-button")?.setAttribute("aria-label", `Open bag, ${n} ${n === 1 ? "item" : "items"}`);
}

export function renderFooter(): void {
  const c = state.config;
  mountHtml($("#site-footer")!, h`
    <div class="ftr">
      <div class="ftr-grid">
        <div><p class="ftr-brand">Regis</p><p class="ftr-slogan">Time, by appointment.</p></div>
        <nav aria-label="Shop"><h2>Shop</h2><ul><li><a href="/collection">Collection</a></li><li><a href="/collection/men">Men</a></li><li><a href="/collection/women">Women</a></li><li><a href="/collection/neutral">Gender neutral</a></li></ul></nav>
        <nav aria-label="Help"><h2>Help</h2><ul><li><a href="/orders">Track an order</a></li><li><a href="/delivery">Delivery and returns</a></li><li><a href="/contact">Contact</a></li><li><a href="/about">About</a></li></ul></nav>
        <nav aria-label="Legal"><h2>Legal</h2><ul><li><a href="/privacy">Privacy policy</a></li><li><a href="/terms">Terms of service</a></li><li><button type="button" class="linklike" id="cookie-settings">Cookie choices</button></li></ul></nav>
      </div>
      <p class="ftr-base">&copy; ${new Date().getFullYear()} Regis. ${c?.support_email ? h`<a href="mailto:${c.support_email}">${c.support_email}</a>. ` : ""}Payments are processed by Paystack.</p>
    </div>`);
  $("#cookie-settings")?.addEventListener("click", () => { localStorage.removeItem("regis.consent"); showBanner(); });
}

// ---------------------------------------------------------------- toast helpers
export { toast };

// ------------------------------------------------------------------ drawer
let drawerOpen = false;
let lastFocus: HTMLElement | null = null;

async function drawerBody(): Promise<void> {
  const body = $("#drawer-body");
  if (!body) return;
  const map = await watchMap().catch(() => new Map<string, Watch>());
  settleColors((slug) => map.get(slug));
  const lines = state.cart.map((l) => ({ l, w: map.get(l.slug) }));
  const at = (l: { slug: string; color: number | null }) => h`data-slug="${l.slug}" data-color="${l.color ?? ""}"`;
  let total = 0;
  const items = lines.map(({ l, w }) => {
    if (!w) return h`<li class="d-item gone"><div><p class="d-name">No longer available</p><button class="linklike" ${at(l)} data-remove type="button">Remove</button></div></li>`;
    const col = colorOf(w, l.color);
    const max = Math.min(5, col.stock);
    const qty = Math.min(l.qty, Math.max(1, max));
    total += w.price_kobo * (col.in_stock ? qty : 0);
    const photo = colorPhoto(w, col);
    const ref = { slug: l.slug, color: col.id };
    const label = lineName(w, col);
    return h`<li class="d-item">
      <a class="d-art" href="/watch/${w.slug}" aria-label="${label}">${photo ? h`<img src="${photo}" alt="">` : ""}</a>
      <div class="d-info">
        <a class="d-name" href="/watch/${w.slug}">${w.name}</a>
        ${col.name ? h`<p class="d-color"><i class="sw" data-hex="${col.hex}"></i>${col.name}</p>` : ""}
        <p class="d-sub">${col.in_stock ? naira(w.price_kobo) : "Sold out"}</p>
        <div class="qty" role="group" aria-label="Quantity for ${label}">
          <button type="button" ${at(ref)} data-dec aria-label="One fewer">-</button><output>${qty}</output><button type="button" ${at(ref)} data-inc aria-label="One more" ${qty >= max ? "disabled" : ""}>+</button>
        </div>
      </div>
      <button class="d-remove" type="button" ${at(ref)} data-remove aria-label="Remove ${label}">Remove</button>
    </li>`;
  });
  mountHtml(body, state.cart.length === 0
    ? h`<div class="d-empty"><p class="section-title">Your bag is empty.</p><p>Every watch here is waiting for a wrist.</p><a class="btn" href="/collection" id="d-browse">Browse the collection</a></div>`
    : h`<ul class="d-list">${items}</ul>
        <div class="d-foot">
          <div class="d-total"><span>Total</span><strong>${naira(total)}</strong></div>
          <p class="d-note">You pay exactly the listed price. Delivery is complimentary and insured.</p>
          <a class="btn wide" href="/checkout" id="d-checkout">Checkout</a>
        </div>`);
  const lineOf = (b: HTMLElement) => {
    const color = b.dataset.color ? Number(b.dataset.color) : null;
    return { slug: b.dataset.slug!, color, entry: state.cart.find((x) => x.slug === b.dataset.slug && x.color === color) };
  };
  $$<HTMLElement>("[data-remove]", body).forEach((b) => b.addEventListener("click", () => { const { slug, color } = lineOf(b); removeLine(slug, color); }));
  $$<HTMLElement>("[data-inc]", body).forEach((b) => b.addEventListener("click", () => { const { slug, color, entry } = lineOf(b); if (entry) setQty(slug, color, entry.qty + 1); }));
  $$<HTMLElement>("[data-dec]", body).forEach((b) => b.addEventListener("click", () => { const { slug, color, entry } = lineOf(b); if (entry) { if (entry.qty <= 1) removeLine(slug, color); else setQty(slug, color, entry.qty - 1); } }));
  $$("a", body).forEach((a) => a.addEventListener("click", closeDrawer));
}

export function openDrawer(): void {
  if (drawerOpen) return;
  drawerOpen = true;
  lastFocus = document.activeElement as HTMLElement | null;
  const root = $("#drawer-root")!;
  mountHtml(root, h`
    <div class="d-scrim" id="d-scrim"></div>
    <aside class="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title" id="drawer">
      <header><h2 id="drawer-title">Your bag</h2><button type="button" id="d-close" aria-label="Close bag">Close</button></header>
      <div id="drawer-body"></div>
    </aside>`);
  lockScroll(true);
  void drawerBody().then(() => {
    requestAnimationFrame(() => root.classList.add("open"));
    ($("#d-close") as HTMLElement).focus();
  });
  $("#d-close")!.addEventListener("click", closeDrawer);
  $("#d-scrim")!.addEventListener("click", closeDrawer);
  document.addEventListener("keydown", trap);
}

function trap(e: KeyboardEvent): void {
  if (!drawerOpen) return;
  if (e.key === "Escape") { closeDrawer(); return; }
  if (e.key !== "Tab") return;
  const f = $$<HTMLElement>("#drawer a, #drawer button:not([disabled])");
  if (!f.length) return;
  const first = f[0], last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

export function closeDrawer(): void {
  if (!drawerOpen) return;
  drawerOpen = false;
  document.removeEventListener("keydown", trap);
  const root = $("#drawer-root")!;
  root.classList.remove("open");
  window.setTimeout(() => { root.innerHTML = ""; lockScroll(false); lastFocus?.focus?.(); }, 220);
}

export function initChrome(): void {
  subscribe(() => {
    updateBagCount();
    if (drawerOpen) void drawerBody();
  });
}

// ----------------------------------------------------------------- consent
export function showBanner(): void {
  if (localStorage.getItem("regis.consent")) { applyConsent(); return; }
  const analytics = !!state.config?.plausible;
  const root = $("#banner-root")!;
  mountHtml(root, h`
    <section class="banner" aria-label="Cookie notice">
      <p>${analytics
        ? "Regis uses one essential cookie to keep you signed in, and stores your bag and display choice on this device. With your permission we also count visits using privacy-friendly analytics that set no cookies."
        : "Regis uses one essential cookie to keep you signed in, and stores your bag and display choice on this device. Nothing else tracks you."} <a href="/privacy">Read more</a></p>
      <div class="banner-actions">
        ${analytics ? h`<button class="btn ghost" id="c-no" type="button">Essential only</button><button class="btn" id="c-yes" type="button">Allow analytics</button>` : h`<button class="btn" id="c-yes" type="button">Understood</button>`}
      </div>
    </section>`);
  const decide = (v: "yes" | "no") => { localStorage.setItem("regis.consent", v); root.innerHTML = ""; applyConsent(); };
  $("#c-yes")?.addEventListener("click", () => decide("yes"));
  $("#c-no")?.addEventListener("click", () => decide("no"));
}

function applyConsent(): void {
  const domain = state.config?.plausible;
  if (domain && localStorage.getItem("regis.consent") === "yes" && !document.getElementById("plausible-script")) {
    const s = document.createElement("script");
    s.id = "plausible-script";
    s.defer = true;
    s.dataset.domain = domain;
    s.src = "https://plausible.io/js/script.js";
    document.head.appendChild(s);
  }
}

export async function signOut(): Promise<void> {
  await api("POST", "/api/auth/logout");
}

export { navigate };
