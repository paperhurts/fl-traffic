// Cameras to show beside an event: close by, and on the same road if possible.

import { distance, type LngLat } from "./geo";
import type { Camera } from "./shared/types";

/** "I-4 Express Lanes" and "I-4", or "SR-40 / Silver Springs Blvd" and "SR 40", name the same road here. */
export function sameRoad(a: string, b: string): boolean {
  const key = (s: string) => s.toUpperCase().split("/")[0].replace(/[\s.-]+/g, "").replace(/^STATEROAD|^S\.?R\.?/, "SR");
  const ka = key(a);
  const kb = key(b);
  if (!ka || !kb) return false;
  const [short, long] = ka.length <= kb.length ? [ka, kb] : [kb, ka];
  // "I4" fits "I4EXPRESSLANES", but not "I43" or "I410".
  return long.startsWith(short) && !/^\d/.test(long.slice(short.length));
}

/** Up to `n` cameras within `meters`, nearest first, a camera on another road counting as 2.5 times as far. */
export function nearbyCameras(cams: Camera[], at: LngLat, road: string, n = 3, meters = 2500): Camera[] {
  const scored: { c: Camera; score: number }[] = [];
  for (const c of cams) {
    if (Math.abs(c.lat - at[1]) > 0.03 || Math.abs(c.lon - at[0]) > 0.035) continue;
    const d = distance(at, [c.lon, c.lat]);
    if (d > meters) continue;
    scored.push({ c, score: sameRoad(c.road, road) ? d : d * 2.5 });
  }
  return scored
    .sort((a, b) => a.score - b.score)
    .slice(0, n)
    .map((s) => s.c);
}
