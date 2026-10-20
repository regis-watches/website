import { ApiError, api } from "../lib/api";
import { lineName } from "../lib/catalog";
import { naira } from "../lib/format";
import { $, $$, h, mountHtml } from "../lib/html";
import { toast } from "../lib/motion";
import type { PageResult } from "../lib/router";
import { navigate } from "../lib/router";
import { addToCart, qtyInBag } from "../lib/store";
import type { Watch, WatchColor } from "../lib/types";
import { openDrawer } from "../ui/chrome";
import { watchCard } from "./shared";

const LABEL: Record<string, string> = { men: "Men", women: "Women", neutral: "Gender neutral" };

export async function watchPage(params: Record<string, string>, query: URLSearchParams): Promise<PageResult> {
  let data: { watch: Watch; related: Watch[] };
  try {
    data = await api("GET", `/api/watches/${encodeURIComponent(params.slug)}`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) {
      return { title: "Watch not found | Regis", html: h`<section class="page narrow"><h1 class="title">That watch is not here.</h1><p class="lede">It may have sold out for good. The rest of the collection is still here.</p><p><a class="btn" href="/collection">Back to the collection</a></p></section>` };
    }
    throw e;
  }
  const w = data.watch;
  const specs = Object.entries(w.specs).filter(([, v]) => v);
  const many = w.colors.length > 1;
  // Start on the colour named in the link (?color=ID), else the first colour that is in stock.
  const wanted = Number(query.get("color"));
  let sel: WatchColor = w.colors.find((c) => c.id === wanted) ?? w.colors.find((c) => c.in_stock) ?? w.colors[0];

  const photos = (c: WatchColor): string[] => (c.images.length ? c.images : w.images);

  const gallery = (c: WatchColor) => {
    const pics = photos(c);
    return h`<div class="stage" id="stage">${pics[0] ? h`<img id="stage-img" src="${pics[0]}" alt="${lineName(w, c)}">` : h`<span class="nophoto">No photo yet</span>`}</div>
      ${pics.length > 1 ? h`<div class="thumbs">${pics.map((src, i) => h`<button type="button" class="thumb" data-i="${i}" aria-label="Photo ${i + 1} of ${pics.length}" aria-current="${i === 0}"><img src="${src}" alt=""></button>`)}</div>` : ""}`;
  };

  const picker = () => many
    ? h`<fieldset class="colors"><legend>Colour: <strong id="color-name">${sel.name}</strong></legend>
        <div class="swatches" role="radiogroup" aria-label="Colour">${w.colors.map((c) => h`<label class="swatch ${c.in_stock ? "" : "out"}" title="${c.name}${c.in_stock ? "" : ", sold out"}">
          <input type="radio" name="color" value="${c.id}" ${c.id === sel.id ? "checked" : ""}><i class="sw big" data-hex="${c.hex}"></i><span class="sr-only">${c.name}${c.in_stock ? "" : ", sold out"}</span></label>`)}</div>
      </fieldset>`
    : sel.name ? h`<p class="color-one">Colour: <strong>${sel.name}</strong></p>` : h``;

  return {
    title: `${w.name} | Regis`,
    html: h`
    <article class="page pdp">
      <nav class="crumbs" aria-label="Breadcrumb"><a href="/collection">Collection</a> / <a href="/collection/${w.collection}">${LABEL[w.collection]}</a> / <span aria-current="page">${w.name}</span></nav>
      <div class="pdp-grid">
        <div class="gallery" id="gallery">${gallery(sel)}</div>
        <div class="info">
          <p class="eyebrow">${LABEL[w.collection]}</p>
          <h1 class="title">${w.name}</h1>
          ${w.tagline ? h`<p class="tagline">${w.tagline}</p>` : ""}
          <p class="pdp-price">${naira(w.price_kobo)}</p>
          <div id="picker">${picker()}</div>
          <p class="stock" id="stock"></p>
          <div id="buy-area"></div>
          ${w.description ? h`<p class="desc">${w.description}</p>` : ""}
          ${specs.length ? h`<dl class="specs">${specs.map(([k, v]) => h`<div><dt>${k}</dt><dd>${v}</dd></div>`)}</dl>` : ""}
          <ul class="notes">
            <li>You pay exactly ${naira(w.price_kobo)}. No card, handling or delivery charges are added.</li>
            <li>Complimentary insured delivery across Nigeria.</li>
            <li>Secure checkout with Paystack.</li>
          </ul>
        </div>
      </div>
      ${data.related.length ? h`<section class="section" aria-labelledby="rel-h"><h2 id="rel-h" class="section-title">More in ${LABEL[w.collection]}</h2><div class="grid three">${data.related.map(watchCard)}</div></section>` : ""}
    </article>`,
    mount(root) {
      let qty = 1;

      const drawStock = () => {
        const name = sel.name ? ` in ${sel.name}` : "";
        $("#stock", root)!.textContent = sel.in_stock
          ? (sel.stock <= 3 ? `Only ${sel.stock} left${name}` : "In stock, ships within 2 working days")
          : `Sold out${name} for now`;
      };

      const drawBuy = () => {
        const max = Math.min(5, sel.stock);
        qty = Math.min(Math.max(1, qty), Math.max(1, max));
        mountHtml($("#buy-area", root)!, sel.in_stock ? h`
          <div class="buy">
            <div class="qty" role="group" aria-label="Quantity"><button type="button" id="q-dec" aria-label="One fewer">-</button><output id="q-val" aria-live="polite">${qty}</output><button type="button" id="q-inc" aria-label="One more">+</button></div>
            <button class="btn" id="add" type="button">Add to bag</button>
          </div>
          <p><button class="textlink" id="buy-now" type="button">Or buy it now and go straight to checkout</button></p>`
          : h`<div class="buy"><button class="btn" type="button" disabled>${many ? `Sold out in ${sel.name}` : "Sold out"}</button></div>${many && w.colors.some((c) => c.in_stock) ? h`<p class="hint">Another colour is available. Choose it above.</p>` : ""}`);
        const val = $("#q-val", root);
        const paint = () => {
          if (val) val.textContent = String(qty);
          const inc = $<HTMLButtonElement>("#q-inc", root), dec = $<HTMLButtonElement>("#q-dec", root);
          if (inc) inc.disabled = qty >= max;
          if (dec) dec.disabled = qty <= 1;
        };
        $("#q-inc", root)?.addEventListener("click", () => { qty = Math.min(max, qty + 1); paint(); });
        $("#q-dec", root)?.addEventListener("click", () => { qty = Math.max(1, qty - 1); paint(); });
        paint();
        const add = (andGo: boolean) => {
          if (qtyInBag(w.slug, sel.id) + qty > max) { toast(`Only ${sel.stock} of ${lineName(w, sel)} available.`); return; }
          addToCart(w.slug, sel.id, qty);
          if (andGo) { navigate("/checkout"); return; }
          toast(`${lineName(w, sel)} added to your bag.`);
          openDrawer();
        };
        $("#add", root)?.addEventListener("click", () => add(false));
        $("#buy-now", root)?.addEventListener("click", () => add(true));
      };

      const drawGallery = () => {
        mountHtml($("#gallery", root)!, gallery(sel));
        const pics = photos(sel);
        $$<HTMLButtonElement>(".thumb", root).forEach((b) => b.addEventListener("click", () => {
          const img = $<HTMLImageElement>("#stage-img", root);
          if (img) img.src = pics[Number(b.dataset.i)];
          $$(".thumb", root).forEach((t) => t.setAttribute("aria-current", String(t === b)));
        }));
      };

      $$<HTMLInputElement>('input[name="color"]', root).forEach((r) => r.addEventListener("change", () => {
        sel = w.colors.find((c) => c.id === Number(r.value)) ?? sel;
        $("#color-name", root)!.textContent = sel.name;
        history.replaceState(history.state, "", `/watch/${w.slug}?color=${sel.id}`);
        qty = 1;
        drawGallery(); drawStock(); drawBuy();
      }));

      drawGallery(); drawStock(); drawBuy();
    },
  };
}
