import { ApiError, api } from "../lib/api";
import { naira } from "../lib/format";
import { $, h, SafeHtml } from "../lib/html";
import { toast } from "../lib/motion";
import type { Watch } from "../lib/types";

/** The owner's main photo, or a quiet empty box if none was uploaded yet. */
export function photo(w: Watch, eager = false): SafeHtml {
  const src = w.images[0];
  return src
    ? h`<img src="${src}" alt="${w.name}" ${eager ? "" : 'loading="lazy"'} decoding="async">`
    : h`<span class="nophoto">No photo yet</span>`;
}

/** Small colour dots under a watch's name, when it comes in more than one colour. */
export function dots(w: Watch): SafeHtml {
  if (w.colors.length < 2) return h``;
  const shown = w.colors.slice(0, 6);
  return h`<span class="dots" aria-hidden="true">${shown.map((c) => h`<i class="sw" data-hex="${c.hex}"></i>`)}${w.colors.length > shown.length ? h`<em>+${w.colors.length - shown.length}</em>` : ""}</span>`;
}

export function watchCard(w: Watch): SafeHtml {
  const many = w.colors.length > 1 ? `, ${w.colors.length} colours` : "";
  return h`
    <a class="card" href="/watch/${w.slug}" aria-label="${w.name}, ${naira(w.price_kobo)}${many}${w.in_stock ? "" : ", sold out"}">
      <div class="tile">${photo(w)}${w.in_stock ? "" : h`<span class="tag">Sold out</span>`}</div>
      <div class="meta"><div><h3>${w.name}</h3>${dots(w)}</div><p class="price">${naira(w.price_kobo)}</p></div>
    </a>`;
}

/** An empty space in the catalogue. When the admin adds a watch, it takes the first of these. */
export function placeholderCard(): SafeHtml {
  return h`<div class="card ph" aria-hidden="true"><div class="tile"><span>Coming soon</span></div><div class="meta"><i class="sk"></i><i class="sk short"></i></div></div>`;
}

/** Fill a grid so it always shows whole rows, with at least `min` spaces. */
export function slots(watches: Watch[], min: number, perRow: number): SafeHtml[] {
  const total = Math.max(min, Math.ceil(watches.length / perRow) * perRow);
  return [...watches.map(watchCard), ...Array.from({ length: total - watches.length }, placeholderCard)];
}

export function newsletterForm(id = "nl"): SafeHtml {
  return h`
    <form class="nl" id="${id}" novalidate>
      <label for="${id}-email" class="sr-only">Email address</label>
      <input id="${id}-email" name="email" type="email" autocomplete="email" placeholder="Your email address" required maxlength="254">
      <button class="btn" type="submit">Join the list</button>
      <p class="nl-msg" role="status" aria-live="polite"></p>
    </form>`;
}

export function bindNewsletter(root: ParentNode, id = "nl"): void {
  const form = $<HTMLFormElement>(`#${id}`, root);
  if (!form) return;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = $(".nl-msg", form)!;
    const email = (form.elements.namedItem("email") as HTMLInputElement).value.trim();
    msg.textContent = "";
    try {
      await api("POST", "/api/newsletter/subscribe", { email });
      form.reset();
      msg.textContent = "You are on the list.";
      toast("You are on the list.");
    } catch (err) {
      msg.textContent = err instanceof ApiError ? err.message : "Something went wrong. Please try again.";
    }
  });
}

export const COLLECTION_INFO: Record<string, { title: string; blurb: string }> = {
  men: { title: "Men", blurb: "Automatics, chronographs and dress watches with some weight to them." },
  women: { title: "Women", blurb: "Small, bold, delicate and everyday pieces, cut to sit well." },
  neutral: { title: "Gender neutral", blurb: "Watches without a label, made for the wrist and not the stereotype." },
};
