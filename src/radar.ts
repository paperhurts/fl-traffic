// NWS radar: the Iowa Environmental Mesonet's national mosaic of NEXRAD base reflectivity,
// remade every five minutes from about 145 radars. IEM draws its tiles from the n0q color
// table, 256 colors where entry i is i/2 - 32.5 dBZ, so the page reads each pixel's dBZ back
// through that table, drops anything under RAIN_DBZ (drizzle, and the birds, insects, and
// clutter radar picks up on clear nights), and repaints the rest in one blue ramp
// (--rain-* in tokens.css): the Weather Service's green-to-red would read as TomTom's speeds.

/** IEM's newest mosaic and when it was made ({"meta": {"valid": "2026-10-10T09:50:00Z"}}). */
export const RADAR_VALID_URL = "https://mesonet.agron.iastate.edu/data/gis/images/4326/USCOMP/n0q_0.json";

/** The mosaic's tiles at one time, which never change once made, so browsers keep them; or,
 *  without a time, IEM's newest, whatever its time. Fetched through the `radar` protocol. */
export const radarTiles = (stamp: string | null) =>
  `radar://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/${stamp ? `ridge::USCOMP-N0Q-${stamp}` : "nexrad-n0q-900913"}/{z}/{x}/{y}.png`;

/** "2026-10-10T09:50:00Z" → "202610100950", the UTC minute IEM names a mosaic by. */
export const radarStamp = (iso: string) => iso.replace(/\D/g, "").slice(0, 12);

/** Light rain starts about here. */
export const RAIN_DBZ = 20;

/** Where the ramp's colors sit (--rain-20 to --rain-60); stronger echoes take the last. */
export const RAIN_STOPS = [20, 30, 40, 50, 60] as const;

/** The n0q table's colors from 20 dBZ (entry 105) up, as RRGGBB; none repeats. */
const N0Q_FROM_20 =
  "43d67e3cd66d35d65b11d51811d11710cd1710c81610c4160fbc150fb7140eb3140eaf130eab130da6120da2120d9e11" +
  "0c99110c95100c91100b880f0b840e0a800e0a7c0d0a770d09730c096f0c096b0b08660b08620a095e09327308467d08" +
  "5b88076f9207849d0698a806adb205c1bd05d6c704ead204ffe200ffd800ffd300ffce00ffc900ffc400ffc000ffbb00" +
  "ffb600ffb100ffac00ffa700ffa200ff9900ff9400ff8f00ff8a00ff8500ff8000ff0000f80000f10000ea0000e30000" +
  "d50000cd0000c60000bf0000b80000b10000aa0000a300009b00009400008d00007f0000780000710000fffffffff5ff" +
  "ffeaffffdfffffd4ffffc9ffffbeffffb3ffff9dffff92ffff75fffc6bfdf960faf656f7f34bf4f040f1ed36efea2bec" +
  "e720e9e10be3b200ffac00fca400f79b00f49300ef8800ea8300e87900e27200dd6900db05ecf005ebf005eaf005dde0" +
  "05dce005dbe005cdd005ccd004bdc004bcc004bbc004aeb004adb0049ea0049da0049ca0038e90038d90038c90037e80" +
  "037d80036f70036e70036d70025f60025e60024f50024e50024d50023f40023e40023d40013030012f30012020011f20" +
  "011e203a67b53a66b53a65b53a64b53a63b53a62b5";

/** dBZ by color (0xRRGGBB), for the colors at RAIN_DBZ and up. */
export function rainLookup(): Map<number, number> {
  const dbz = new Map<number, number>();
  for (let k = 0; k < N0Q_FROM_20.length / 6; k++) dbz.set(parseInt(N0Q_FROM_20.slice(k * 6, k * 6 + 6), 16), (105 + k) / 2 - 32.5);
  return dbz;
}

export type Rgba = [number, number, number, number];

/** "#rrggbb" or "rgba(r, g, b, a)", as tokens.css writes colors; alpha 0–255. */
export function parseColor(css: string): Rgba {
  const s = css.trim();
  if (s.startsWith("#")) return [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16), 255];
  const [r, g, b, a = 1] = s.replace(/^rgba?\(|\)$/g, "").split(",").map(Number);
  return [r, g, b, Math.round(a * 255)];
}

/** The ramp's color at a dBZ, between the stops' colors. */
export function rampAt(dbz: number, colors: readonly Rgba[]): Rgba {
  const last = RAIN_STOPS.length - 1;
  if (dbz >= RAIN_STOPS[last]) return colors[last];
  const i = Math.max(0, RAIN_STOPS.findIndex((s) => s > dbz) - 1);
  const t = Math.max(0, (dbz - RAIN_STOPS[i]) / (RAIN_STOPS[i + 1] - RAIN_STOPS[i]));
  return colors[i].map((c, k) => Math.round(c + (colors[i + 1][k] - c) * t)) as Rgba;
}

/** Repaints a tile's pixels (RGBA) in place: rain along the ramp, everything else clear. */
export function recolor(px: Uint8ClampedArray, lookup: Map<number, number>, colors: readonly Rgba[]): void {
  const paint = new Map<number, Rgba>();
  for (let i = 0; i < px.length; i += 4) {
    const dbz = px[i + 3] ? lookup.get((px[i] << 16) | (px[i + 1] << 8) | px[i + 2]) : undefined;
    if (dbz === undefined) {
      px[i + 3] = 0;
      continue;
    }
    let c = paint.get(dbz);
    if (!c) paint.set(dbz, (c = rampAt(dbz, colors)));
    px[i] = c[0];
    px[i + 1] = c[1];
    px[i + 2] = c[2];
    px[i + 3] = c[3];
  }
}

const LOOKUP = rainLookup();

/** The `radar` protocol: an IEM tile, repainted. */
export async function loadRadarTile(url: string, abort: AbortController, colors: readonly Rgba[]): Promise<{ data: ImageBitmap }> {
  const res = await fetch(url.replace(/^radar:/, "https:"), { signal: abort.signal });
  if (!res.ok) throw new Error(`radar tile: HTTP ${res.status}`);
  // No color management, or the colors wouldn't match the table.
  const tile = await createImageBitmap(await res.blob(), { colorSpaceConversion: "none", premultiplyAlpha: "none" });
  const canvas = new OffscreenCanvas(tile.width, tile.height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(tile, 0, 0);
  tile.close();
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  recolor(img.data, LOOKUP, colors);
  return { data: await createImageBitmap(img) };
}
