// Distances and positions along a line, accurate to a few meters over a route
// (each step is projected flat around the point being placed).

import type { Direction } from "./shared/types";

export type LngLat = [number, number];

const M_PER_DEG = 111_195; // meters per degree of latitude (and of longitude at the equator)
const rad = Math.PI / 180;

/** Meters between two points (flat at their mean latitude; fine for the distances this page compares). */
export function distance(a: LngLat, b: LngLat): number {
  const k = Math.cos(((a[1] + b[1]) / 2) * rad);
  return Math.hypot((b[0] - a[0]) * k, b[1] - a[1]) * M_PER_DEG;
}

/** Compass bearing from a to b, 0 = north, 90 = east. */
export function bearing(a: LngLat, b: LngLat): number {
  const k = Math.cos(((a[1] + b[1]) / 2) * rad);
  const deg = Math.atan2((b[0] - a[0]) * k, b[1] - a[1]) / rad;
  return (deg + 360) % 360;
}

/** The smaller angle between two bearings, 0–180. */
export function angleBetween(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/** The angle between two lines that have no direction, 0–90. */
export function lineAngle(a: number, b: number): number {
  const d = angleBetween(a, b);
  return d > 90 ? 180 - d : d;
}

/** FL511's direction labels as bearings; null for both ways or unknown. */
export function directionBearing(d: Direction): number | null {
  return d === "N" ? 0 : d === "E" ? 90 : d === "S" ? 180 : d === "W" ? 270 : null;
}

export interface Measured {
  pts: LngLat[];
  /** Meters from the start to each point. */
  cum: number[];
  length: number;
  /** west, south, east, north */
  bbox: [number, number, number, number];
}

export function measure(pts: LngLat[]): Measured {
  const cum = [0];
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (let i = 0; i < pts.length; i++) {
    if (i) cum.push(cum[i - 1] + distance(pts[i - 1], pts[i]));
    w = Math.min(w, pts[i][0]);
    e = Math.max(e, pts[i][0]);
    s = Math.min(s, pts[i][1]);
    n = Math.max(n, pts[i][1]);
  }
  return { pts, cum, length: cum[cum.length - 1] ?? 0, bbox: [w, s, e, n] };
}

export interface Placement {
  /** Meters from the point to the line. */
  dist: number;
  /** Meters along the line to the nearest spot on it. */
  along: number;
  /** The line's bearing there. */
  bearing: number;
}

/** The nearest spot on a line to a point. */
export function place(line: Measured, p: LngLat): Placement {
  const k = Math.cos(p[1] * rad);
  let best: Placement = { dist: Infinity, along: 0, bearing: 0 };
  const { pts, cum } = line;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const ax = (a[0] - p[0]) * k;
    const ay = a[1] - p[1];
    const dx = (b[0] - a[0]) * k;
    const dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
    const d = Math.hypot(ax + t * dx, ay + t * dy) * M_PER_DEG;
    if (d < best.dist) best = { dist: d, along: cum[i - 1] + t * (cum[i] - cum[i - 1]), bearing: bearing(a, b) };
  }
  return best;
}

/** True when a point is within `meters` of a box (west, south, east, north). */
export function nearBox(box: [number, number, number, number], p: LngLat, meters: number): boolean {
  const dLat = meters / M_PER_DEG;
  const dLon = dLat / Math.cos(p[1] * rad);
  return p[0] >= box[0] - dLon && p[0] <= box[2] + dLon && p[1] >= box[1] - dLat && p[1] <= box[3] + dLat;
}

/** The part of a line between two distances along it. */
export function slice(line: Measured, from: number, to: number): LngLat[] {
  const out: LngLat[] = [];
  const at = (d: number): LngLat => {
    let i = 1;
    while (i < line.cum.length - 1 && line.cum[i] < d) i++;
    const a = line.pts[i - 1];
    const b = line.pts[i];
    const seg = line.cum[i] - line.cum[i - 1];
    const t = seg ? Math.max(0, Math.min(1, (d - line.cum[i - 1]) / seg)) : 0;
    return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
  };
  out.push(at(from));
  for (let i = 0; i < line.pts.length; i++) if (line.cum[i] > from && line.cum[i] < to) out.push(line.pts[i]);
  out.push(at(to));
  return out;
}
