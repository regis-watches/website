import { ApiError, api } from "../lib/api";
import { colorOf, colorPhoto, watchMap } from "../lib/catalog";
import { clearCart, removeLine, settleColors, state } from "../lib/store";
import { naira } from "../lib/format";
import { $, $$, h } from "../lib/html";
import { scrollToEl } from "../lib/motion";
import { navigate } from "../lib/router";
import type { PageResult } from "../lib/router";
import type { SavedCard, Watch, WatchColor } from "../lib/types";

const PHONE = /^\+?[0-9][0-9\s\-]{6,18}$/;
const EMAIL = /^[^\s@]{1,64}@[^\s@]+\.[A-Za-z]{2,24}$/;

const field = (id: string, label: string, opts: { type?: string; auto?: string; value?: string; max?: number; req?: boolean; hint?: string } = {}) => h`
  <div class="field"><label for="${id}">${label}</label>
    <input id="${id}" name="${id}" type="${opts.type ?? "text"}" autocomplete="${opts.auto ?? "off"}" value="${opts.value ?? ""}" maxlength="${opts.max ?? 120}" ${opts.req === false ? "" : "required"} aria-describedby="${id}-err">
    ${opts.hint ? h`<p class="hint">${opts.hint}</p>` : ""}<p class="err" id="${id}-err" role="alert"></p></div>`;

