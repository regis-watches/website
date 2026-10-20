import logo128 from "../assets/logo-128.png";
import { ApiError, api } from "../lib/api";
import { invalidateCatalog } from "../lib/catalog";
import { COLLECTION_LABEL, dateTime, naira, shortDate } from "../lib/format";
import { $, $$, h, mountHtml, raw, SafeHtml } from "../lib/html";
import { toast } from "../lib/motion";
import { hardNavigate, navigate } from "../lib/router";
import type { PageResult } from "../lib/router";
import { themeToggle } from "../lib/theme";
import type { AdminOrder, AdminWatch, Bucket, Stats, User } from "../lib/types";

const TABS = [["overview", "Overview"], ["catalogue", "Catalogue"], ["orders", "Orders"], ["newsletter", "Newsletter"]] as const;
const MAX_PHOTOS = 4;
const MAX_COLORS = 12;

function shell(tab: string, body: SafeHtml, user: User): SafeHtml {
  return h`
    <div class="adm">
      <aside class="adm-side">
        <a class="adm-logo" href="/admin" aria-label="Regis admin"><img src="${logo128}" width="32" height="32" alt="">Regis <small>Admin</small></a>
        <nav aria-label="Admin">${TABS.map(([k, label]) => h`<a href="/admin/${k}" ${k === tab ? 'aria-current="page"' : ""}>${label}</a>`)}</nav>
        <div class="adm-foot"><a href="/" class="adm-link">View the shop</a><p>${user.email}</p>${themeToggle("on-dark")}<button class="linklike" id="adm-out" type="button">Sign out</button></div>
      </aside>
      <section class="adm-main">${body}</section>
    </div>`;
}

export async function adminPage(params: Record<string, string>): Promise<PageResult> {
  let user: User | null = null;
  try { user = (await api<{ user: User }>("GET", "/api/admin/me")).user; } catch { user = null; }

  if (!user) {
    return {
      bare: true, title: "Regis Admin",
      html: h`<section class="adm-login"><div class="adm-login-theme">${themeToggle()}</div><form id="adm-login" class="login-card" novalidate>
        <p class="eyebrow">Regis admin</p><h1 class="section-title">Sign in</h1>
        <div class="field"><label for="a-email">Email</label><input id="a-email" name="email" type="email" autocomplete="username" required maxlength="254"></div>
        <div class="field"><label for="a-pass">Password</label><input id="a-pass" name="password" type="password" autocomplete="current-password" required maxlength="128"></div>
        <p class="err" id="a-err" role="alert"></p><button class="btn wide" type="submit">Sign in</button></form></section>`,
      mount(root) {
        $<HTMLFormElement>("#adm-login", root)!.addEventListener("submit", async (e) => {
          e.preventDefault();
          const err = $("#a-err", root)!;
          err.textContent = "";
          try {
            await api("POST", "/api/admin/login", Object.fromEntries(new FormData(e.currentTarget as HTMLFormElement).entries()));
            navigate("/admin/overview", true);
            window.location.reload();
          } catch (ex) { err.textContent = ex instanceof ApiError ? ex.message : "Something went wrong."; }
        });
      },
    };
  }

  const tab = (TABS.map(([k]) => k) as string[]).includes(params.tab) ? params.tab : "overview";
  const page = await ({ overview, catalogue, orders, newsletter }[tab as "overview"])();
  return {
    bare: true, title: `${TABS.find(([k]) => k === tab)![1]} | Regis Admin`,
    html: shell(tab, page.html, user),
    async mount(root) {
      $("#adm-out", root)!.addEventListener("click", async () => { await api("POST", "/api/auth/logout"); hardNavigate("/admin"); });
      return page.mount(root);
    },
  };
}

interface Part { html: SafeHtml; mount: (root: HTMLElement) => void | (() => void) }

// =============================================================== overview
function kpi(label: string, b: Bucket): SafeHtml {
  return h`<article class="kpi"><h3>${label}</h3>
    <p class="kpi-big">${naira(b.gross)}</p><p class="kpi-sub">paid by customers</p>
    <dl><div><dt>Sales</dt><dd>${b.orders}</dd></div><div><dt>Watches</dt><dd>${b.items}</dd></div>
    <div><dt>Paystack fees</dt><dd>${naira(b.fees)}</dd></div><div><dt>You receive</dt><dd><strong>${naira(b.net)}</strong></dd></div></dl></article>`;
}

