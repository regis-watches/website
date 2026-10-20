import { ApiError, api } from "../lib/api";
import { dateTime, naira } from "../lib/format";
import { $, $$, h, mountHtml, SafeHtml } from "../lib/html";
import { toast } from "../lib/motion";
import { navigate } from "../lib/router";
import type { PageResult } from "../lib/router";
import { setUser, state } from "../lib/store";
import type { OrderStatus, OrderView, SavedCard, User } from "../lib/types";
import { renderHeader } from "../ui/chrome";

const STEPS: { key: OrderStatus; label: string; note: string }[] = [
  { key: "processing", label: "Order Processing", note: "Payment received. We are preparing your watch." },
  { key: "out_for_delivery", label: "Out for Delivery", note: "On its way to you." },
  { key: "delivered", label: "Delivered", note: "In your hands." },
];

export function tracker(o: OrderView): SafeHtml {
  const at = (s: OrderStatus) => o.events.find((e) => e.status === s)?.at ?? null;
  const idx = STEPS.findIndex((s) => s.key === o.status);
  const pct = o.status === "cancelled" ? 0 : Math.max(0, idx) * 50;
  return h`
    <article class="order" data-pct="${pct}">
      <header class="order-head">
        <div><p class="eyebrow">Order</p><h3 class="order-ref">${o.ref}</h3></div>
        <div class="order-total"><span>${naira(o.total_kobo)}</span><small>${o.paid_at ? "Paid " + dateTime(o.paid_at) : ""}</small></div>
      </header>
      ${o.status === "cancelled" ? h`<p class="cancelled" role="status">${o.status_message}</p>` : h`
      <ol class="track" aria-label="Order progress">
        <span class="track-line" aria-hidden="true"><span class="track-fill"></span></span>
        ${STEPS.map((s, i) => h`<li class="${i < idx ? "done" : i === idx ? "current" : "todo"}" ${i === idx ? 'aria-current="step"' : ""}>
          <span class="dot" aria-hidden="true"></span><strong>${s.label}</strong><small>${at(s.key) ? dateTime(at(s.key)) : i === idx ? "Now" : "Not yet"}</small>${i === idx ? h`<em>${s.note}</em>` : ""}</li>`)}
      </ol>`}
      <ul class="order-items">${o.items.map((i) => h`<li><span>${i.name}${i.color ? h` <small>${i.color}</small>` : ""} <small>x ${i.qty}</small></span><span>${naira(i.unit_price_kobo * i.qty)}</span></li>`)}</ul>
      <p class="order-to">Delivering to ${o.city}, ${o.state}</p>
    </article>`;
}

export function animateTrackers(root: ParentNode): void {
  $$<HTMLElement>(".order", root).forEach((o) => {
    const fill = $(".track-fill", o);
    if (fill) fill.style.width = `${Number(o.dataset.pct ?? 0)}%`;
  });
}

export async function orders(_: Record<string, string>, q: URLSearchParams): Promise<PageResult> {
  const user = state.user;
  const mine = user ? (await api<{ orders: OrderView[] }>("GET", "/api/me/orders").catch(() => ({ orders: [] as OrderView[] }))).orders : [];
  const prefill = (q.get("ref") ?? "").replace(/[^A-Za-z0-9\-]/g, "").slice(0, 24);
  return {
    title: "Track your order | Regis",
    html: h`
    <section class="page orders">
      <header class="coll-head"><p class="eyebrow">Orders</p><h1 class="title">Where is my watch?</h1></header>
      ${mine.length ? h`<section aria-labelledby="mine-h"><h2 id="mine-h" class="section-title">Your orders</h2><div class="order-list">${mine.map(tracker)}</div></section>` : ""}
      <section class="lookup" aria-labelledby="look-h">
        <h2 id="look-h" class="section-title">${mine.length ? "Look up another order" : "Find your order"}</h2>
        <p class="lede small">Enter the order number from your receipt and the email you used at checkout.</p>
        <form id="track-form" class="track-form" novalidate>
          <div class="field"><label for="t-ref">Order number</label><input id="t-ref" name="ref" value="${prefill}" placeholder="RG-ABCD2345" maxlength="24" autocomplete="off" required></div>
          <div class="field"><label for="t-email">Email</label><input id="t-email" name="email" type="email" value="${user?.email ?? ""}" autocomplete="email" maxlength="254" required></div>
          <button class="btn" type="submit">Track order</button>
          <p class="err" id="t-err" role="alert"></p>
        </form>
        <div id="t-result" aria-live="polite"></div>
      </section>
    </section>`,
    mount(root) {
      animateTrackers(root);
      const form = $<HTMLFormElement>("#track-form", root)!;
      const out = $("#t-result", root)!;
      const err = $("#t-err", root)!;
      const run = async () => {
        err.textContent = "";
        const ref = ($<HTMLInputElement>("#t-ref", root)!.value || "").trim().toUpperCase();
        const email = ($<HTMLInputElement>("#t-email", root)!.value || "").trim();
        try {
          const r = await api<{ order: OrderView }>("POST", "/api/orders/track", { ref, email });
          mountHtml(out, tracker(r.order));
          animateTrackers(out);
        } catch (e) {
          out.innerHTML = "";
          err.textContent = e instanceof ApiError ? (e.status === 422 ? "Check the order number and email, then try again." : e.message) : "Something went wrong.";
        }
      };
      form.addEventListener("submit", (e) => { e.preventDefault(); void run(); });
      if (prefill && state.user) { /* signed-in users already see it above */ }
    },
  };
}

