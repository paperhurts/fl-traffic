// TomTom's routing (with live traffic) and place search. Both count against
// the key's free daily allowance of non-tile requests, so the page calls them
// only when a route is opened or refreshed, and when a search is submitted.
// One routing request returns the best way and up to two others, each with the
// numbered roads it follows (TomTom's road shields), so a jam on the usual road
// shows next to the ways around it.

import { distance, type LngLat } from "../geo";
import type { Place } from "./store";

const API = "https://api.tomtom.com";

export interface Jam {
  /** Point indexes into the route's line. */
  from: number;
  to: number;
  /** 1 minor, 2 moderate, 3 major, 4 closed or indefinite; 0 unknown. */
  magnitude: number;
  delay: number;
  speedKmh: number | null;
  /** JAM, ROAD_WORK, ROAD_CLOSURE, or OTHER. */
  category: string;
}

/** How the page draws and words a stretch. TomTom gives roadwork of unknown delay its
 *  top magnitude (4, "undefined"), so the category decides before the magnitude does. */
export type JamKind = "closed" | "heavy" | "slow" | "work";

export function jamKind(j: Jam): JamKind {
  if (j.category === "ROAD_CLOSURE") return "closed";
  if (j.category === "ROAD_WORK") return "work";
  return j.magnitude >= 3 ? "heavy" : "slow";
}

/** Closures and roadwork always get a line; a slowdown, once it costs half a minute. */
export const worthShowing = (j: Jam) => j.category === "ROAD_CLOSURE" || j.category === "ROAD_WORK" || j.delay >= 30;

/** A stretch of a way on one numbered road. */
export interface RoadRun {
  /** "I-75", "US-301", "Turnpike", "SR-200", "CR-491". */
  road: string;
  meters: number;
}

/** One way to make a drive. */
export interface RouteResult {
  line: LngLat[];
  meters: number;
  /** Seconds, in today's traffic. */
  seconds: number;
  /** Seconds lost to traffic against free flow. */
  delay: number;
  noTraffic: number | null;
  /** What the drive usually takes at this hour. */
  usual: number | null;
  jams: Jam[];
  /** The numbered roads it follows, in order. */
  roads: RoadRun[];
  /** When TomTom answered (ms). */
  at: number;
}

interface TomTomShield {
  /** "usa-interstate", "usa-highway", "usa-fl-state-route", "usa-county-highway", ... */
  reference?: string;
  /** The number on the shield. */
  shieldContent?: string;
}

interface TomTomRoute {
  summary: {
    lengthInMeters: number;
    travelTimeInSeconds: number;
    trafficDelayInSeconds?: number;
    noTrafficTravelTimeInSeconds?: number;
    historicTrafficTravelTimeInSeconds?: number;
  };
  legs: { points: { latitude: number; longitude: number }[] }[];
  sections?: {
    sectionType: string;
    startPointIndex: number;
    endPointIndex: number;
    simpleCategory?: string;
    magnitudeOfDelay?: number;
    delayInSeconds?: number;
    effectiveSpeedInKmh?: number;
    roadShieldReferences?: TomTomShield[];
  }[];
}

/** Toll roads people know by name. FL511 names these the same way. */
const NAMED: Record<string, string> = { "91": "Turnpike", "821": "Turnpike", "869": "Sawgrass Expwy", "618": "Selmon Expwy" };

/** SR-589 is the Veterans Expressway south of here and the Suncoast Parkway north of it (between FL511's cameras on each). */
const SUNCOAST_FROM_LAT = 28.175;

/** A road shield in words, and how much it outranks the others on a stretch where routes share the road
 *  (US-301 over the state road that runs with it): lower wins. */
export function shieldName(s: TomTomShield, lat: number): { name: string; rank: number } | null {
  const ref = s.reference ?? "";
  const n = s.shieldContent?.trim();
  if (!n) return null;
  // TomTom spells it "usa-highway-buisness-route".
  if (/bu[is]{1,2}ness/.test(ref)) return { name: `${ref.includes("interstate") ? "I" : "US"}-${n} Bus`, rank: 4 };
  if (ref.includes("interstate")) return { name: `I-${n}`, rank: 0 };
  if (ref === "usa-highway") return { name: `US-${n}`, rank: 1 };
  if (ref.includes("state-route")) {
    if (ref === "usa-fl-state-route" && n === "589") return { name: lat < SUNCOAST_FROM_LAT ? "Veterans Expwy" : "Suncoast Pkwy", rank: 1 };
    if (ref === "usa-fl-state-route" && NAMED[n]) return { name: NAMED[n], rank: 1 };
    return { name: `SR-${n}`, rank: 2 };
  }
  if (ref.includes("county")) return { name: `CR-${n}`, rank: 3 };
  return { name: n, rank: 5 };
}

/** The roads a way follows, from TomTom's road shield sections. Where routes share a road,
 *  the stretch goes to the most important one, then to the one the way follows farthest. */
