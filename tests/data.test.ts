// Integrity checks on public/data/. The deploy refreshes cameras.json and runs
// these before building, falling back to the checked-in file if they fail.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { CameraFile, WebcamFile } from "../src/shared/types";
import { WEBCAM_KINDS } from "../src/webcams";

const read = <T>(name: string): T => JSON.parse(readFileSync(new URL(`../public/data/${name}`, import.meta.url), "utf8"));
const cams = read<CameraFile>("cameras.json");
const water = read<WebcamFile>("webcams.json");

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

/** Where a water cam's pictures may come from: USGS's and NOAA's own servers, whose pictures are
 *  public domain. Anyone else's go on its own page, not this one. */
const PICTURE_HOSTS = ["usgs-nims-images.s3.amazonaws.com", "www.ndbc.noaa.gov"];

describe("webcams.json", () => {
  it("says when it was checked", () => {
    expect(water.checked).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Date.parse(water.checked)).toBeGreaterThan(Date.parse("2026-01-01"));
  });

  it("lists each cam once, under a slug of a name of its own", () => {
    expect(water.cams.length).toBeGreaterThan(50);
    const ids = water.cams.map((w) => w.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(water.cams.map((w) => w.name)).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it("puts every cam in Florida or off its coast", () => {
    for (const w of water.cams) {
      const inside = w.lon > BOX.west && w.lon < BOX.east && w.lat > BOX.south && w.lat < BOX.north;
      expect(inside, `${w.id} at ${w.lon}, ${w.lat}`).toBe(true);
    }
  });

  it("names a kind, an owner, and a page for each", () => {
    for (const w of water.cams) {
      expect(Object.keys(WEBCAM_KINDS), w.id).toContain(w.kind);
      expect(w.by.trim(), w.id).not.toBe("");
      expect(w.page, w.id).toMatch(/^https:\/\/\S+$/);
      expect(new URL(w.page).protocol).toBe("https:");
    }
  });

  it("plays only public-domain pictures and YouTube streams here", () => {
    const views = water.cams.flatMap((w) => (w.views ?? []).map((v) => ({ id: w.id, ...v })));
    expect(views.length).toBeGreaterThan(10);
    for (const w of water.cams.filter((c) => c.views)) expect(w.views!.length, w.id).toBeGreaterThan(0);
    for (const v of views) {
      expect(v.label.trim(), v.id).not.toBe("");
      expect(Number(Boolean(v.youtube)) + Number(Boolean(v.picture)), `${v.id}: one of youtube or picture`).toBe(1);
      if (v.youtube) expect(v.youtube, v.id).toMatch(/^[\w-]{11}$/);
      if (v.picture) {
        const url = new URL(v.picture);
        expect(url.protocol, v.id).toBe("https:");
        expect(PICTURE_HOSTS, `${v.id}: ${url.host}`).toContain(url.host);
      }
    }
  });
});
