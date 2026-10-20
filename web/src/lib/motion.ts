/** Deliberately tiny. The site is quiet: no smooth-scroll library, no scroll effects, no page transitions. */
import { $ } from "./html";
import { reduced } from "./motion-flag";

export function scrollToTop(): void {
  window.scrollTo(0, 0);
}

export function scrollToEl(el: Element): void {
  el.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" });
}

export function lockScroll(lock: boolean): void {
  document.documentElement.classList.toggle("locked", lock);
}

let toastTimer: number | undefined;
export function toast(message: string): void {
  const t = $("#toast");
  if (!t) return;
  t.textContent = message;
  t.classList.add("show");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.classList.remove("show"), 3000);
}

export function announce(message: string): void {
  const el = $("#sr-live");
  if (el) el.textContent = message;
}
