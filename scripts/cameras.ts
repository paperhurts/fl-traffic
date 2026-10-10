// Fetches every FL511 camera into public/data/cameras.json.
//   npm run cameras
// FL511's camera list pages 100 at a time (about 50 requests, a second or two
// each); the map's camera layer, one request, checks that none were missed.
// Behind a proxy (as in a cloud session), Node's fetch needs NODE_USE_ENV_PROXY=1.

import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { CAMERA_COLUMNS, direction, listQuery, plainText, type IconFeed } from "../supabase/functions/fl511/parse.ts";
import type { CameraFile, CameraRow } from "../src/shared/types.ts";

const BASE = "https://fl511.com";
const UA = "fl-traffic (+https://github.com/paperhurts/fl-traffic)";
const OUT = new URL("../public/data/cameras.json", import.meta.url);
/** FL511 lists about 5,000. Fewer than this means the fetch went wrong, so keep the old file. */
const MIN_CAMERAS = 3000;

export interface CameraListRow {
  id: number;
  roadway?: string | null;
  direction?: string | null;
  location?: string | null;
  county?: string | null;
  latLng?: { geography?: { wellKnownText?: string | null } | null } | null;
  /** An image with no videoUrl has no live feed: its still is FL511's "No live camera feed" picture. */
  images?: { id: number; disabled?: boolean | null; blocked?: boolean | null; videoUrl?: string | null }[] | null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getJson<T>(path: string, tries = 4): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(BASE + path, { headers: { "User-Agent": UA, Accept: "application/json" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as T;
    } catch (e) {
      if (i >= tries) throw new Error(`${path}: ${(e as Error).message}`);
      await sleep(1000 * 2 ** i);
    }
  }
}

/** "POINT (-81.580975 28.292213)" → [lon, lat] */
export function wktPoint(wkt: string | null | undefined): [number, number] | null {
  const m = /POINT\s*\(\s*(-?[\d.]+)\s+(-?[\d.]+)\s*\)/i.exec(wkt ?? "");
  if (!m) return null;
  const lon = Number(m[1]);
  const lat = Number(m[2]);
  return lon === 0 && lat === 0 ? null : [lon, lat];
}

const round = (x: number) => Math.round(x * 1e5) / 1e5;

/** The sorted names in `values`, and each one's index. */
function names(values: Iterable<string>): [string[], Map<string, number>] {
  const list = [...new Set(values)].sort((a, b) => a.localeCompare(b));
  return [list, new Map(list.map((v, i) => [v, i]))];
}

/** Packs list rows into the camera file, dropping images FL511 marks disabled or blocked and sites
 *  left with none, and noting the images FL511 has no live feed from. */
export function cameraFile(rows: CameraListRow[], icons: Map<number, [number, number]>, generated: string): CameraFile {
  const byId = new Map<number, CameraListRow>();
  for (const r of rows) byId.set(Number(r.id), r);
  const [roads, roadIndex] = names([...byId.values()].map((r) => plainText(r.roadway)));
  const [counties, countyIndex] = names([...byId.values()].map((r) => plainText(r.county)));
  const cameras: CameraRow[] = [];
  const noFeed: number[] = [];
  for (const [id, r] of [...byId].sort((a, b) => a[0] - b[0])) {
    const at = icons.get(id) ?? wktPoint(r.latLng?.geography?.wellKnownText);
    if (!at) continue;
    const kept = (r.images ?? []).filter((im) => !im.disabled && !im.blocked);
    if (!kept.length) continue;
    const images = kept.map((im) => Number(im.id));
    for (const im of kept) if (!im.videoUrl?.trim()) noFeed.push(Number(im.id));
    const row: CameraRow = [
      id,
      round(at[0]),
      round(at[1]),
      roadIndex.get(plainText(r.roadway))!,
      direction(r.direction),
      plainText(r.location),
      countyIndex.get(plainText(r.county))!,
    ];
    cameras.push(images.length === 1 && images[0] === id ? row : [...row, images]);
  }
  // Roads and counties no kept camera uses would only bloat the file.
  const usedRoads = [...new Set(cameras.map((c) => c[3]))].sort((a, b) => a - b);
  const usedCounties = [...new Set(cameras.map((c) => c[6]))].sort((a, b) => a - b);
  const roadRemap = new Map(usedRoads.map((old, i) => [old, i]));
  const countyRemap = new Map(usedCounties.map((old, i) => [old, i]));
  for (const c of cameras) {
    c[3] = roadRemap.get(c[3])!;
    c[6] = countyRemap.get(c[6])!;
  }
  return {
    generated,
    roads: usedRoads.map((i) => roads[i]),
    counties: usedCounties.map((i) => counties[i]),
    cameras,
    noFeed: noFeed.sort((a, b) => a - b),
  };
}

async function main() {
  const iconFeed = await getJson<IconFeed>("/map/mapIcons/Cameras");
  const icons = new Map<number, [number, number]>();
  for (const it of iconFeed.item2 ?? []) icons.set(Number(it.itemId), [it.location[1], it.location[0]]);
  console.log(`map layer: ${icons.size} cameras`);

  const rows: CameraListRow[] = [];
  for (let start = 0, total = Infinity; start < total; start += 100) {
    const q = encodeURIComponent(listQuery(CAMERA_COLUMNS, start, 1));
    const page = await getJson<{ recordsTotal: number; data: CameraListRow[] }>(`/List/GetData/Cameras?query=${q}&lang=en`);
    total = page.recordsTotal;
    rows.push(...page.data);
    process.stdout.write(`\rlist: ${rows.length} of ${total}`);
    await sleep(250);
  }
  console.log();

  // The list pages by a sort that isn't unique, so a camera can slip between pages; fetch those one at a time.
  const listed = new Set(rows.map((r) => Number(r.id)));
  const missing = [...icons.keys()].filter((id) => !listed.has(id));
  for (const id of missing) {
    const d = await getJson<CameraListRow & { direction?: unknown }>(`/map/data/Cameras/${id}`);
    rows.push({ ...d, direction: typeof d.direction === "string" ? d.direction : null });
    await sleep(250);
  }
  if (missing.length) console.log(`fetched ${missing.length} cameras the list skipped`);

  const file = cameraFile(rows, icons, new Date().toISOString());
  if (file.cameras.length < MIN_CAMERAS) throw new Error(`only ${file.cameras.length} cameras; keeping the old file`);
  writeFileSync(OUT, JSON.stringify(file).replace(/\],\[/g, "],\n[") + "\n");
  console.log(`wrote ${file.cameras.length} cameras on ${file.roads.length} roads in ${file.counties.length} counties, ${file.noFeed.length} images with no live feed`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
