import { $, SafeHtml } from "./html";
import { scrollToTop, announce } from "./motion";
import { reportError } from "./api";

export interface PageResult {
  html: SafeHtml;
  title: string;
  description?: string;
  /** Runs after the markup is in the page. May return a cleanup function. */
  mount?: (root: HTMLElement) => void | (() => void) | Promise<void | (() => void)>;
  /** Pages that bring their own chrome (the admin) hide the public header and footer. */
  bare?: boolean;
}

type Handler = (params: Record<string, string>, query: URLSearchParams) => PageResult | Promise<PageResult>;

const routes: { re: RegExp; keys: string[]; handler: Handler }[] = [];
let notFound: Handler = () => ({ html: new SafeHtml("<p>Not found</p>"), title: "Not found" });
let cleanup: (() => void) | null = null;
let current = "";
let busy = false;
let onAfter: () => void = () => undefined;

/** Full page load of a path. Used after sign in or sign out so every page picks up the new session. */
export function hardNavigate(path: string): void {
  location.assign(path);
}

export function route(pattern: string, handler: Handler): void {
  const keys: string[] = [];
  const re = new RegExp("^" + pattern.replace(/:([a-z]+)/g, (_, k) => { keys.push(k); return "([^/]+)"; }) + "/?$");
  routes.push({ re, keys, handler });
}

export function setNotFound(h: Handler): void {
  notFound = h;
}

export function afterNavigate(fn: () => void): void {
  onAfter = fn;
}

export function currentPath(): string {
  return current;
}

function resolve(path: string): { handler: Handler; params: Record<string, string> } {
  for (const r of routes) {
    const m = r.re.exec(path);
    if (m) {
      const params: Record<string, string> = {};
      r.keys.forEach((k, i) => { try { params[k] = decodeURIComponent(m[i + 1]); } catch { params[k] = m[i + 1]; } });
      return { handler: r.handler, params };
    }
  }
  return { handler: notFound, params: {} };
}

async function render(url: URL, first: boolean): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    cleanup?.();
    cleanup = null;
    const main = $("#main")!;
    const { handler, params } = resolve(url.pathname.replace(/\/+$/, "") || "/");
    let page: PageResult;
    try {
      page = await handler(params, url.searchParams);
    } catch (e) {
      reportError(String(e), url.pathname);
      page = {
        title: "Something went wrong | Regis",
        html: new SafeHtml(`<section class="page narrow"><p class="eyebrow">Error</p><h1 class="display">That did not work.</h1><p class="lede">Something went wrong on our side. Please try again in a moment.</p><p><a class="btn" href="/">Back to the start</a></p></section>`),
      };
    }
    main.innerHTML = page.html.value;
    document.title = page.title;
    if (page.description) $('meta[name="description"]')?.setAttribute("content", page.description);
    document.body.classList.toggle("bare", !!page.bare);
    current = url.pathname + url.search;
    scrollToTop();
    main.classList.remove("enter");
    void main.offsetWidth; // restart the one soft fade
    main.classList.add("enter");
    const c = await page.mount?.(main);
    if (typeof c === "function") cleanup = c;
    onAfter();
    if (!first) main.focus({ preventScroll: true });
    announce(page.title);
  } finally {
    busy = false;
  }
}

export function navigate(path: string, replace = false): void {
  const url = new URL(path, location.origin);
  if (url.origin !== location.origin) { location.href = path; return; }
  if (url.pathname + url.search === current && !replace) return;
  if (replace) history.replaceState({}, "", url); else history.pushState({}, "", url);
  void render(url, false);
}

export function startRouter(): void {
  window.addEventListener("popstate", () => void render(new URL(location.href), false));
  document.addEventListener("click", (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as Element).closest<HTMLAnchorElement>("a[href]");
    if (!a || a.target === "_blank" || a.hasAttribute("download") || a.dataset.native !== undefined) return;
    const href = a.getAttribute("href")!;
    if (!href.startsWith("/") || href.startsWith("//") || href.startsWith("/api/") || href.startsWith("/uploads/")) return;
    if (href.startsWith("/#")) return;
    e.preventDefault();
    navigate(href);
  });
  void render(new URL(location.href), true);
}
