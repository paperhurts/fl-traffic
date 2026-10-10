// Routes in a link: someone sets up drives and texts them to someone else, whose
// browser saves them like routes made there. The link carries each route's name
// and two ends in its fragment, which browsers never send to a server, with the
// ends rounded to about a block and street addresses cut down to their town, so a
// forwarded link doesn't pin anyone's house.

import type { Place, SavedRoute } from "./store";

/** The fragment's key: #routes=… */
const KEY = "routes";

/** More than anyone texts at once; a link is a few hundred characters for two. */
const MOST = 12;

/** A route as a link carries it. */
export interface SharedRoute {
  name: string;
  from: Place;
  to: Place;
}

/** "Moffitt Cancer Center, Tampa" → "Moffitt Cancer Center" */
export const short = (label: string) => label.split(",")[0].trim();

/** The name a route gets when nobody names it. */
export const autoName = (from: Place, to: Place) => `${short(from.label)} to ${short(to.label)}`;

/** Three decimals of a degree: about 110 m, a block. */
const round = (deg: number) => Math.round(deg * 1000) / 1000;

const STATE_OR_ZIP = /^([A-Z]{2})?\s*(\d{5}(-\d{4})?)?$/;

/** A place's label without its street address: "1200 Main St, Brooksville, FL 34601" → "Brooksville".
 *  A spot named by its coordinates becomes "A spot on the map". Places with names keep them. */
export function shareLabel(label: string): string {
  const parts = label.split(",").map((p) => p.trim()).filter(Boolean);
  if (!parts.length || !/^-?\d/.test(parts[0])) return label.trim();
  return parts.slice(1).find((p) => /[a-z]/i.test(p) && !STATE_OR_ZIP.test(p)) ?? "A spot on the map";
}

/** A route as its link would carry it: ends rounded, addresses cut to their town, and an
 *  automatic name made again from what's left. */
export function sharedRoute(r: SavedRoute): SharedRoute {
  const end = (p: Place): Place => ({ lon: round(p.lon), lat: round(p.lat), label: shareLabel(p.label) });
  const from = end(r.from);
  const to = end(r.to);
  return { name: r.name === autoName(r.from, r.to) ? autoName(from, to) : r.name, from, to };
}

const toBase64Url = (s: string) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(s)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

const fromBase64Url = (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)));

/** A link to this page that offers these routes to whoever opens it. */
export function shareLink(routes: SavedRoute[], page: string): string {
  const wire = routes.slice(0, MOST).map((r) => {
    const s = sharedRoute(r);
    return [s.name, [s.from.lon, s.from.lat, s.from.label], [s.to.lon, s.to.lat, s.to.label]];
  });
  return `${page}#${KEY}=${toBase64Url(JSON.stringify([1, wire]))}`;
}

const text = (v: unknown, most: number) => (typeof v === "string" ? v.trim().slice(0, most) : "");

function place(v: unknown): Place | null {
  if (!Array.isArray(v)) return null;
  const [lon, lat, label] = v;
  if (typeof lon !== "number" || typeof lat !== "number" || Math.abs(lon) > 180 || Math.abs(lat) > 90) return null;
  return { lon, lat, label: text(label, 120) || "A spot on the map" };
}

/** The routes a page's fragment offers, or null when it offers none (or can't be read). */
export function routesInLink(hash: string): SharedRoute[] | null {
  const value = new URLSearchParams(hash.replace(/^#/, "")).get(KEY);
  if (!value) return null;
  let wire: unknown;
  try {
    wire = JSON.parse(fromBase64Url(value));
  } catch {
    return null;
  }
  if (!Array.isArray(wire) || wire[0] !== 1 || !Array.isArray(wire[1])) return null;
  const routes: SharedRoute[] = [];
  for (const r of wire[1].slice(0, MOST)) {
    if (!Array.isArray(r)) continue;
    const from = place(r[1]);
    const to = place(r[2]);
    if (from && to) routes.push({ name: text(r[0], 80) || autoName(from, to), from, to });
  }
  return routes.length ? routes : null;
}

/** Whether a saved route is already the one a link offers: the same name and ends. */
export function alreadySaved(saved: SavedRoute, offered: SharedRoute): boolean {
  const s = sharedRoute(saved);
  return s.name === offered.name && [s.from.lon, s.from.lat, s.to.lon, s.to.lat].join() === [offered.from.lon, offered.from.lat, offered.to.lon, offered.to.lat].join();
}
