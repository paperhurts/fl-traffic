// What's along a route: the cameras beside it, in the order you'd pass them,
// and FL511's events on it, marked by which way they block.

import { angleBetween, bearing, directionBearing, distance, lineAngle, nearBox, place, type Measured } from "../geo";
import type { Camera, TrafficEvent } from "../shared/types";

export interface Along<T> {
  item: T;
  /** Meters from the start of the route. */
  along: number;
  /** Meters off the route. */
  dist: number;
}

export interface EventAlong extends Along<TrafficEvent> {
  /** False when FL511 says the event is on the other side of the road from the way the route goes. */
  sameWay: boolean;
}

/** Cameras beside a road are this far at most from the route's line. */
export const CAMERA_METERS = 120;
/** A camera this close is on the route whichever road FL511 files it under. */
const SURE_METERS = 35;
export const EVENT_METERS = 200;

export function byRoad(cams: Camera[]): Map<string, Camera[]> {
  const m = new Map<string, Camera[]>();
  for (const c of cams) {
    const list = m.get(c.road);
    if (list) list.push(c);
    else m.set(c.road, [c]);
  }
  return m;
}

/** True when a camera's road runs across the route there, judged by the line to the
 *  nearest camera on the same road 300 m to 5 km away (closer ones can be the other
 *  side of the same highway). Unknown when the road has no such camera. */
export function crossesRoute(c: Camera, routeBearing: number, roads: Map<string, Camera[]>): boolean {
  let best: Camera | null = null;
  let bestD = Infinity;
  for (const o of roads.get(c.road) ?? []) {
    if (o === c || Math.abs(o.lat - c.lat) > 0.05 || Math.abs(o.lon - c.lon) > 0.06) continue;
    const d = distance([c.lon, c.lat], [o.lon, o.lat]);
    if (d >= 300 && d <= 5000 && d < bestD) {
      best = o;
      bestD = d;
    }
  }
  return !!best && lineAngle(bearing([c.lon, c.lat], [best.lon, best.lat]), routeBearing) > 50;
}

export function camerasAlong(line: Measured, cams: Camera[], roads = byRoad(cams)): Along<Camera>[] {
  const out: Along<Camera>[] = [];
  for (const c of cams) {
    if (!nearBox(line.bbox, [c.lon, c.lat], CAMERA_METERS)) continue;
    const p = place(line, [c.lon, c.lat]);
    if (p.dist > CAMERA_METERS) continue;
    if (p.dist > SURE_METERS && crossesRoute(c, p.bearing, roads)) continue;
    out.push({ item: c, along: p.along, dist: p.dist });
  }
  return out.sort((a, b) => a.along - b.along);
}

export function eventsAlong(line: Measured, events: TrafficEvent[]): EventAlong[] {
  const out: EventAlong[] = [];
  for (const e of events) {
    if (!nearBox(line.bbox, [e.lon, e.lat], EVENT_METERS)) continue;
    const p = place(line, [e.lon, e.lat]);
    if (p.dist > EVENT_METERS) continue;
    const b = directionBearing(e.dir);
    // Road directions are nominal (I-4 "east" runs north through Orlando), so only the nearer of the two counts.
    out.push({ item: e, along: p.along, dist: p.dist, sameWay: b === null || angleBetween(b, p.bearing) <= 90 });
  }
  return out.sort((a, b) => a.along - b.along);
}