export function roadRuns(sections: NonNullable<TomTomRoute["sections"]>, line: LngLat[]): RoadRun[] {
  const cum = [0];
  for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + distance(line[i - 1], line[i]));
  const stretches = sections
    .filter((x) => x.sectionType === "ROAD_SHIELDS" && x.startPointIndex >= 0 && x.endPointIndex < line.length && x.endPointIndex > x.startPointIndex)
    .map((x) => {
      const lat = line[Math.round((x.startPointIndex + x.endPointIndex) / 2)][1];
      const names = (x.roadShieldReferences ?? []).map((s) => shieldName(s, lat)).filter((s) => s !== null);
      return { names, meters: cum[x.endPointIndex] - cum[x.startPointIndex] };
    });
  const farthest = new Map<string, number>();
  for (const s of stretches) for (const { name } of s.names) farthest.set(name, (farthest.get(name) ?? 0) + s.meters);
  const runs: RoadRun[] = [];
  for (const s of stretches) {
    const best = s.names.reduce<{ name: string; rank: number } | null>(
      (a, b) => (!a || b.rank < a.rank || (b.rank === a.rank && farthest.get(b.name)! > farthest.get(a.name)!) ? b : a),
      null,
    );
    if (!best) continue;
    const last = runs[runs.length - 1];
    if (last?.road === best.name) last.meters += s.meters;
    else runs.push({ road: best.name, meters: s.meters });
  }
  return runs;
}

/** Every way TomTom offers, fastest first. */
export function parseRoutes(json: { routes?: TomTomRoute[] }, at = Date.now()): RouteResult[] {
  const ways = (json.routes ?? []).map((r) => parseWay(r, at));
  if (!ways.length) throw new Error("TomTom found no route between those places.");
  return ways.sort((a, b) => a.seconds - b.seconds);
}

function parseWay(r: TomTomRoute, at: number): RouteResult {
  const line: LngLat[] = [];
  for (const leg of r.legs) for (const p of leg.points) line.push([p.longitude, p.latitude]);
  const s = r.summary;
  return {
    line,
    meters: s.lengthInMeters,
    seconds: s.travelTimeInSeconds,
    delay: s.trafficDelayInSeconds ?? 0,
    noTraffic: s.noTrafficTravelTimeInSeconds ?? null,
    usual: s.historicTrafficTravelTimeInSeconds ?? null,
    jams: (r.sections ?? [])
      .filter((x) => x.sectionType === "TRAFFIC")
      .map((x) => ({
        from: x.startPointIndex,
        to: x.endPointIndex,
        magnitude: x.magnitudeOfDelay ?? 0,
        delay: x.delayInSeconds ?? 0,
        speedKmh: x.effectiveSpeedInKmh ?? null,
        category: x.simpleCategory ?? "OTHER",
      }))
      .filter((j) => j.to > j.from && j.from >= 0 && j.to < line.length),
    roads: roadRuns(r.sections ?? [], line),
    at,
  };
}

async function call(url: string, signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(url, { signal });
  if (res.status === 403 || res.status === 401) throw new Error("TomTom turned the key down (or its free daily limit is used up).");
  if (res.status === 429) throw new Error("TomTom asked the page to slow down. Try again in a minute.");
  if (!res.ok) throw new Error(`TomTom couldn't answer (HTTP ${res.status}).`);
  return res.json();
}

/** The ways to make a drive in today's traffic, fastest first: TomTom's best and up to two others, in one request. */
export async function route(key: string, from: Place, to: Place, signal?: AbortSignal): Promise<RouteResult[]> {
  const where = `${from.lat.toFixed(6)},${from.lon.toFixed(6)}:${to.lat.toFixed(6)},${to.lon.toFixed(6)}`;
  const q = new URLSearchParams({
    key,
    traffic: "true",
    travelMode: "car",
    routeType: "fastest",
    computeTravelTimeFor: "all",
    maxAlternatives: "2",
    routeRepresentation: "polyline",
  });
  q.append("sectionType", "traffic");
  q.append("sectionType", "roadShields");
  return parseRoutes((await call(`${API}/routing/1/calculateRoute/${where}/json?${q}`, signal)) as { routes?: TomTomRoute[] });
}

interface SearchResult {
  type?: string;
  poi?: { name?: string };
  address?: { freeformAddress?: string; municipality?: string; countrySubdivision?: string };
  position?: { lat: number; lon: number };
}

export function parsePlaces(json: { results?: SearchResult[]; addresses?: { address?: SearchResult["address"]; position?: string }[] }): Place[] {
  const out: Place[] = [];
  for (const r of json.results ?? []) {
    if (!r.position) continue;
    const town = r.address?.municipality;
    const label = r.poi?.name ? [r.poi.name, town].filter(Boolean).join(", ") : (r.address?.freeformAddress ?? "");
    if (label) out.push({ lon: r.position.lon, lat: r.position.lat, label });
  }
  return out;
}

/** Places matching a search, nearest the map's center first. */
export async function search(key: string, text: string, near: LngLat, signal?: AbortSignal): Promise<Place[]> {
  const q = new URLSearchParams({
    key,
    limit: "6",
    countrySet: "US",
    lat: near[1].toFixed(4),
    lon: near[0].toFixed(4),
    language: "en-US",
  });
  return parsePlaces((await call(`${API}/search/2/search/${encodeURIComponent(text)}.json?${q}`, signal)) as { results?: SearchResult[] });
}

/** A label for a spot picked on the map: its street address, or its coordinates. */
export async function nameOf(key: string, at: LngLat, signal?: AbortSignal): Promise<string> {
  const fallback = `${at[1].toFixed(4)}, ${at[0].toFixed(4)}`;
  try {
    const json = (await call(`${API}/search/2/reverseGeocode/${at[1].toFixed(6)},${at[0].toFixed(6)}.json?key=${encodeURIComponent(key)}`, signal)) as {
      addresses?: { address?: { freeformAddress?: string } }[];
    };
    return json.addresses?.[0]?.address?.freeformAddress || fallback;
  } catch {
    return fallback;
  }
}
