// Finding a camera by name, road, or county, or a water cam by name or owner, from the box in
// the chip row. Its suggestions are each camera's and water cam's label; anything else typed is
// matched word by word.

import { hasFeed } from "./data";
import { cameraName, DIRECTION_WORDS } from "./format";
import type { Camera, Webcam } from "./shared/types";
import { webcamLabel } from "./webcams";

/** "Skyway Bridge View (I-275, Manatee)", leaving out a road the name already gives. Each label
 *  is unique: a direction tells twins apart, then a number. */
export function cameraLabels(cams: Camera[]): Map<number, string> {
  const base = (c: Camera, withDir: boolean) => {
    const name = cameraName(c.location);
    const where = [name.toUpperCase().includes(c.road.toUpperCase()) ? "" : c.road, c.county].filter(Boolean).join(", ");
    const dir = withDir && DIRECTION_WORDS[c.dir] ? `, ${DIRECTION_WORDS[c.dir]}` : "";
    return where ? `${name} (${where})${dir}` : `${name}${dir}`;
  };
  const count = (labels: string[]) => labels.reduce((m, l) => m.set(l, (m.get(l) ?? 0) + 1), new Map<string, number>());
  const plain = cams.map((c) => base(c, false));
  const plainCount = count(plain);
  const labels = cams.map((c, i) => (plainCount.get(plain[i])! > 1 ? base(c, true) : plain[i]));
  const seen = new Map<string, number>();
  const total = count(labels);
  return new Map(
    cams.map((c, i) => {
      const l = labels[i];
      if (total.get(l)! === 1) return [c.id, l];
      const n = (seen.get(l) ?? 0) + 1;
      seen.set(l, n);
      return [c.id, `${l} #${n}`];
    }),
  );
}

/** The camera a typed query means: its exact label, or else the first whose label has every
 *  word typed, live cameras first. */
export function findCamera(query: string, cams: Camera[], labels: Map<number, string>): Camera | null {
  const q = query.trim();
  if (!q) return null;
  const exact = cams.find((c) => labels.get(c.id) === q);
  if (exact) return exact;
  const words = q.toLowerCase().split(/\s+/);
  const hits = cams.filter((c) => {
    const l = labels.get(c.id)!.toLowerCase();
    return words.every((w) => l.includes(w));
  });
  return hits.find(hasFeed) ?? hits[0] ?? null;
}

/** The water cam a typed query means: its exact label, or else (unless `exactOnly`) the first
 *  whose label or owner has every word typed. */
export function findWebcam(query: string, cams: Webcam[], exactOnly = false): Webcam | null {
  const q = query.trim();
  if (!q) return null;
  const exact = cams.find((w) => webcamLabel(w) === q);
  if (exact || exactOnly) return exact ?? null;
  const words = q.toLowerCase().split(/\s+/);
  return cams.find((w) => words.every((word) => `${webcamLabel(w)} ${w.by}`.toLowerCase().includes(word))) ?? null;
}

export type Found = { type: "camera"; camera: Camera } | { type: "webcam"; webcam: Webcam };

/** What the find box means: an exact label of either kind, or else (unless `exactOnly`) a water
 *  cam with every word typed, then a camera. There are few water cams, and a name that matches
 *  one ("Siesta", "Naples pier") is rarely after a traffic camera. */
export function findPlace(query: string, cams: Camera[], labels: Map<number, string>, webcams: Webcam[], exactOnly = false): Found | null {
  const q = query.trim();
  const exactWebcam = findWebcam(q, webcams, true);
  if (exactWebcam) return { type: "webcam", webcam: exactWebcam };
  const camera = findCamera(q, cams, labels);
  if (camera && labels.get(camera.id) === q) return { type: "camera", camera };
  if (exactOnly) return null;
  const webcam = findWebcam(q, webcams);
  if (webcam) return { type: "webcam", webcam };
  return camera ? { type: "camera", camera } : null;
}