export async function account(_: Record<string, string>, q: URLSearchParams): Promise<PageResult> {
  const next = q.get("next") && /^\/[A-Za-z0-9\-_/]*$/.test(q.get("next")!) ? q.get("next")! : "";
  const user = state.user;
  if (!user || user.role !== "customer") {
    return {
      title: "Your account | Regis",
      html: h`
      <section class="page narrow auth">
        <p class="eyebrow">Account</p><h1 class="title">Sign in, or join.</h1>
        <p class="lede small">An account lets you see every order in one place and, if you choose, save a card with Paystack for faster checkout. You can always buy as a guest.</p>
        <div class="tabs" role="tablist"><button role="tab" id="tab-in" aria-selected="true" aria-controls="p-in">Sign in</button><button role="tab" id="tab-up" aria-selected="false" aria-controls="p-up">Create account</button></div>
        <form id="p-in" class="stack" novalidate role="tabpanel" aria-labelledby="tab-in">
          <div class="field"><label for="li-email">Email</label><input id="li-email" name="email" type="email" autocomplete="email" required maxlength="254"></div>
          <div class="field"><label for="li-pass">Password</label><input id="li-pass" name="password" type="password" autocomplete="current-password" required maxlength="128"></div>
          <p class="err" id="li-err" role="alert"></p><button class="btn wide" type="submit">Sign in</button>
        </form>
        <form id="p-up" class="stack" novalidate role="tabpanel" aria-labelledby="tab-up" hidden>
          <div class="field"><label for="su-name">Full name</label><input id="su-name" name="name" autocomplete="name" required maxlength="80"></div>
          <div class="field"><label for="su-email">Email</label><input id="su-email" name="email" type="email" autocomplete="email" required maxlength="254"></div>
          <div class="field"><label for="su-phone">Phone (optional)</label><input id="su-phone" name="phone" type="tel" autocomplete="tel" maxlength="20"></div>
          <div class="field"><label for="su-pass">Password</label><input id="su-pass" name="password" type="password" autocomplete="new-password" minlength="8" required maxlength="128"><p class="hint">At least 8 characters.</p></div>
          <p class="err" id="su-err" role="alert"></p><button class="btn wide" type="submit">Create account</button>
        </form>
      </section>`,
      mount(root) {
        const tabs = [["tab-in", "p-in"], ["tab-up", "p-up"]] as const;
        tabs.forEach(([t]) => $(`#${t}`, root)!.addEventListener("click", () => tabs.forEach(([tt, pp]) => { const on = tt === t; $(`#${tt}`, root)!.setAttribute("aria-selected", String(on)); ($(`#${pp}`, root) as HTMLElement).hidden = !on; })));
        const submit = (id: string, path: string, errId: string) => $<HTMLFormElement>(`#${id}`, root)!.addEventListener("submit", async (e) => {
          e.preventDefault();
          const f = e.currentTarget as HTMLFormElement;
          const err = $(`#${errId}`, root)!;
          err.textContent = "";
          const body = Object.fromEntries(new FormData(f).entries());
          try {
            const r = await api<{ user: User }>("POST", path, body);
            setUser(r.user);
            renderHeader();
            toast(`Welcome, ${r.user.name.split(" ")[0]}.`);
            navigate(next || "/account");
          } catch (ex) { err.textContent = ex instanceof ApiError ? ex.message : "Something went wrong."; }
        });
        submit("p-in", "/api/auth/login", "li-err");
        submit("p-up", "/api/auth/register", "su-err");
      },
    };
  }
  const [my, cards] = await Promise.all([
    api<{ orders: OrderView[] }>("GET", "/api/me/orders").then((r) => r.orders).catch(() => [] as OrderView[]),
    api<{ cards: SavedCard[] }>("GET", "/api/me/cards").then((r) => r.cards).catch(() => [] as SavedCard[]),
  ]);
  return {
    title: "Your account | Regis",
    html: h`
    <section class="page orders">
      <header class="coll-head"><p class="eyebrow">Account</p><h1 class="title">Hello, ${user.name.split(" ")[0]}.</h1><p class="lede small">${user.email}</p></header>
      <section aria-labelledby="o-h"><h2 id="o-h" class="section-title">Orders</h2>${my.length ? h`<div class="order-list">${my.map(tracker)}</div>` : h`<p>No orders yet. <a href="/collection">Choose a watch.</a></p>`}</section>
      <section class="lookup" aria-labelledby="c-h"><h2 id="c-h" class="section-title">Saved cards</h2>
        ${cards.length ? h`<ul class="cards-list">${cards.map((c) => h`<li><span><strong>${c.brand.trim() || "Card"} ending ${c.last4}</strong><small>Expires ${c.exp_month}/${c.exp_year}</small></span><button class="linklike" type="button" data-del="${c.id}">Remove</button></li>`)}</ul>` : h`<p>You have no saved cards. You can choose to save one at checkout.</p>`}
      </section>
      <p><button class="btn ghost" id="logout" type="button">Sign out</button></p>
    </section>`,
    mount(root) {
      animateTrackers(root);
      $("#logout", root)!.addEventListener("click", async () => { await api("POST", "/api/auth/logout"); setUser(null); renderHeader(); toast("You are signed out."); navigate("/"); });
      $$<HTMLElement>("[data-del]", root).forEach((b) => b.addEventListener("click", async () => { await api("DELETE", `/api/me/cards/${b.dataset.del}`); toast("Card removed."); navigate("/account", true); window.location.reload(); }));
    },
  };
}
