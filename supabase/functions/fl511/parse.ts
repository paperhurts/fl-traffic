// Turns FL511's website feeds into the relay's events. Pure functions only:
// the Edge Function (relay.ts), the camera script, and the tests share them.
// The page's own types re-export these from src/shared/types.ts.

/** N, S, E, W; B for both directions; "" when FL511 doesn't say. */
export type Direction = "N" | "S" | "E" | "W" | "B" | "";

export type EventKind =
  | "crash"
  | "incident"
  | "closure"
  | "congestion"
  | "construction"
  | "disabled"
  | "weather"
  | "event";

export interface TrafficEvent {
  id: number;
  kind: EventKind;
  lon: number;
  lat: number;
  road: string;
  dir: Direction;
  county: string;
  /** FL511's sentence, e.g. "Multi-vehicle crash in Seminole County on I-4 East, before MM 94/SR-434." */
  desc: string;
  /** "Right shoulder blocked", or "" when FL511 gives none. */
  lanes: string;
  severity: string;
  /** Every lane closed. */
  full: boolean;
  /** ISO; null when FL511's time can't be read. */
  start: string | null;
  updated: string | null;
}

export interface EventsResponse {
  /** When the relay last fetched FL511 (ISO). */
  fetched: string;
  /** True when FL511 failed and these are the last events the relay got. */
  stale?: boolean;
  events: TrafficEvent[];
}

export interface RelayConfig {
  /** TomTom's browser key, or null when none is set. */
  tomtomKey: string | null;
}

/** A row of FL511's /List/GetData/traffic feed (only the fields we read). */
export interface ListRow {
  id: number;
  layerName?: string | null;
  type?: string | null;
  roadwayName?: string | null;
  direction?: string | null;
  county?: string | null;
  description?: string | null;
  laneDescription?: string | null;
  severity?: string | null;
  isFullClosure?: boolean | null;
  startDate?: string | null;
  lastUpdated?: string | null;
  showOnMap?: boolean | null;
}

/** FL511's /map/mapIcons/<layer> feed: item2 holds each item's id and [lat, lon]. */
export interface IconFeed {
  item2?: { itemId: string; location: [number, number] }[];
}

/** The map layers FL511's traffic list draws from, by `layerName`. */
export const LAYERS = [
  "Incidents",
  "Closures",
  "Congestion",
  "DisabledVehicles",
  "Construction",
  "RoadConditionIncident",
  "SpecialEvents",
] as const;

const DIRECTIONS: Record<string, Direction> = {
  northbound: "N",
  southbound: "S",
  eastbound: "E",
  westbound: "W",
  "both directions": "B",
  "all directions": "B",
};

export function direction(s: string | null | undefined): Direction {
  return DIRECTIONS[(s ?? "").trim().toLowerCase()] ?? "";
}

/** Strips the HTML FL511 puts in some descriptions and collapses whitespace. */
export function plainText(s: string | null | undefined): string {
  return (s ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** Offset of America/New_York from UTC at a moment, in minutes (-240 in summer, -300 in winter). */
function easternOffset(utcMs: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  return Math.round((asUtc - utcMs) / 60000);
}

/** FL511's list times ("10/8/26, 4:03 PM") are Eastern, even for the Panhandle's Central-time counties. */
export function parseTime(s: string | null | undefined): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4}),?\s+(\d{1,2}):(\d{2})\s*([AP]M)$/i.exec((s ?? "").trim());
  if (!m) return null;
  const [, mo, d, y, h, mi, ap] = m;
  const year = y.length === 2 ? 2000 + Number(y) : Number(y);
  const hour = (Number(h) % 12) + (ap.toUpperCase() === "PM" ? 12 : 0);
  const wall = Date.UTC(year, Number(mo) - 1, Number(d), hour, Number(mi));
  // The offset at the wall time read as UTC is right except within hours of a DST switch; one more pass fixes those.
  let utc = wall - easternOffset(wall) * 60000;
  utc = wall - easternOffset(utc) * 60000;
  return new Date(utc).toISOString();
}

const CRASH = /\b(crash|collision|rollover|overturned|vehicle fire|car fire|truck fire)\b/i;

export function eventKind(row: ListRow): EventKind {
  switch (row.layerName) {
    case "Closures":
      return "closure";
    case "Congestion":
      return "congestion";
    case "Construction":
      return "construction";
    case "DisabledVehicles":
      return "disabled";
    case "RoadConditionIncident":
      return "weather";
    case "SpecialEvents":
      return "event";
    default:
      return CRASH.test(row.description ?? "") ? "crash" : "incident";
  }
}

/** Map coordinates by item id, from one layer's icon feed. */
export function iconCoords(feed: IconFeed): Map<number, [number, number]> {
  const out = new Map<number, [number, number]>();
  for (const item of feed.item2 ?? []) {
    const [lat, lon] = item.location ?? [];
    if (Number.isFinite(lat) && Number.isFinite(lon) && (lat !== 0 || lon !== 0)) out.set(Number(item.itemId), [lon, lat]);
  }
  return out;
}

const round = (x: number) => Math.round(x * 1e5) / 1e5;

/** One list row, placed with its layer's coordinates; null when FL511 doesn't map it. */
export function toEvent(row: ListRow, coords: Map<number, [number, number]>): TrafficEvent | null {
  const at = coords.get(Number(row.id));
  if (!at || row.showOnMap === false) return null;
  return {
    id: Number(row.id),
    kind: eventKind(row),
    lon: round(at[0]),
    lat: round(at[1]),
    road: plainText(row.roadwayName),
    dir: direction(row.direction),
    county: plainText(row.county),
    desc: plainText(row.description),
    lanes: plainText(row.laneDescription),
    severity: plainText(row.severity),
    full: row.isFullClosure === true,
    start: parseTime(row.startDate),
    updated: parseTime(row.lastUpdated),
  };
}

/** Every mapped event, newest update first. Rows from layers we don't fetch are dropped. */
export function buildEvents(rows: ListRow[], coordsByLayer: Map<string, Map<number, [number, number]>>): TrafficEvent[] {
  const seen = new Set<number>();
  const out: TrafficEvent[] = [];
  for (const row of rows) {
    const coords = coordsByLayer.get(row.layerName ?? "");
    if (!coords || seen.has(Number(row.id))) continue;
    const ev = toEvent(row, coords);
    if (ev) {
      seen.add(ev.id);
      out.push(ev);
    }
  }
  return out.sort((a, b) => (b.updated ?? "").localeCompare(a.updated ?? ""));
}

/** The DataTables query FL511's list pages send; it caps `length` at 100. */
export function listQuery(columns: string[], start: number, order = 0): string {
  return JSON.stringify({
    columns: [{ data: null, name: "" }, ...columns.map((name) => ({ name, s: true })), { data: columns.length + 1, name: "" }],
    order: [{ column: order, dir: "asc" }],
    start,
    length: 100,
    search: { value: "" },
  });
}

export const EVENT_COLUMNS = ["region", "county", "roadwayName", "direction", "type", "severity", "description", "startDate", "lastUpdated"];
export const CAMERA_COLUMNS = ["sortOrder", "region", "county", "roadway", "location", "direction"];
