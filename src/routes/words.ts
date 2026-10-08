// How the routes panel puts a drive into words.

import { duration } from "../format";
import type { EventAlong } from "./match";
import type { RouteResult } from "./tomtom";

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