function chart(buckets: Bucket[], kind: "week" | "month"): SafeHtml {
  const W = 760, H = 260, padB = 40, padT = 26;
  const max = Math.max(1, ...buckets.map((b) => b.gross));
  const bw = W / buckets.length;
  const bars = buckets.map((b, i) => {
    const hh = Math.round(((H - padB - padT) * b.gross) / max);
    const nh = Math.round(((H - padB - padT) * b.net) / max);
    const x = i * bw + bw * 0.16, w = bw * 0.68;
    const label = kind === "week" ? shortDate(b.start).replace(/ \d{4}$/, "") : b.label.slice(2);
    return `<g class="bar" tabindex="0" role="img" aria-label="${kind === "week" ? "Week of " : ""}${label}: ${b.orders} sales, ${naira(b.gross)} paid">
      <title>${label}: ${b.orders} sales, ${naira(b.gross)} paid, ${naira(b.net)} received</title>
      <rect class="b-gross" x="${x.toFixed(1)}" y="${H - padB - hh}" width="${w.toFixed(1)}" height="${hh}"/>
      <rect class="b-net" x="${(x + w * 0.25).toFixed(1)}" y="${H - padB - nh}" width="${(w * 0.5).toFixed(1)}" height="${nh}"/>
      <text x="${(x + w / 2).toFixed(1)}" y="${H - padB - hh - 7}" text-anchor="middle" class="b-n">${b.orders || ""}</text>
      <text x="${(x + w / 2).toFixed(1)}" y="${H - 16}" text-anchor="middle" class="b-l">${label}</text></g>`;
  }).join("");
  return raw(`<svg class="chart" viewBox="0 0 ${W} ${H}" role="group" aria-label="Revenue per ${kind}"><line x1="0" y1="${H - padB}" x2="${W}" y2="${H - padB}" class="axis"/>${bars}</svg>`);
}

async function overview(): Promise<Part> {
  const s = await api<Stats>("GET", "/api/admin/stats");
  const r = s.report, c = s.counts;
  const empty = r.total.orders === 0;
  return {
    html: h`
      <header class="adm-head"><h1 class="section-title">Overview</h1><p>Revenue is what customers paid. Paystack's fee comes out of it, and "You receive" is what lands with you.</p></header>
      ${empty ? h`<p class="note">No sales yet. Add a watch in the Catalogue, buy it from the shop, and the numbers appear here.</p>` : ""}
      <div class="kpis">${kpi("Today", r.today)}${kpi("This week", r.this_week)}${kpi("This month", r.this_month)}${kpi("All time", r.total)}</div>
      <section class="panel"><div class="panel-head"><h2>Sales and revenue</h2>
        <div class="seg" role="tablist" aria-label="Period"><button role="tab" aria-selected="true" data-period="week">Weekly</button><button role="tab" aria-selected="false" data-period="month">Monthly</button></div></div>
        <div class="legend"><span><i class="k1"></i>Customers paid</span><span><i class="k2"></i>You received</span><span>Numbers above bars are sales</span></div>
        <div id="chart-box">${chart(r.weekly, "week")}</div>
        <details class="table-alt"><summary>See the numbers as a table</summary><div id="table-box"></div></details>
      </section>
      <div class="two">
        <section class="panel"><h2>Orders by status</h2><ul class="plain">
          <li><span>Order Processing</span><strong>${c.processing ?? 0}</strong></li><li><span>Out for Delivery</span><strong>${c.out_for_delivery ?? 0}</strong></li>
          <li><span>Delivered</span><strong>${c.delivered ?? 0}</strong></li><li><span>Cancelled</span><strong>${c.cancelled ?? 0}</strong></li></ul>
          <p class="hint">${s.subscribers} ${s.subscribers === 1 ? "person is" : "people are"} on the email list.</p></section>
        <section class="panel"><h2>Best sellers</h2>${r.top.length ? h`<ol class="plain">${r.top.map((t) => h`<li><span>${t.name}</span><strong>${t.units} sold</strong></li>`)}</ol>` : h`<p class="hint">No sales yet.</p>`}
          ${s.low_stock.length ? h`<h2 class="sub">Running low</h2><ul class="plain">${s.low_stock.map((l) => h`<li><span>${l.name}</span><strong>${l.stock === 0 ? "Sold out" : l.stock + " left"}</strong></li>`)}</ul>` : ""}</section>
      </div>`,
    mount(root) {
      const tableFor = (bs: Bucket[], kind: string) => h`<table class="tbl"><thead><tr><th>${kind}</th><th>Sales</th><th>Watches</th><th>Revenue</th><th>Fees</th><th>You receive</th></tr></thead><tbody>${[...bs].reverse().map((b) => h`<tr><td>${kind === "Week" ? "w/c " + shortDate(b.start) : b.label}</td><td>${b.orders}</td><td>${b.items}</td><td>${naira(b.gross)}</td><td>${naira(b.fees)}</td><td>${naira(b.net)}</td></tr>`)}</tbody></table>`;
      const draw = (p: "week" | "month") => {
        mountHtml($("#chart-box", root)!, chart(p === "week" ? r.weekly : r.monthly, p));
        mountHtml($("#table-box", root)!, tableFor(p === "week" ? r.weekly : r.monthly, p === "week" ? "Week" : "Month"));
      };
      draw("week");
      $$<HTMLButtonElement>("[data-period]", root).forEach((b) => b.addEventListener("click", () => {
        $$("[data-period]", root).forEach((x) => x.setAttribute("aria-selected", String(x === b)));
        draw(b.dataset.period as "week" | "month");
      }));
    },
  };
}

