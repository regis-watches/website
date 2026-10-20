/**
 * Light and dark mode. The choice is saved on this device and applies to every page, including the admin.
 * Until the visitor chooses, the site follows their device setting. public/theme.js applies the saved theme
 * before first paint; this module handles the toggle button and keeps everything in step afterwards.
 */
import { h, raw, SafeHtml } from "./html";

export type Theme = "light" | "dark";
const KEY = "regis.theme";
const BAR: Record<Theme, string> = { light: "#F5F1E8", dark: "#0F1A15" };

export function currentTheme(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function saved(): Theme | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === "dark" || v === "light" ? v : null;
  } catch {
    return null;
  }
}

function syncToggles(): void {
  const dark = currentTheme() === "dark";
  document.querySelectorAll<HTMLElement>("[data-theme-toggle]").forEach((b) => {
    b.setAttribute("aria-pressed", String(dark));
    b.title = dark ? "Switch to light mode" : "Switch to dark mode";
  });
}

export function applyTheme(t: Theme, remember: boolean): void {
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", BAR[t]);
  if (remember) {
    try { localStorage.setItem(KEY, t); } catch { /* private mode: the choice lasts until the tab closes */ }
  }
  syncToggles();
}

export function toggleTheme(): void {
  applyTheme(currentTheme() === "dark" ? "light" : "dark", true);
}

/** The toggle button. Put it anywhere; clicks are handled for every button carrying data-theme-toggle. */
export function themeToggle(extraClass = ""): SafeHtml {
  const dark = currentTheme() === "dark";
  return h`<button class="theme-toggle ${extraClass}" type="button" data-theme-toggle aria-label="Dark mode" aria-pressed="${dark}" title="${dark ? "Switch to light mode" : "Switch to dark mode"}">
    ${raw(`<svg class="ico-moon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.2A8.2 8.2 0 0 1 9.8 4a8.2 8.2 0 1 0 10.2 10.2z"/></svg>`)}
    ${raw(`<svg class="ico-sun" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6"/></svg>`)}
  </button>`;
}

export function initTheme(): void {
  syncToggles();
  document.addEventListener("click", (e) => {
    if ((e.target as Element).closest("[data-theme-toggle]")) toggleTheme();
  });
  // Until the visitor chooses a theme, follow the device when it switches (for example at sunset).
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
    if (!saved()) applyTheme(e.matches ? "dark" : "light", false);
  });
}
