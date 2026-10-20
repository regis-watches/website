import { api } from "./api";
import type { Watch, WatchColor } from "./types";

let cache: { at: number; list: Watch[] } | null = null;

/** The whole catalogue is small, so it is fetched once and reused for the bag, search and related items. */
export async function allWatches(force = false): Promise<Watch[]> {
  if (!force && cache && Date.now() - cache.at < 60_000) return cache.list;
  const res = await api<{ watches: Watch[] }>("GET", "/api/watches");
  cache = { at: Date.now(), list: res.watches };
  return res.watches;
}

export async function watchMap(): Promise<Map<string, Watch>> {
  return new Map((await allWatches()).map((w) => [w.slug, w]));
}

/** The colour a bag line points at. Falls back to the first colour in stock if that colour has since been removed. */
export function colorOf(w: Watch, id: number | null): WatchColor {
  return w.colors.find((c) => c.id === id) ?? w.colors.find((c) => c.in_stock) ?? w.colors[0];
}

/** "Meridian 38 (Midnight)", or just the watch name when it comes in one colour. */
export const lineName = (w: { name: string }, c: { name: string }): string => (c.name ? `${w.name} (${c.name})` : w.name);

/** A colour's main photo, or the watch's cover photo when that colour has none yet. */
export const colorPhoto = (w: Watch, c: WatchColor): string | undefined => c.images[0] ?? w.images[0];

export function invalidateCatalog(): void {
  cache = null;
}