// =============================================================== catalogue
interface Photo { name: string; url: string }

/** One colour of a watch while it is being edited. `id` is null until it has been saved. */
interface ColorDraft { id: number | null; name: string; hex: string; stock: number | string; images: Photo[] }

interface Draft {
  name: string; collection: "men" | "women" | "neutral"; price_naira: number | string; tagline: string; description: string;
  movement: string; case_mm: number | string; case_material: string; strap: string; water_resistance: string; crystal: string; power_reserve: string; warranty: string;
  colors: ColorDraft[]; featured: boolean; active: boolean;
}

const newColor = (): ColorDraft => ({ id: null, name: "", hex: "#8a8a8a", stock: 1, images: [] });

const blank = (): Draft => ({
  name: "", collection: "men", price_naira: "", tagline: "", description: "", movement: "", case_mm: "", case_material: "", strap: "",
  water_resistance: "", crystal: "", power_reserve: "", warranty: "", colors: [newColor()], featured: false, active: true,
});

const draftOf = (w: AdminWatch): Draft => ({
  name: w.name, collection: w.collection, price_naira: w.price_naira, tagline: w.tagline, description: w.description, ...w.raw,
  colors: w.colors.map((c) => ({ id: c.id, name: c.name, hex: c.hex || "#8a8a8a", stock: c.stock, images: c.image_names.map((name, i) => ({ name, url: c.images[i] })) })),
  featured: w.featured, active: w.active,
});

/** What the server expects. Photos are sent by file name, numbers as numbers. */
const bodyOf = (d: Draft) => ({
  name: d.name, collection: d.collection, tagline: d.tagline, description: d.description, price_naira: Number(d.price_naira),
  movement: d.movement, case_mm: Number(d.case_mm), case_material: d.case_material, strap: d.strap, water_resistance: d.water_resistance,
  crystal: d.crystal, power_reserve: d.power_reserve, warranty: d.warranty, featured: d.featured, active: d.active,
  colors: d.colors.map((c) => ({ ...(c.id === null ? {} : { id: c.id }), name: c.name.trim(), hex: c.hex, stock: Number(c.stock), images: c.images.map((p) => p.name) })),
});

/** Shrinks big phone photos in the browser first, so uploads are quick and the shop stays fast. */
async function prepare(file: File): Promise<Blob> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
  try {
    const url = URL.createObjectURL(file);
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("bad image")); i.src = url; });
    URL.revokeObjectURL(url);
    const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
    if (scale === 1 && file.size < 900_000) return file;
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise<Blob | null>((res) => c.toBlob(res, "image/jpeg", 0.85));
    return blob ?? file;
  } catch { return file; }
}

