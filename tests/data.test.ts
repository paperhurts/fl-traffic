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

  it("names a road, a direction, a county, and its images", () => {
    for (const c of cams.cameras) {
      expect(c[3]).toBeGreaterThanOrEqual(0);
      expect(c[3]).toBeLessThan(cams.roads.length);
      expect(["N", "S", "E", "W", "B", ""]).toContain(c[4]);
      expect(typeof c[5]).toBe("string");
      expect(c[6]).toBeGreaterThanOrEqual(0);
      expect(c[6]).toBeLessThan(cams.counties.length);
      if (c.length === 8) {
        expect(c[7].length).toBeGreaterThan(0);
        for (const im of c[7]) expect(Number.isInteger(im) && im > 0).toBe(true);
      } else {
        expect(c.length).toBe(7);
      }
    }
  });

  it("lists each road and county once, and only ones a camera is in", () => {
    expect(new Set(cams.roads).size).toBe(cams.roads.length);
    expect(new Set(cams.cameras.map((c) => c[3])).size).toBe(cams.roads.length);
    expect(new Set(cams.counties).size).toBe(cams.counties.length);
    expect(new Set(cams.cameras.map((c) => c[6])).size).toBe(cams.counties.length);
  });

  it("names a county for nearly every camera", () => {
    const none = cams.counties.indexOf("");
    const without = none < 0 ? 0 : cams.cameras.filter((c) => c[6] === none).length;
    expect(without / cams.cameras.length).toBeLessThan(0.05);
  });

  it("marks only its own images as having no live feed, and leaves most live", () => {
    const images = new Set(cams.cameras.flatMap((c) => (c.length === 8 ? c[7] : [c[0]])));
    expect(new Set(cams.noFeed).size).toBe(cams.noFeed.length);
    for (const id of cams.noFeed) expect(images.has(id), `image ${id}`).toBe(true);
    // About a fifth are dark on a typical day; most of them dark would mean FL511 changed its list.
    expect(cams.noFeed.length / images.size).toBeLessThan(0.5);
  });
});
