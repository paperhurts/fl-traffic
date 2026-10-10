// How the routes panel puts a drive into words.

import { duration } from "../format";
import type { EventAlong } from "./match";
import type { RoadRun, RouteResult } from "./tomtom";

/** A road counts toward a way's name once the way follows it for a mile. */
const NAMES_FROM = 1609.344;

const totals = (roads: RoadRun[]) => {
  const t = new Map<string, number>();
  for (const r of roads) t.set(r.road, (t.get(r.road) ?? 0) + r.meters);
  return t;
};

/** What to call each way: the road it follows farthest ("I-75"), and when another way's is the same,
 *  the road that sets it apart ("I-75 and US-41"). "local roads" when it follows no numbered road for a mile. */
export function wayNames(ways: { roads: RoadRun[] }[]): string[] {
  const t = ways.map((w) => totals(w.roads));
  const main = t.map((m) => {
    let best: string | null = null;
    for (const [road, meters] of m) if (meters >= NAMES_FROM && (!best || meters > m.get(best)!)) best = road;
    return best;
  });
  return ways.map((_, i) => {
    const m = main[i];
    if (!m) return "local roads";
    if (!main.some((o, j) => j !== i && o === m)) return m;
    let apart: string | null = null;
    let most = NAMES_FROM;
    for (const [road, meters] of t[i]) {
      if (road === m) continue;
      const lead = meters - Math.max(0, ...t.filter((_, j) => j !== i).map((o) => o.get(road) ?? 0));
      if (lead >= most) [apart, most] = [road, lead];
    }
    return apart ? `${m} and ${apart}` : m;
  });
}

/** The way that's usually fastest at this hour: the one with the shortest usual time. */
export function usuallyFastest(ways: RouteResult[]): number | null {
  let best: number | null = null;
  ways.forEach((w, i) => {
    if (w.usual !== null && (best === null || w.usual < ways[best].usual!)) best = i;
  });
  return best;
}

/** "6 min slower than usual", "about as usual", or the time lost to traffic when TomTom gives no usual time. */
export function compareUsual(r: RouteResult): string {
  if (r.usual !== null) {
    const d = r.seconds - r.usual;
    if (d >= 120) return `${duration(d)} slower than usual`;
    if (d <= -120) return `${duration(-d)} faster than usual`;
    return "about as usual";
  }
  return r.delay >= 60 ? `${duration(r.delay)} lost to traffic` : "traffic is light";
}

const WORDS = {
  crash: ["a crash", "crashes"],
  closure: ["a closure", "closures"],
  incident: ["an incident", "incidents"],
} as const;

/** "a crash", "2 crashes and a closure" */
export function countWords(events: EventAlong[]): string {
  const n = new Map<keyof typeof WORDS, number>();
  for (const e of events) {
    const k = e.item.kind === "crash" ? "crash" : e.item.kind === "closure" || e.item.full ? "closure" : "incident";
    n.set(k, (n.get(k) ?? 0) + 1);
  }
  const parts = [...n].map(([k, c]) => (c === 1 ? WORDS[k][0] : `${c} ${WORDS[k][1]}`));
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : (parts[0] ?? "");
}

/** "at the start", "at mile 12" */
export const atMile = (meters: number) => (meters < 0.5 * 1609.344 ? "at the start" : `at mile ${Math.round(meters / 1609.344)}`);

/** "Start", "Mile 12": where a camera is on the route. */
export const milepost = (meters: number) => (meters < 0.5 * 1609.344 ? "Start" : `Mile ${Math.round(meters / 1609.344)}`);