async function catalogue(): Promise<Part> {
  let list = (await api<{ watches: AdminWatch[] }>("GET", "/api/admin/watches")).watches;

  const table = () => list.length === 0
    ? h`<div class="empty-state"><p class="section-title">No watches yet.</p><p>The shop's empty spaces are waiting. Add your first watch with its photos and it appears in the collection straight away. A watch that comes in several colours is added once, with each colour inside it.</p></div>`
    : h`<table class="tbl wide-tbl"><thead><tr><th scope="col">Watch</th><th scope="col">Collection</th><th scope="col">Price</th><th scope="col">Colours</th><th scope="col">Stock</th><th scope="col">Status</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead>
      <tbody>${list.map((w) => h`<tr class="${w.active ? "" : "off"}">
        <th scope="row"><span class="mini">${w.images[0] ? h`<img src="${w.images[0]}" alt="">` : ""}</span><span>${w.name}<small>${w.tagline}</small></span></th>
        <td>${COLLECTION_LABEL[w.collection]}</td><td>${naira(w.price_kobo)}</td>
        <td><span class="dots" title="${w.colors.map((c) => c.name || "One colour").join(", ")}">${w.colors.length > 1 ? w.colors.slice(0, 6).map((c) => h`<i class="sw" data-hex="${c.hex}"></i>`) : ""}<em>${w.colors.length}</em></span></td>
        <td>${w.stock}${w.colors.length > 1 ? h`<small>${w.colors.map((c) => `${c.name}: ${c.stock}`).join(", ")}</small>` : ""}</td>
        <td>${w.active ? "Live" : "Hidden"}${w.featured ? ", featured" : ""}</td>
        <td class="acts"><button class="linklike" data-edit="${w.id}" type="button">Edit</button><button class="linklike" data-toggle="${w.id}" type="button">${w.active ? "Hide" : "Show"}</button><button class="linklike" data-del="${w.id}" type="button">Delete</button></td></tr>`)}</tbody></table>`;

  return {
    html: h`<header class="adm-head row"><div><h1 class="section-title">Catalogue</h1><p>${list.length} ${list.length === 1 ? "watch" : "watches"}. Anything you add, edit or hide changes the shop straight away.</p></div><button class="btn" id="add-watch" type="button">Add a watch</button></header>
      <div class="table-wrap" id="cat-table">${table()}</div>
      <div id="sheet-root"></div>`,
    mount(root) {
      const tableEl = $("#cat-table", root)!;
      const sheetRoot = $("#sheet-root", root)!;
      const reload = async () => { list = (await api<{ watches: AdminWatch[] }>("GET", "/api/admin/watches")).watches; invalidateCatalog(); mountHtml(tableEl, table()); bindRows(); };

      const openSheet = (existing?: AdminWatch) => {
        const d: Draft = existing ? draftOf(existing) : blank();
        const inp = (id: string, label: string, v: string | number, extra = "") => h`<div class="field"><label for="f-${id}">${label}</label><input id="f-${id}" name="${id}" value="${v}" ${raw(extra)}></div>`;

        mountHtml(sheetRoot, h`
          <div class="scrim" id="sheet-scrim"></div>
          <aside class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-h">
            <header><h2 id="sheet-h" class="section-title">${existing ? "Edit " + existing.name : "Add a watch"}</h2><button class="linklike" id="sheet-x" type="button">Close</button></header>
            <form id="watch-form" novalidate>
              <p class="err" id="f-err" role="alert" tabindex="-1"></p>
              <fieldset><legend>The basics</legend>
                ${inp("name", "Name", d.name, 'maxlength="80" required')}
                <div class="field"><label for="f-collection">Collection</label><select id="f-collection" name="collection"><option value="men">Men</option><option value="women">Women</option><option value="neutral">Gender neutral</option></select></div>
                ${inp("price_naira", "Price (naira), the same for every colour", d.price_naira, 'type="number" min="1" max="100000000" step="1" inputmode="numeric" required')}
                <p class="hint" id="price-hint"></p>
                ${inp("tagline", "One-line tagline (optional)", d.tagline, 'maxlength="140"')}
                <div class="field"><label for="f-description">Description</label><textarea id="f-description" name="description" rows="5" maxlength="2000">${d.description}</textarea></div>
              </fieldset>
              <fieldset class="colors-set"><legend>Colours, photos and stock</legend>
                <p class="hint">Add the watch once, then one entry for each colour or shade. Each colour has its own photos and its own stock, and customers choose between them on the watch page. If the watch comes in a single colour, leave the name blank. Up to ${MAX_COLORS} colours, ${MAX_PHOTOS} photos each. JPG, PNG or WebP, up to 3 MB each.</p>
                <div id="colors"></div>
                <button class="btn ghost" id="add-color" type="button">Add another colour</button>
              </fieldset>
              <fieldset><legend>Details (optional)</legend>
                <div class="row2">${inp("movement", "Movement", d.movement, 'maxlength="80"')}${inp("case_mm", "Case size (mm)", d.case_mm, 'type="number" min="18" max="60" step="1" placeholder="e.g. 38"')}</div>
                <div class="row2">${inp("case_material", "Case material", d.case_material, 'maxlength="80"')}${inp("strap", "Strap", d.strap, 'maxlength="80"')}</div>
                <div class="row2">${inp("water_resistance", "Water resistance", d.water_resistance, 'maxlength="40"')}${inp("crystal", "Crystal", d.crystal, 'maxlength="60"')}</div>
                <div class="row2">${inp("power_reserve", "Power", d.power_reserve, 'maxlength="60"')}${inp("warranty", "Warranty", d.warranty, 'maxlength="40"')}</div>
              </fieldset>
              <div class="checks"><label class="check"><input type="checkbox" id="f-featured" ${d.featured ? "checked" : ""}><span>Show on the home page</span></label><label class="check"><input type="checkbox" id="f-active" ${d.active ? "checked" : ""}><span>Visible in the shop</span></label></div>
              <div class="sheet-actions"><button class="btn" type="submit">${existing ? "Save changes" : "Add to the shop"}</button><button class="btn ghost" id="sheet-cancel" type="button">Cancel</button></div>
            </form>
          </aside>`);

        const form = $<HTMLFormElement>("#watch-form", sheetRoot)!;
        ($("#f-collection", form) as HTMLSelectElement).value = d.collection;
        const colorsEl = $("#colors", form)!;

        const val = (n: string) => (form.elements.namedItem(n) as HTMLInputElement).value;
        const readFields = () => Object.assign(d, {
          name: val("name"), collection: val("collection") as Draft["collection"], tagline: val("tagline"), description: val("description"), price_naira: val("price_naira"),
          movement: val("movement"), case_mm: val("case_mm"), case_material: val("case_material"), strap: val("strap"), water_resistance: val("water_resistance"),
          crystal: val("crystal"), power_reserve: val("power_reserve"), warranty: val("warranty"),
          featured: ($("#f-featured", form) as HTMLInputElement).checked, active: ($("#f-active", form) as HTMLInputElement).checked,
        });

        /** Copy what is typed in the colour cards back into the draft, before anything redraws them. */
        const readColors = () => {
          $$<HTMLElement>(".color-card", colorsEl).forEach((card, i) => {
            const c = d.colors[i];
            if (!c) return;
            c.name = ($("[data-f=name]", card) as HTMLInputElement).value;
            c.stock = ($("[data-f=stock]", card) as HTMLInputElement).value;
            c.hex = ($("[data-f=hex]", card) as HTMLInputElement).value;
          });
        };

        const paintColors = () => {
          mountHtml(colorsEl, h`${d.colors.map((c, i) => h`
            <section class="color-card" aria-label="Colour ${i + 1}">
              <header><strong>${c.name.trim() || `Colour ${i + 1}`}</strong>${d.colors.length > 1 ? h`<button class="linklike" type="button" data-rm-color="${i}">Remove this colour</button>` : ""}</header>
              <div class="color-fields">
                <div class="field"><label for="c${i}-name">Colour name</label><input id="c${i}-name" data-f="name" value="${c.name}" maxlength="40" placeholder="e.g. Midnight"></div>
                <div class="field swatch-pick"><label for="c${i}-hex">Swatch</label><input id="c${i}-hex" data-f="hex" type="color" value="${c.hex}"></div>
                <div class="field"><label for="c${i}-stock">In stock</label><input id="c${i}-stock" data-f="stock" type="number" min="0" max="10000" step="1" inputmode="numeric" value="${c.stock}"></div>
              </div>
              <div class="photos">${c.images.map((p, k) => h`<figure class="ph-item"><img src="${p.url}" alt="Photo ${k + 1} of ${c.name.trim() || `colour ${i + 1}`}">
                <figcaption>${k === 0 ? h`<strong>Main</strong>` : h`<button class="linklike" type="button" data-main="${i}:${k}">Make main</button>`}<button class="linklike" type="button" data-rm="${i}:${k}">Remove</button></figcaption></figure>`)}</div>
              <label class="upload" for="c${i}-photos"><input id="c${i}-photos" data-f="photos" data-i="${i}" type="file" accept="image/jpeg,image/png,image/webp" multiple ${c.images.length >= MAX_PHOTOS ? "disabled" : ""}><span>${c.images.length ? "Add more photos" : "Choose photos"}</span></label>
              <p class="hint" data-f="state" role="status"></p>
            </section>`)}`);
          ($("#add-color", form) as HTMLButtonElement).disabled = d.colors.length >= MAX_COLORS;

          const pair = (b: HTMLElement, key: string) => (b.dataset[key] ?? "").split(":").map(Number);
          $$<HTMLElement>("[data-rm-color]", colorsEl).forEach((b) => b.addEventListener("click", () => {
            readColors();
            const c = d.colors[Number(b.dataset.rmColor)];
            if (c.images.length && !window.confirm("Remove this colour and its photos? Past orders keep their record.")) return;
            d.colors.splice(Number(b.dataset.rmColor), 1);
            paintColors();
          }));
          $$<HTMLElement>("[data-main]", colorsEl).forEach((b) => b.addEventListener("click", () => {
            readColors();
            const [i, k] = pair(b, "main");
            const [x] = d.colors[i].images.splice(k, 1);
            d.colors[i].images.unshift(x);
            paintColors();
          }));
          $$<HTMLElement>("[data-rm]", colorsEl).forEach((b) => b.addEventListener("click", () => {
            readColors();
            const [i, k] = pair(b, "rm");
            d.colors[i].images.splice(k, 1);
            paintColors();
          }));
          $$<HTMLInputElement>("[data-f=photos]", colorsEl).forEach((input) => input.addEventListener("change", async () => {
            readColors();
            const i = Number(input.dataset.i);
            const card = input.closest<HTMLElement>(".color-card")!;
            const st = $("[data-f=state]", card)!;
            const files = Array.from(input.files ?? []).slice(0, MAX_PHOTOS - d.colors[i].images.length);
            for (const [n, file] of files.entries()) {
              st.textContent = `Uploading ${n + 1} of ${files.length}...`;
              try {
                const up = await api<{ image: string; url: string }>("POST", "/api/admin/uploads", await prepare(file));
                d.colors[i].images.push({ name: up.image, url: up.url });
              } catch (ex) {
                st.textContent = `${file.name}: ${ex instanceof ApiError ? ex.message : "Upload failed."}`;
                input.value = "";
                return;
              }
            }
            readColors();
            paintColors();
          }));
        };
        paintColors();

        $("#add-color", form)!.addEventListener("click", () => {
          readColors();
          if (d.colors.length >= MAX_COLORS) return;
          d.colors.push(newColor());
          paintColors();
          const cards = $$<HTMLElement>(".color-card", colorsEl);
          ($("[data-f=name]", cards[cards.length - 1]) as HTMLElement).focus();
        });

        form.addEventListener("input", () => {
          const p = Number(val("price_naira"));
          $("#price-hint", form)!.textContent = p > 0 ? `Customers pay exactly ${naira(p * 100)}. Paystack's fee is deducted from your side when it settles.` : "";
        });

        const close = () => { sheetRoot.innerHTML = ""; document.removeEventListener("keydown", esc); };
        const esc = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
        document.addEventListener("keydown", esc);
        $("#sheet-x", sheetRoot)!.addEventListener("click", close);
        $("#sheet-cancel", sheetRoot)!.addEventListener("click", close);
        $("#sheet-scrim", sheetRoot)!.addEventListener("click", close);
        ($("#f-name", form) as HTMLElement).focus();

        form.addEventListener("submit", async (e) => {
          e.preventDefault();
          readFields();
          readColors();
          const err = $("#f-err", form)!;
          err.textContent = "";
          const body = bodyOf(d);
          try {
            if (existing) await api("PUT", `/api/admin/watches/${existing.id}`, body); else await api("POST", "/api/admin/watches", body);
            toast(existing ? "Changes saved." : "Watch added. It is live in the shop.");
            close();
            await reload();
          } catch (ex) { err.textContent = ex instanceof ApiError ? ex.message : "Something went wrong."; err.focus(); }
        });
      };

      const bindRows = () => {
        $$<HTMLElement>("[data-edit]", tableEl).forEach((b) => b.addEventListener("click", () => openSheet(list.find((x) => x.id === Number(b.dataset.edit)))));
        $$<HTMLElement>("[data-toggle]", tableEl).forEach((b) => b.addEventListener("click", async () => {
          const w = list.find((x) => x.id === Number(b.dataset.toggle))!;
          await api("PUT", `/api/admin/watches/${w.id}`, bodyOf({ ...draftOf(w), active: !w.active }));
          toast(w.active ? `${w.name} is now hidden.` : `${w.name} is now live.`);
          await reload();
        }));
        $$<HTMLElement>("[data-del]", tableEl).forEach((b) => b.addEventListener("click", async () => {
          const w = list.find((x) => x.id === Number(b.dataset.del))!;
          if (!window.confirm(`Remove ${w.name} and all its colours from the shop for good? Past orders keep their record. To simply take it off sale, use Hide instead.`)) return;
          await api("DELETE", `/api/admin/watches/${w.id}`);
          toast(`${w.name} removed.`);
          await reload();
        }));
      };
      bindRows();
      $("#add-watch", root)!.addEventListener("click", () => openSheet());
    },
  };
}

