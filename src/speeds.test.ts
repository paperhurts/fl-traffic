import { expression, validateStyleMin, type StyleSpecification } from "@maplibre/maplibre-gl-style-spec";
import { describe, expect, it } from "vitest";
import { color, flowUrl, offset, sortKey, SOURCE_LAYER, speedLayers, width, type SpeedColors } from "./speeds";

const colors: SpeedColors = {
  line: { free: "#2eab30", slow: "#f1bf40", heavy: "#f18237", stopped: "#e70704", closed: "#c1272d" },
  edge: { free: "#245723", slow: "#e87b3d", heavy: "#df4b15", stopped: "#a50704", closed: "#666666" },
  dash: "#f2f2f2",
};

/** Evaluates an expression with MapLibre's own evaluator, for one of TomTom's lines at a zoom. */
function evaluate(expr: unknown, zoom: number, properties: Record<string, unknown>): unknown {
  const parsed = expression.createExpression(expr, "layers[0].paint.test");
  if (parsed.result !== "success") throw new Error(JSON.stringify(parsed.value));
  return parsed.value.evaluate({ zoom }, { type: 2, properties } as never);
}

const line = (props: Record<string, unknown> = {}) => ({
  road_type: "Secondary road",
  traffic_level: 1,
  traffic_road_coverage: "one_side",
  ...props,
});

describe("speed colors", () => {
  // Names in place of colors, so the result says which band a speed fell in.
  const bands = color({ free: "free", slow: "slow", heavy: "heavy", stopped: "stopped", closed: "closed" });
  const band = (props: Record<string, unknown>) => evaluate(bands, 12, line(props));

  it("follows relative0's bands of speed as a share of free flow", () => {
    expect([0, 0.1, 0.15, 0.3, 0.35, 0.7, 0.75, 1].map((traffic_level) => band({ traffic_level }))).toEqual([
      "stopped",
      "stopped",
      "heavy",
      "heavy",
      "slow",
      "slow",
      "free",
      "free",
    ]);
  });
  it("marks a closed road whatever its speed", () => {
    expect(band({ road_closure: true, traffic_level: 0 })).toBe("closed");
    expect(band({ road_closure: true, traffic_level: 0.9 })).toBe("closed");
  });
});

describe("speed lines", () => {
  it("draws bigger roads wider, and every road at every zoom", () => {
    for (const zoom of [5, 9, 12, 16, 19]) {
      const w = (road_type: string) => evaluate(width, zoom, line({ road_type })) as number;
      expect(w("Motorway")).toBeGreaterThan(w("Major road"));
      expect(w("Major road")).toBeGreaterThan(w("Secondary road"));
      expect(w("Secondary road")).toBeGreaterThan(w("Connecting road"));
      expect(w("Connecting road")).toBeGreaterThan(w("Local road"));
      expect(w("Parking road")).toBeGreaterThan(0);
    }
  });
  it("puts each direction of a two-way road on its own side of travel, once zoomed in", () => {
    const off = (zoom: number, props: Record<string, unknown>) => evaluate(offset, zoom, line(props)) as number;
    const w = evaluate(width, 14, line()) as number;
    expect(off(14, {})).toBeGreaterThan(w / 2);
    expect(off(14, { left_hand_traffic: true })).toBe(-off(14, {}));
    expect(off(14, { traffic_road_coverage: "full" })).toBe(0);
    // Zoomed out, both directions share one line.
    expect(off(9, {})).toBe(0);
    expect(off(11.5, {})).toBeGreaterThan(0);
    expect(off(11.5, {})).toBeLessThan(off(13, {}));
  });
  it("draws bigger roads over smaller ones, and slower traffic over faster", () => {
    const key = (props: Record<string, unknown>) => evaluate(sortKey, 12, line(props)) as number;
    expect(key({ traffic_level: 0.2 })).toBeGreaterThan(key({ traffic_level: 0.9 }));
    expect(key({ road_type: "Motorway", traffic_level: 1 })).toBeGreaterThan(key({ road_type: "Secondary road", traffic_level: 0 }));
  });
  it("passes MapLibre's style validation", () => {
    const style: StyleSpecification = {
      version: 8,
      sources: { flow: { type: "vector", tiles: [flowUrl("k", 1)] } },
      layers: speedLayers(colors, true),
    };
    expect(validateStyleMin(style)).toEqual([]);
    expect(style.layers.every((l) => "source-layer" in l && l["source-layer"] === SOURCE_LAYER)).toBe(true);
  });
  it("asks for exact relative speeds, with the key encoded", () => {
    const url = flowUrl("a/b", 7);
    expect(url).toContain("/tile/flow/relative/{z}/{x}/{y}.pbf?");
    expect(url).toContain("key=a%2Fb");
    // TomTom rounds to a step, which would move roads across the bands' edges.
    expect(url).not.toContain("trafficLevelStep");
  });
});
