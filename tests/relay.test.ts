import { describe, expect, it } from "vitest";
import { createRelay, FRESH_MS } from "../supabase/functions/fl511/relay.ts";

/** A stand-in for FL511: a traffic list of `n` incidents, 100 a page, all on the map. */
function fakeFl511(n: number) {
  const calls: string[] = [];
  let failing = false;
  const fetcher = async (url: string) => {
    calls.push(url);
    if (failing) return new Response("down", { status: 503 });
    const u = new URL(url);
    if (u.pathname === "/List/GetData/traffic") {
      const { start, length } = JSON.parse(u.searchParams.get("query")!);
      const data = Array.from({ length: Math.max(0, Math.min(length, n - start)) }, (_, i) => ({
        id: start + i + 1,
        layerName: "Incidents",
        description: "Crash on I-4.",
        roadwayName: "I-4",
        direction: "Westbound",
        lastUpdated: "10/8/26, 4:07 PM",
      }));
      return Response.json({ recordsTotal: n, data });
    }
    if (u.pathname === "/map/mapIcons/Incidents") {
      return Response.json({ item2: Array.from({ length: n }, (_, i) => ({ itemId: String(i + 1), location: [28, -81] })) });
    }
    return new Response("not found", { status: 404 });
  };
  return { fetcher, calls, fail: (on: boolean) => (failing = on) };
}

const env = (vars: Record<string, string> = {}) => ({ get: (k: string) => vars[k] });
const get = (path = "/fl511", origin = "https://traffic.paperhurts.dev") =>
  new Request(`https://example.supabase.co/functions/v1${path}`, { headers: { Origin: origin } });

describe("relay", () => {
  it("pages through the list and places each event", async () => {
    const fl = fakeFl511(250);
    const relay = createRelay(env(), fl.fetcher);
    const res = await relay.handle(get());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.events).toHaveLength(250);
    expect(body.events[0]).toMatchObject({ kind: "crash", dir: "W", lon: -81, lat: 28 });
    expect(fl.calls.filter((c) => c.includes("/List/GetData/"))).toHaveLength(3);
    expect(fl.calls.filter((c) => c.includes("/mapIcons/"))).toHaveLength(1);
  });

  it("asks FL511 at most once a minute, and once for callers who arrive together", async () => {
    const fl = fakeFl511(5);
    let now = 1_000_000;
    const relay = createRelay(env(), fl.fetcher, () => now);
    await Promise.all([relay.events(), relay.events(), relay.events()]);
    await relay.events();
    expect(fl.calls).toHaveLength(2);
    now += FRESH_MS + 1;
    await relay.events();
    expect(fl.calls).toHaveLength(4);
  });

  it("serves the last good events, marked stale, when FL511 fails", async () => {
    const fl = fakeFl511(5);
    let now = 0;
    const relay = createRelay(env(), fl.fetcher, () => now);
    await relay.events();
    fl.fail(true);
    now += FRESH_MS + 1;
    const body = await (await relay.handle(get())).json();
    expect(body.stale).toBe(true);
    expect(body.events).toHaveLength(5);
  });

  it("doesn't ask a failing FL511 again for a minute", async () => {
    const fl = fakeFl511(5);
    let now = 0;
    const relay = createRelay(env(), fl.fetcher, () => now);
    await relay.events();
    fl.fail(true);
    now += FRESH_MS + 1;
    await relay.events();
    const asked = fl.calls.length;
    now += 10_000;
    expect((await relay.events()).stale).toBe(true);
    expect(fl.calls).toHaveLength(asked);
    fl.fail(false);
    now += FRESH_MS;
    expect((await relay.events()).stale).toBeUndefined();
  });

  it("answers 502 when FL511 fails and there's nothing cached", async () => {
    const fl = fakeFl511(5);
    fl.fail(true);
    const res = await createRelay(env(), fl.fetcher).handle(get());
    expect(res.status).toBe(502);
  });

  it("lets only the site's own pages read it", async () => {
    const relay = createRelay(env(), fakeFl511(1).fetcher);
    expect((await relay.handle(get())).headers.get("Access-Control-Allow-Origin")).toBe("https://traffic.paperhurts.dev");
    expect((await relay.handle(get("/fl511", "https://elsewhere.example"))).headers.get("Access-Control-Allow-Origin")).toBeNull();
    const custom = createRelay(env({ ALLOWED_ORIGINS: "https://a.example, https://b.example" }), fakeFl511(1).fetcher);
    expect((await custom.handle(get("/fl511", "https://b.example"))).headers.get("Access-Control-Allow-Origin")).toBe("https://b.example");
  });

  it("answers preflight requests", async () => {
    const res = await createRelay(env(), fakeFl511(1).fetcher).handle(
      new Request("https://x.supabase.co/functions/v1/fl511", { method: "OPTIONS", headers: { Origin: "http://localhost:5191" } }),
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("GET");
  });

  it("hands the page the TomTom key from its secrets, or null", async () => {
    const withKey = createRelay(env({ TOMTOM_KEY: " abc123 " }), fakeFl511(1).fetcher);
    expect(await (await withKey.handle(get("/fl511/config"))).json()).toEqual({ tomtomKey: "abc123" });
    const without = createRelay(env(), fakeFl511(1).fetcher);
    expect(await (await without.handle(get("/fl511/config"))).json()).toEqual({ tomtomKey: null });
  });
});
