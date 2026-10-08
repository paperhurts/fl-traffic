// Integrity checks on public/data/. The deploy refreshes cameras.json and runs
// these before building, falling back to the checked-in file if they fail.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { CameraFile } from "../src/shared/types";

const cams: CameraFile = JSON.parse(readFileSync(new URL("../public/data/cameras.json", import.meta.url), "utf8"));

// Florida, with room for cameras at the state lines.
const BOX = { west: -87.7, south: 24.3, east: -79.8, north: 31.1 };

describe("cameras.json", () => {
  it("says when it was fetched", () => {
    const t = Date.parse(cams.generated);
    expect(Number.isNaN(t)).toBe(false);
    expect(t).toBeGreaterThan(Date.parse("2026-01-01"));
  });

  it("has thousands of cameras, each once", () => {
    expect(cams.cameras.length).toBeGreaterThan(3000);
    const ids = cams.cameras.map((c) => c[0]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(Number.isInteger(id) && id > 0).toBe(true);
  });

  it("puts every camera in Florida", () => {
    for (const [id, lon, lat] of cams.cameras) {
      const inside = lon > BOX.west && lon < BOX.east && lat > BOX.south && lat < BOX.north;
      expect(inside, `camera ${id} at ${lon}, ${lat}`).toBe(true);
    }
  });

  it("names a road, a direction, and its images", () => {
    for (const c of cams.cameras) {
      expect(c[3]).toBeGreaterThanOrEqual(0);
      expect(c[3]).toBeLessThan(cams.roads.length);
      expect(["N", "S", "E", "W", "B", ""]).toContain(c[4]);
      expect(typeof c[5]).toBe("string");
      if (c.length === 7) {
        expect(c[6].length).toBeGreaterThan(0);
        for (const im of c[6]) expect(Number.isInteger(im) && im > 0).toBe(true);
      } else {
        expect(c.length).toBe(6);
      }
    }
  });

  it("lists each road once, and only roads a camera is on", () => {
    expect(new Set(cams.roads).size).toBe(cams.roads.length);
    const used = new Set(cams.cameras.map((c) => c[3]));
    expect(used.size).toBe(cams.roads.length);
  });
});
