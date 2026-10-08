// TomTom's routing (with live traffic) and place search. Both count against
// the key's free daily allowance of non-tile requests, so the page calls them
// only when a route is opened or refreshed, and when a search is submitted.

import type { LngLat } from "../geo";
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
  /** When TomTom answered (ms). */
  at: number;
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
  }[];
}

export function parseRoute(json: { routes?: TomTomRoute[] }, at = Date.now()): RouteResult {
  const r = json.routes?.[0];
  if (!r) throw new Error("TomTom found no route between those places.");
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

export async function route(key: string, from: Place, to: Place, signal?: AbortSignal): Promise<RouteResult> {
  const where = `${from.lat.toFixed(6)},${from.lon.toFixed(6)}:${to.lat.toFixed(6)},${to.lon.toFixed(6)}`;
  const q = new URLSearchParams({
    key,
    traffic: "true",
    travelMode: "car",
    routeType: "fastest",
    computeTravelTimeFor: "all",
    sectionType: "traffic",
    routeRepresentation: "polyline",
  });
  return parseRoute((await call(`${API}/routing/1/calculateRoute/${where}/json?${q}`, signal)) as { routes?: TomTomRoute[] });
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
