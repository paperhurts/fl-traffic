// The relay's request handling, kept free of Deno APIs so the tests run it in
// Node. index.ts is the Edge Function entry that serves it.
//
// FL511 has no public API, and its website's feeds send no CORS headers, so
// the page can't read them itself. The relay fetches FL511's traffic list (3
// pages of 100) and each map layer's coordinates (one request per layer),
// at most once a minute however many people have the page open.

import {
  buildEvents,
  EVENT_COLUMNS,
  iconCoords,
  LAYERS,
  listQuery,
  type EventsResponse,
  type IconFeed,
  type ListRow,
  type RelayConfig,
} from "./parse.ts";

export interface RelayEnv {
  get(name: string): string | undefined;
}

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

const BASE = "https://fl511.com";
const UA = "fl-traffic relay (+https://github.com/paperhurts/fl-traffic)";
/** Serve cached events this long before asking FL511 again. */
export const FRESH_MS = 60_000;
/** FL511 lists a few hundred events; stop paging well past that. */
const MAX_ROWS = 2000;
/** The startDate column: new events land on the last page, so paging shifts less while FL511 updates. */
const ORDER_COLUMN = 8;
const ORIGINS = ["https://paperhurts.github.io", "https://traffic.paperhurts.dev", "http://localhost:5191", "http://localhost:4191"];

export function createRelay(env: RelayEnv, fetcher: Fetcher = fetch, clock: () => number = Date.now) {
  let cache: { at: number; body: EventsResponse } | null = null;
  let inflight: Promise<EventsResponse> | null = null;

  async function getJson<T>(path: string): Promise<T> {
    const res = await fetcher(BASE + path, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`FL511 ${path.split("?")[0]}: HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  async function fetchEvents(): Promise<EventsResponse> {
    const rows: ListRow[] = [];
    for (let start = 0, total = Infinity; start < total && start < MAX_ROWS; start += 100) {
      const q = encodeURIComponent(listQuery(EVENT_COLUMNS, start, ORDER_COLUMN));
      const page = await getJson<{ recordsTotal: number; data: ListRow[] }>(`/List/GetData/traffic?query=${q}&lang=en`);
      total = page.recordsTotal;
      rows.push(...page.data);
      if (!page.data.length) break;
    }
    const layers = LAYERS.filter((l) => rows.some((r) => r.layerName === l));
    const feeds = await Promise.all(layers.map((l) => getJson<IconFeed>(`/map/mapIcons/${l}`)));
    const coords = new Map(layers.map((l, i) => [l as string, iconCoords(feeds[i])]));
    return { fetched: new Date(clock()).toISOString(), events: buildEvents(rows, coords) };
  }

  /** Cached events; one fetch at a time; the last good copy, marked stale, when FL511 fails. */
  async function events(): Promise<EventsResponse> {
    if (cache && clock() - cache.at < FRESH_MS) return cache.body;
    inflight ??= fetchEvents()
      .then((body) => {
        cache = { at: clock(), body };
        return body;
      })
      .finally(() => {
        inflight = null;
      });
    try {
      return await inflight;
    } catch (e) {
      if (cache) return { ...cache.body, stale: true };
      throw e;
    }
  }

  function allowed(): string[] {
    const list = env.get("ALLOWED_ORIGINS");
    return list ? list.split(",").map((s) => s.trim()).filter(Boolean) : ORIGINS;
  }

  async function handle(req: Request): Promise<Response> {
    const origin = req.headers.get("Origin");
    const cors: Record<string, string> = { Vary: "Origin" };
    // Other sites' pages can't read the relay; anything else can, as it can read FL511.
    if (origin && allowed().includes(origin)) cors["Access-Control-Allow-Origin"] = origin;
    if (req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          ...cors,
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
          "Access-Control-Max-Age": "86400",
        },
      });
    }
    if (req.method !== "GET") return json({ error: "Only GET" }, 405, cors);

    if (new URL(req.url).pathname.endsWith("/config")) {
      const body: RelayConfig = { tomtomKey: env.get("TOMTOM_KEY")?.trim() || null };
      return json(body, 200, { ...cors, "Cache-Control": "public, max-age=300" });
    }
    try {
      return json(await events(), 200, { ...cors, "Cache-Control": "public, max-age=30" });
    } catch (e) {
      console.error(e);
      return json({ error: "FL511 isn't answering." }, 502, cors);
    }
  }

  return { handle, events };
}

function json(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json; charset=utf-8" },
  });
}
