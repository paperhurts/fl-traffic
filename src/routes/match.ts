// What's along a route: the cameras beside it, in the order you'd pass them,
// and FL511's events on it, marked by which way they block.

import { angleBetween, directionBearing, lineAngle, lineAxis, nearBox, place, type Measured } from "../geo";
import type { LngLat } from "../geo";
import { sameRoad } from "../nearby";
import type { Camera, TrafficEvent } from "../shared/types";

export interface Along<T> {
  item: T;
  /** Meters from the start of the route. */
  along: number;
  /** Meters off the route. */
  dist: number;
}

export interface CameraAlong extends Along<Camera> {
  /** Its road crosses the route here: kept only because it's close enough to see the route. */
  crossing: boolean;
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

/** True when a camera's road runs across the route there, judged by the long axis of the
 *  cameras on the same road within 3 km. One neighbor isn't enough: at a big interchange
 *  the nearest camera on the crossing road is often on a ramp alongside the route (SR-408's
 *  at I-4). Unknown, so false, when they're too few or don't make a line. */
export function crossesRoute(c: Camera, routeBearing: number, roads: Map<string, Camera[]>): boolean {
  const axis = lineAxis((roads.get(c.road) ?? []).map((o) => [o.lon, o.lat] as LngLat), [c.lon, c.lat], 3000);
  return axis !== null && lineAngle(axis, routeBearing) > 50;
}

export function camerasAlong(line: Measured, cams: Camera[], roads = byRoad(cams)): CameraAlong[] {
  const out: CameraAlong[] = [];
  for (const c of cams) {
    if (!nearBox(line.bbox, [c.lon, c.lat], CAMERA_METERS)) continue;
    const p = place(line, [c.lon, c.lat]);
    if (p.dist > CAMERA_METERS) continue;
    const crossing = crossesRoute(c, p.bearing, roads);
    if (crossing && p.dist > SURE_METERS) continue;
    out.push({ item: c, along: p.along, dist: p.dist, crossing });
  }
  return out.sort((a, b) => a.along - b.along);
}

/** True when the route's cameras near an event are all on roads other than the event's:
 *  the event is on a road the route only crosses (SR-528's ramps where I-4 passes over it).
 *  Cameras on crossing roads don't count, nor do cameras FL511 names no road for. Unknown,
 *  so false, where no camera nearby tells which road the route is on. */
export function onCrossingRoad(e: EventAlong, cams: CameraAlong[], meters = 3000): boolean {
  if (!e.item.road) return false;
  // FL511 files Tampa's city cameras under "for City of Tampa cameras", which names no road.
  const near = cams.filter((c) => !c.crossing && Math.abs(c.along - e.along) <= meters && !/^for /i.test(c.item.road));
  return near.length > 0 && !near.some((c) => sameRoad(c.item.road, e.item.road));
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