export async function checkout(): Promise<PageResult> {
  const map = await watchMap();
  settleColors((slug) => map.get(slug));
  const gone = state.cart.filter((l) => !map.has(l.slug));
  gone.forEach((l) => removeLine(l.slug, l.color));
  const lines = state.cart.flatMap((l) => {
    const w = map.get(l.slug);
    return w ? [{ l, w, col: colorOf(w, l.color) }] : [];
  }) as { l: { slug: string; color: number | null; qty: number }; w: Watch; col: WatchColor }[];
  const usable = lines.filter(({ l, col }) => col.in_stock && col.stock >= 1 && l.qty >= 1);
  const qtyOf = ({ l, col }: { l: { qty: number }; col: WatchColor }) => Math.min(l.qty, col.stock);
  const total = usable.reduce((n, x) => n + x.w.price_kobo * qtyOf(x), 0);
  const user = state.user;
  const cards = user ? (await api<{ cards: SavedCard[] }>("GET", "/api/me/cards").catch(() => ({ cards: [] as SavedCard[] }))).cards : [];
  const states = state.config?.states ?? [];

  if (!usable.length) {
    return { title: "Checkout | Regis", html: h`<section class="page narrow"><p class="eyebrow">Checkout</p><h1 class="title">Your bag is empty.</h1><p class="lede">Choose a watch first, then come back here to pay.</p><a class="btn" href="/collection">Browse the collection</a></section>` };
  }

  return {
    title: "Checkout | Regis",
    html: h`
    <section class="page checkout">
      <header class="coll-head"><p class="eyebrow">Checkout</p><h1 class="title">Your details.</h1></header>
      <div class="co-grid">
        <form id="co-form" class="co-form" novalidate>
          <p class="form-error" id="form-error" role="alert" tabindex="-1"></p>
          <fieldset><legend>Contact</legend>
            <div class="row2">${field("name", "Full name", { auto: "name", value: user?.name ?? "", max: 80 })}${field("phone", "Phone number", { type: "tel", auto: "tel", value: user?.phone ?? "", max: 20, hint: "The courier will call this number." })}</div>
            ${field("email", "Email address", { type: "email", auto: "email", value: user?.email ?? "", max: 254, hint: "Your receipt and order updates go here." })}
          </fieldset>
          <fieldset><legend>Delivery</legend>
            ${field("address", "Street address", { auto: "street-address", max: 200 })}
            <div class="row2">${field("city", "City or town", { auto: "address-level2", max: 80 })}
              <div class="field"><label for="state">State</label><select id="state" name="state" autocomplete="address-level1" required aria-describedby="state-err"><option value="">Choose a state</option>${states.map((s) => h`<option value="${s}">${s}</option>`)}</select><p class="err" id="state-err" role="alert"></p></div></div>
            ${field("notes", "Delivery notes (optional)", { max: 300, req: false, hint: "A landmark, a gate code, a better time to call." })}
          </fieldset>
          <fieldset><legend>Payment</legend>
            ${cards.length ? h`<div class="cards" role="radiogroup" aria-label="Saved cards">
              ${cards.map((c, i) => h`<label class="card-opt"><input type="radio" name="pay" value="${c.id}" ${i === 0 ? "checked" : ""}><span><strong>${c.brand.trim() || "Card"} ending ${c.last4}</strong><small>Expires ${c.exp_month}/${c.exp_year}${c.bank ? ", " + c.bank : ""}</small></span></label>`)}
              <label class="card-opt"><input type="radio" name="pay" value="new" ${cards.length ? "" : "checked"}><span><strong>Use a different card</strong><small>You will enter it on Paystack's secure page.</small></span></label></div>`
              : h`<p class="pay-note">You will pay on Paystack's secure page. Cards, bank transfer and USSD are all available there.</p>`}
            ${user ? h`<label class="check" id="save-wrap"><input type="checkbox" id="save_card"><span>Save my card for next time. Paystack stores it, not us.</span></label>`
              : h`<p class="pay-note small"><a href="/account?next=/checkout">Sign in or create an account</a> if you would like to save your card, and to see all your orders in one place.</p>`}
          </fieldset>
          <label class="check"><input type="checkbox" id="newsletter"><span>Send me news of new pieces and restocks. Unsubscribe any time.</span></label>
          <p class="legal-line">By paying you agree to our <a href="/terms">terms</a> and <a href="/delivery">delivery and returns</a> policy.</p>
          <button class="btn big wide" id="pay-btn" type="submit">Pay ${naira(total)} securely</button>
        </form>
        <aside class="co-summary" aria-labelledby="sum-h">
          <h2 id="sum-h" class="section-title">Your bag</h2>
          <ul>${usable.map((x) => h`<li><span class="s-art">${colorPhoto(x.w, x.col) ? h`<img src="${colorPhoto(x.w, x.col)}" alt="">` : ""}</span><span class="s-name">${x.w.name}<small>${x.col.name ? h`<i class="sw" data-hex="${x.col.hex}"></i>${x.col.name}, ` : ""}Quantity ${qtyOf(x)}</small></span><span class="s-price">${naira(x.w.price_kobo * qtyOf(x))}</span></li>`)}</ul>
          <dl class="sum-lines"><div><dt>Subtotal</dt><dd>${naira(total)}</dd></div><div><dt>Delivery, insured</dt><dd>Free</dd></div><div class="grand"><dt>You pay</dt><dd>${naira(total)}</dd></div></dl>
          <p class="d-note">That is the whole price. We never add card or handling charges on top.</p>
        </aside>
      </div>
    </section>`,
    mount(root) {
      const form = $<HTMLFormElement>("#co-form", root)!;
      const btn = $<HTMLButtonElement>("#pay-btn", root)!;
      const val = (id: string) => (($(`#${id}`, form) as HTMLInputElement | null)?.value ?? "").trim();
      const setErr = (id: string, msg: string) => { const e = $(`#${id}-err`, form); if (e) e.textContent = msg; $(`#${id}`, form)?.setAttribute("aria-invalid", msg ? "true" : "false"); };

      const validate = (): boolean => {
        const rules: [string, boolean, string][] = [
          ["name", val("name").length >= 2, "Enter your full name."],
          ["phone", PHONE.test(val("phone")), "Enter a phone number we can reach, like 0801 234 5678."],
          ["email", EMAIL.test(val("email")), "Enter a valid email address."],
          ["address", val("address").length >= 5, "Enter your street address."],
          ["city", val("city").length >= 2, "Enter your city or town."],
          ["state", val("state") !== "", "Choose your state."],
        ];
        let first: string | null = null;
        for (const [id, ok, msg] of rules) { setErr(id, ok ? "" : msg); if (!ok && !first) first = id; }
        if (first) { const el = $(`#${first}`, form)!; scrollToEl(el); (el as HTMLElement).focus({ preventScroll: true }); }
        return !first;
      };

      $$("input, select", form).forEach((el) => el.addEventListener("input", () => { if (el.id) setErr(el.id, ""); }));

      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const fe = $("#form-error", form)!;
        fe.textContent = "";
        if (!validate()) return;
        const choice = ($('input[name="pay"]:checked', form) as HTMLInputElement | null)?.value;
        const savedId = choice && choice !== "new" ? Number(choice) : null;
        btn.disabled = true;
        btn.textContent = "Preparing your payment...";
        try {
          const res = await api<{ paid: boolean; ref: string; authorization_url?: string }>("POST", "/api/checkout", {
            items: usable.map((x) => ({ slug: x.l.slug, color: x.col.id, qty: qtyOf(x) })),
            customer: { name: val("name"), email: val("email"), phone: val("phone"), address: val("address"), city: val("city"), state: val("state"), notes: val("notes") },
            save_card: !!($("#save_card", form) as HTMLInputElement | null)?.checked && savedId === null,
            newsletter: !!($("#newsletter", form) as HTMLInputElement).checked,
            saved_card_id: savedId,
          });
          if (res.paid) { navigate(`/checkout/complete?reference=${encodeURIComponent(res.ref)}`); return; }
          if (res.authorization_url) { window.location.assign(res.authorization_url); return; }
          throw new ApiError(500, "We could not start your payment. Please try again.");
        } catch (err) {
          btn.disabled = false;
          btn.textContent = `Pay ${naira(total)} securely`;
          if (err instanceof ApiError) {
            for (const [k, v] of Object.entries(err.fields)) setErr(k.split(".").pop()!, v);
            fe.textContent = err.message;
          } else fe.textContent = "Something went wrong. Please try again.";
          fe.focus();
          scrollToEl(fe);
        }
      });
    },
  };
}

