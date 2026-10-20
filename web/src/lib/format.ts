export function naira(kobo: number): string {
  const whole = Math.floor(kobo / 100);
  const cents = kobo % 100;
  const base = "\u20a6" + whole.toLocaleString("en-NG");
  return cents ? `${base}.${String(cents).padStart(2, "0")}` : base;
}

const dateFmt = new Intl.DateTimeFormat("en-NG", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Lagos" });
const timeFmt = new Intl.DateTimeFormat("en-NG", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Africa/Lagos" });

export function dateTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${dateFmt.format(d)}, ${timeFmt.format(d)}`;
}

export function shortDate(iso: string): string {
  return dateFmt.format(new Date(iso));
}

export const COLLECTION_LABEL: Record<string, string> = {
  men: "Men",
  women: "Women",
  neutral: "Gender neutral",
};

export function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}
