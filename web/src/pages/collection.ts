import { allWatches } from "../lib/catalog";
import { $, h, mountHtml } from "../lib/html";
import type { PageResult } from "../lib/router";
import type { Watch } from "../lib/types";
import { COLLECTION_INFO, slots, watchCard } from "./shared";

const FILTERS = [["", "All"], ["men", "Men"], ["women", "Women"], ["neutral", "Gender neutral"]] as const;

export async function collection(params: Record<string, string>): Promise<PageResult> {
  const c = params.c ?? "";
  if (c && !COLLECTION_INFO[c]) throw new Error("unknown collection");
  const watches = await allWatches(true);
  const info = c ? COLLECTION_INFO[c] : null;

  return {
    title: info ? `${info.title} | Regis` : "The collection | Regis",
    html: h`
    <section class="page">
      <header class="page-head">
        <h1 class="title">${info ? info.title : "The collection"}</h1>
        <p class="lede">${info ? info.blurb : "Every watch in one place, for men, for women, and for anyone who likes a good watch."}</p>
      </header>
      <div class="toolbar">
        <nav class="tabs-links" aria-label="Filter by collection">
          ${FILTERS.map(([v, label]) => h`<a href="/collection${v ? "/" + v : ""}" ${v === c ? 'aria-current="page"' : ""}>${label}</a>`)}
        </nav>
        <div class="tools">
          <label><span class="sr-only">Search watches</span><input id="q" type="search" placeholder="Search" maxlength="60" autocomplete="off"></label>
          <label><span class="sr-only">Sort</span><select id="sort"><option value="featured">Our pick</option><option value="price_asc">Price, low to high</option><option value="price_desc">Price, high to low</option></select></label>
        </div>
      </div>
      <p class="count" id="count" aria-live="polite"></p>
      <div class="grid three" id="grid"></div>
    </section>`,
    mount(root) {
      const base = watches.filter((w) => !c || w.collection === c);
      const grid = $("#grid", root)!;
      const count = $("#count", root)!;
      const draw = () => {
        const q = ($<HTMLInputElement>("#q", root)!.value || "").trim().toLowerCase();
        const sort = $<HTMLSelectElement>("#sort", root)!.value;
        let list: Watch[] = base.filter((w) => !q || `${w.name} ${w.tagline} ${w.description}`.toLowerCase().includes(q));
        if (sort === "price_asc") list = [...list].sort((a, b) => a.price_kobo - b.price_kobo);
        if (sort === "price_desc") list = [...list].sort((a, b) => b.price_kobo - a.price_kobo);
        count.textContent = list.length ? `${list.length} ${list.length === 1 ? "watch" : "watches"}` : q ? "No matches" : "No watches yet";
        if (q) mountHtml(grid, list.length ? h`${list.map(watchCard)}` : h`<p class="empty">Nothing matches that. <a href="/collection">See the whole collection.</a></p>`);
        else mountHtml(grid, h`${slots(list, 6, 3)}`); // empty spaces stay until the admin fills them
      };
      draw();
      $("#q", root)!.addEventListener("input", draw);
      $("#sort", root)!.addEventListener("change", draw);
    },
  };
}