export async function checkoutComplete(_: Record<string, string>, q: URLSearchParams): Promise<PageResult> {
  const ref = q.get("reference") ?? q.get("trxref") ?? "";
  if (!/^[A-Za-z0-9\-]{4,24}$/.test(ref)) {
    return { title: "Regis", html: h`<section class="page narrow"><h1 class="title">We could not find that payment.</h1><p><a class="btn" href="/orders">Track an order</a></p></section>` };
  }
  return {
    title: "Confirming your payment | Regis",
    html: h`<section class="page narrow done" id="done"><p class="eyebrow">Order ${ref}</p><h1 class="title" id="done-h">Confirming your payment.</h1><p class="lede" id="done-p">One moment, we are checking with Paystack.</p><div class="done-clock" id="done-clock" aria-hidden="true"></div></section>`,
    async mount(root) {
      const box = $("#done", root)!;
      const spinner = $("#done-clock", root)!;
      spinner.textContent = "";
      let stop = false;
      for (let i = 0; i < 8 && !stop; i++) {
        try {
          const r = await api<{ paid: boolean; ref: string; total_kobo: number; items: { name: string; color: string; qty: number }[] }>("GET", `/api/checkout/verify?reference=${encodeURIComponent(ref)}`);
          if (r.paid) {
            clearCart();
            document.title = "Payment received | Regis";
            box.innerHTML = h`<p class="eyebrow">Order ${r.ref}</p><h1 class="title">Thank you. It is booked.</h1>
              <p class="lede">We received ${naira(r.total_kobo)} for ${r.items.map((i) => `${i.color ? `${i.name} in ${i.color}` : i.name} (${i.qty})`).join(", ")}. A receipt is on its way to your inbox.</p>
              <div class="actions"><a class="btn" href="/orders?ref=${r.ref}">Follow your order</a><a class="btn ghost" href="/collection">Keep browsing</a></div>
              `.value;
            return;
          }
        } catch { /* try again */ }
        await new Promise((r) => setTimeout(r, 1800));
      }
      box.innerHTML = h`<p class="eyebrow">Order ${ref}</p><h1 class="title">We could not confirm that payment.</h1><p class="lede">If you were charged, do not worry. Your order will update automatically once Paystack tells us, and we will email you. Otherwise your bag is still saved.</p><div class="actions"><a class="btn" href="/checkout">Try again</a><a class="btn ghost" href="/contact">Talk to us</a></div>`.value;
      return () => { stop = true; };
    },
  };
}
