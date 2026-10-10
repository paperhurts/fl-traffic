import { describe, expect, it } from "vitest";
import { parseColor, radarStamp, radarTiles, rainLookup, rampAt, recolor, RAIN_DBZ, type Rgba } from "./radar";

// The dark scheme's ramp, as tokens.css writes it.
const colors = ["rgba(24, 79, 149, .5)", "rgba(42, 120, 214, .58)", "rgba(85, 152, 231, .68)", "rgba(158, 197, 244, .8)", "rgba(205, 226, 251, .9)"].map(parseColor);

describe("the radar's tiles", () => {
  it("name a mosaic by its UTC minute, or take IEM's newest", () => {
    expect(radarStamp("2026-10-10T09:50:00Z")).toBe("202610100950");
    expect(radarTiles("202610100950")).toBe("radar://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/ridge::USCOMP-N0Q-202610100950/{z}/{x}/{y}.png");
    expect(radarTiles(null)).toBe("radar://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913/{z}/{x}/{y}.png");
  });
});

describe("rainLookup", () => {
  const lookup = rainLookup();
  it("reads dBZ from IEM's n0q colors, from light rain up", () => {
    expect(lookup.size).toBe(151);
    expect(lookup.get(0x43d67e)).toBe(RAIN_DBZ);
    expect(lookup.get(0xffff00)).toBeUndefined(); // not one of the table's colors
    expect(lookup.get(0xff0000)).toBe(49.5); // red, a heavy storm
    expect(Math.max(...lookup.values())).toBe(95);
  });
});

describe("parseColor", () => {
  it("reads hex and rgba", () => {
    expect(parseColor("#2a78d6")).toEqual([42, 120, 214, 255]);
    expect(parseColor(" rgba(24, 79, 149, .5)")).toEqual([24, 79, 149, 128]);
  });
});

describe("rampAt", () => {
  it("sits on the stops and blends between them", () => {
    expect(rampAt(20, colors)).toEqual(colors[0]);
    expect(rampAt(40, colors)).toEqual(colors[2]);
    expect(rampAt(25, colors)).toEqual([33, 100, 182, 138]);
    expect(rampAt(73, colors)).toEqual(colors[4]);
  });
});

describe("recolor", () => {
  const px = (...cs: Rgba[]) => new Uint8ClampedArray(cs.flat());
  it("paints rain along the ramp and clears everything else", () => {
    const tile = px(
      [0x43, 0xd6, 0x7e, 255], // 20 dBZ
      [0xff, 0x00, 0x00, 255], // 49.5 dBZ
      [0x7e, 0x8c, 0xb0, 255], // a color under 20 dBZ, not in the lookup
      [0x43, 0xd6, 0x7e, 0], // transparent, whatever its color
    );
    recolor(tile, rainLookup(), colors);
    expect([...tile.slice(0, 4)]).toEqual(colors[0]);
    expect([...tile.slice(4, 8)]).toEqual(rampAt(49.5, colors));
    expect(tile[11]).toBe(0);
    expect(tile[15]).toBe(0);
  });
});