// =============================================================== orders
async function orders(): Promise<Part> {
  const data = await api<{ orders: AdminOrder[] }>("GET", "/api/admin/orders");
  const label: Record<string, string> = { out_for_delivery: "Mark out for delivery", delivered: "Mark delivered", cancelled: "Cancel order" };
  return {
    html: h`<header class="adm-head"><h1 class="section-title">Orders</h1><p>Move each order forward as it goes: Order Processing, Out for Delivery, then Delivered. The customer's tracking page updates at each step.</p></header>
      ${data.orders.length ? h`<div class="order-cards">${data.orders.map((o) => h`
        <article class="o-card" data-ref="${o.ref}"><header><div><h3>${o.ref}</h3><small>${dateTime(o.paid_at ?? o.created_at)}</small></div><span class="pill s-${o.status}">${o.status_label}</span></header>
          <div class="o-body"><div><p><strong>${o.name}</strong></p><p>${o.phone}<br>${o.email}</p><p>${o.address}, ${o.city}, ${o.state}</p>${o.notes ? h`<p class="note">Note: ${o.notes}</p>` : ""}</div>
            <div><ul class="plain">${o.items.map((i) => h`<li><span>${i.name}${i.color ? ` (${i.color})` : ""} x ${i.qty}</span><strong>${naira(i.unit_price_kobo * i.qty)}</strong></li>`)}</ul>
              <dl class="money"><div><dt>Customer paid</dt><dd>${naira(o.total_kobo)}</dd></div><div><dt>Paystack fee</dt><dd>${o.fee_kobo === null ? "n/a" : naira(o.fee_kobo)}</dd></div><div class="net"><dt>You receive</dt><dd>${o.net_kobo === null ? "n/a" : naira(o.net_kobo)}</dd></div></dl></div></div>
          <footer>${o.allowed.map((s) => h`<button class="btn ${s === "cancelled" ? "ghost" : ""}" type="button" data-status="${s}">${label[s]}</button>`)}${o.allowed.length === 0 ? h`<small>Nothing more to do.</small>` : ""}</footer></article>`)}</div>`
        : h`<div class="empty-state"><p class="section-title">No paid orders yet.</p><p>They appear here the moment a customer pays.</p></div>`}`,
    mount(root) {
      $$<HTMLButtonElement>("[data-status]", root).forEach((b) => b.addEventListener("click", async () => {
        const ref = b.closest<HTMLElement>("[data-ref]")!.dataset.ref!;
        const status = b.dataset.status!;
        if (status === "cancelled" && !window.confirm(`Cancel order ${ref}? Remember to refund the customer in your Paystack dashboard.`)) return;
        b.disabled = true;
        try { await api("PATCH", `/api/admin/orders/${ref}/status`, { status }); toast("Order updated."); navigate("/admin/orders", true); window.location.reload(); }
        catch (ex) { b.disabled = false; toast(ex instanceof ApiError ? ex.message : "Could not update."); }
      }));
    },
  };
}

