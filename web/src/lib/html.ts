/**
 * Tiny templating layer with automatic escaping. Every interpolated value is HTML-escaped unless it is
 * explicitly marked safe, so user-supplied text (names, addresses, notes) can never become markup.
 */
export class SafeHtml {
  constructor(readonly value: string) {}
  toString(): string {
    return this.value;
  }
}

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function esc(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ESC[c]);
}

/** Mark a string as trusted markup. Only use for markup this app generated itself. */
export function raw(markup: string): SafeHtml {
  return new SafeHtml(markup);
}

function part(v: unknown): string {
  if (v instanceof SafeHtml) return v.value;
  if (Array.isArray(v)) return v.map(part).join("");
  if (v === false || v === null || v === undefined) return "";
  return esc(v);
}

export function h(strings: TemplateStringsArray, ...values: unknown[]): SafeHtml {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += part(values[i]) + strings[i + 1];
  return new SafeHtml(out);
}

/** Internal paths only. Anything else becomes "/" so a data-driven link can never be a javascript: URL. */
export function safePath(p: string): string {
  return /^\/(?!\/)[A-Za-z0-9\-_/?=&%.]*$/.test(p) ? p : "/";
}

export function $<T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T | null {
  return root.querySelector<T>(sel);
}

export function $$<T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T[] {
  return Array.from(root.querySelectorAll<T>(sel));
}

export function mountHtml(el: Element, html: SafeHtml): void {
  el.innerHTML = html.value;
}
