// TomTom's live speeds, drawn from its vector flow tiles. Its raster tiles leave out all but
// motorways and a few major roads until zoom 13, so state and county roads stayed blank at
// the zooms people look at a town. The vector tiles carry major and secondary roads (most
// state roads) from zoom 8 or 9 and tertiary ones (most county roads) from 10 or 11. The page
// colors them in the bands of TomTom's relative0 style: each road's speed as a share of its
// free-flow speed.

import type { ExpressionSpecification, LineLayerSpecification } from "maplibre-gl";

/** A color for each of relative0's bands, and for closed roads. */
export interface Bands {
  free: string;
  slow: string;
  heavy: string;
  stopped: string;
  closed: string;
}

export interface SpeedColors {
  line: Bands;
  /** A darker shade around each line, as TomTom draws them: it keeps yellow legible on the
   *  light map, and side-by-side lines apart. */
  edge: Bands;
  /** The dashes over a closed road. */
  dash: string;
}

/** relative0's bands, as shares of free-flow speed: under 0.15 is stopped, under 0.35 heavy, under 0.75 slow. */
export const BANDS = { stopped: 0.15, heavy: 0.35, slow: 0.75 } as const;

/** Exact speeds: trafficLevelStep would save a kilobyte or two a tile, but TomTom rounds to the
 *  step (0.343 to 0.35), which moves roads across the bands' edges. */
export const flowUrl = (key: string, stamp: number) =>
  `https://api.tomtom.com/traffic/map/4/tile/flow/relative/{z}/{x}/{y}.pbf?key=${encodeURIComponent(key)}&t=${stamp}`;

/** The tiles' one layer. */
export const SOURCE_LAYER = "Traffic flow";

export const SPEED_LAYERS = ["flow-edge", "flow", "flow-closed"] as const;

type Widths = readonly [motorway: number, major: number, secondary: number, tertiary: number, other: number];

/** By zoom: one direction's width in pixels (motorways and international roads, major roads,
 *  secondary roads, connecting and major local roads, and the rest), the edge on each side, and
 *  how far a two-way road's directions have moved apart. Zoomed out they're drawn as one line,
 *  the slower direction on top; by zoom 13 each has its own side. */
const STOPS: readonly { zoom: number; widths: Widths; edge: number; split: number }[] = [
  { zoom: 6, widths: [1.2, 0.9, 0.7, 0.5, 0.4], edge: 0.4, split: 0 },
  { zoom: 10, widths: [2, 1.6, 1.25, 0.95, 0.75], edge: 0.5, split: 0 },
  { zoom: 13, widths: [3, 2.5, 2.1, 1.7, 1.4], edge: 0.7, split: 1 },
  { zoom: 16, widths: [4.8, 4.1, 3.5, 2.9, 2.4], edge: 0.8, split: 1 },
  { zoom: 19, widths: [7, 6, 5.2, 4.4, 3.6], edge: 0.9, split: 1 },
];
/** The gap between a road's two directions, in pixels. */
const GAP = 0.25;

const level: ExpressionSpecification = ["number", ["get", "traffic_level"], 1];
const closed: ExpressionSpecification = ["==", ["get", "road_closure"], true];

function byType(w: readonly number[]): ExpressionSpecification {
  return [
    "match",
    ["get", "road_type"],
    ["Motorway", "International road"],
    w[0],
    "Major road",
    w[1],
    "Secondary road",
    w[2],
    ["Connecting road", "Major local road"],
    w[3],
    w[4],
  ];
}

function byZoom(f: (stop: (typeof STOPS)[number]) => number | ExpressionSpecification): ExpressionSpecification {
  return ["interpolate", ["linear"], ["zoom"], ...STOPS.flatMap((stop) => [stop.zoom, f(stop)])] as ExpressionSpecification;
}

/** A two-way road comes as one line per direction, each drawn on its own side of travel. */
const side: ExpressionSpecification = [
  "case",
  ["!=", ["get", "traffic_road_coverage"], "one_side"],
  0,
  ["==", ["get", "left_hand_traffic"], true],
  -1,
  1,
];

export const width = byZoom((s) => byType(s.widths));
const edgeWidth = byZoom((s) => byType(s.widths.map((w) => w + 2 * s.edge)));
export const offset = byZoom((s) => (s.split ? ["*", side, byType(s.widths.map((w) => s.split * (w / 2 + GAP)))] : 0));

export function color(c: Bands): ExpressionSpecification {
  return ["case", closed, c.closed, ["step", level, c.stopped, BANDS.stopped, c.heavy, BANDS.heavy, c.slow, BANDS.slow, c.free]];
}

/** Bigger roads over smaller ones, and on each, slower over faster. */
export const sortKey: ExpressionSpecification = ["+", byType([40, 30, 20, 10, 0]), ["-", 1, level]];

/** The edges, the speeds, and dashes over closed roads, all from the source "flow". */
export function speedLayers(c: SpeedColors, visible: boolean): LineLayerSpecification[] {
  const base = { type: "line", source: "flow", "source-layer": SOURCE_LAYER } as const;
  const layout = {
    visibility: visible ? "visible" : "none",
    "line-join": "round",
    "line-cap": "round",
    "line-sort-key": sortKey,
  } as const;
  return [
    { ...base, id: "flow-edge", layout, paint: { "line-color": color(c.edge), "line-width": edgeWidth, "line-offset": offset } },
    { ...base, id: "flow", layout, paint: { "line-color": color(c.line), "line-width": width, "line-offset": offset } },
    {
      ...base,
      id: "flow-closed",
      filter: closed,
      layout: { ...layout, "line-cap": "butt" },
      paint: { "line-color": c.dash, "line-width": width, "line-offset": offset, "line-dasharray": [2, 2] },
    },
  ];
}