// =============================================================== newsletter
async function newsletter(): Promise<Part> {
  const subs = (await api<{ subscribers: { email: string; active: number; created_at: string }[] }>("GET", "/api/admin/subscribers")).subscribers;
  const active = subs.filter((s) => s.active).length;
  return {
    html: h`<header class="adm-head"><h1 class="section-title">Newsletter</h1><p>${active} active ${active === 1 ? "subscriber" : "subscribers"}. Every email carries a one-click unsubscribe link.</p></header>
      <div class="two"><section class="panel"><h2>Write a campaign</h2>
        <form id="camp" class="stack" novalidate>
          <div class="field"><label for="m-sub">Subject line</label><input id="m-sub" name="subject" maxlength="120" required></div>
          <div class="field"><label for="m-head">Headline</label><input id="m-head" name="headline" maxlength="120" required></div>
          <div class="field"><label for="m-body">Message</label><textarea id="m-body" name="body" rows="7" maxlength="3000" required></textarea><p class="hint">Leave a blank line between paragraphs.</p></div>
          <div class="row2"><div class="field"><label for="m-cta">Button text (optional)</label><input id="m-cta" name="cta_label" maxlength="40"></div><div class="field"><label for="m-path">Button goes to</label><input id="m-path" name="cta_path" value="/collection" maxlength="120"></div></div>
          <p class="err" id="m-err" role="alert"></p><p class="ok" id="m-ok" role="status"></p>
          <div class="sheet-actions"><button class="btn ghost" type="button" id="send-test">Send a test to me</button><button class="btn" type="submit">Send to ${active}</button></div>
        </form></section>
        <section class="panel"><h2>Subscribers</h2>${subs.length ? h`<ul class="plain subs">${subs.slice(0, 80).map((s) => h`<li><span>${s.email}</span><small>${s.active ? shortDate(s.created_at) : "Unsubscribed"}</small></li>`)}</ul>` : h`<p class="hint">Nobody yet. The sign-up form is on the home page and at checkout.</p>`}</section></div>`,
    mount(root) {
      const form = $<HTMLFormElement>("#camp", root)!;
      const send = async (test: boolean) => {
        const err = $("#m-err", root)!, ok = $("#m-ok", root)!;
        err.textContent = ""; ok.textContent = "";
        const body = { ...Object.fromEntries(new FormData(form).entries()), test_only: test };
        if (!test && !window.confirm(`Send this to ${active} ${active === 1 ? "subscriber" : "subscribers"}? This cannot be undone.`)) return;
        try { const r = await api<{ queued: number }>("POST", "/api/admin/campaign", body); ok.textContent = test ? "Test queued to your admin email." : `Queued for ${r.queued} ${r.queued === 1 ? "subscriber" : "subscribers"}.`; }
        catch (ex) { err.textContent = ex instanceof ApiError ? ex.message : "Something went wrong."; }
      };
      form.addEventListener("submit", (e) => { e.preventDefault(); void send(false); });
      $("#send-test", root)!.addEventListener("click", () => void send(true));
    },
  };
}
