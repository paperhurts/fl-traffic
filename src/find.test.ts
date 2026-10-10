import { describe, expect, it } from "vitest";
import { cameraLabels, findCamera } from "./find";
import type { Camera } from "./shared/types";

const cam = (id: number, location: string, road: string, county: string, more: Partial<Camera> = {}): Camera => ({
  id,
  lon: -82,
  lat: 28,
  road,
  dir: "N",
  location,
  county,
  images: [id],
  noFeed: [],
  ...more,
});

const cams = [
  cam(1, "Skyway Bridge View", "I-275", "Manatee"),
  cam(2, "I-275 at Gandy Blvd", "I-275", "Hillsborough"),
  cam(3, "Pensacola Bay Bridge", "SR30 Pensacola Bay Bridge", "Escambia", { dir: "E" }),
  cam(4, "Pensacola Bay Bridge", "SR30 Pensacola Bay Bridge", "Escambia", { dir: "W" }),
  cam(5, "Pensacola Bay Bridge", "SR30 Pensacola Bay Bridge", "Escambia", { dir: "W" }),
  cam(6, "1916N_75_N/O_RIVER_RD_M192", "I-75", "Sarasota"),
];

describe("cameraLabels", () => {
  const labels = cameraLabels(cams);
  it("names the road and county, leaving out a road the name already gives", () => {
    expect(labels.get(1)).toBe("Skyway Bridge View (I-275, Manatee)");
    expect(labels.get(2)).toBe("I-275 at Gandy Blvd (Hillsborough)");
    expect(labels.get(6)).toBe("1916N 75 N/O RIVER RD M192 (I-75, Sarasota)");
  });
  it("tells twins apart by direction, then by number", () => {
    expect(labels.get(3)).toBe("Pensacola Bay Bridge (SR30 Pensacola Bay Bridge, Escambia), eastbound");
    expect(labels.get(4)).toBe("Pensacola Bay Bridge (SR30 Pensacola Bay Bridge, Escambia), westbound #1");
    expect(labels.get(5)).toBe("Pensacola Bay Bridge (SR30 Pensacola Bay Bridge, Escambia), westbound #2");
    expect(new Set(labels.values()).size).toBe(cams.length);
  });
});

describe("findCamera", () => {
  const labels = cameraLabels(cams);
  it("takes an exact label", () => {
    expect(findCamera("I-275 at Gandy Blvd (Hillsborough)", cams, labels)?.id).toBe(2);
  });
  it("matches every word typed, in any order and case", () => {
    expect(findCamera("skyway", cams, labels)?.id).toBe(1);
    expect(findCamera("gandy i-275", cams, labels)?.id).toBe(2);
    expect(findCamera("bridge manatee", cams, labels)?.id).toBe(1);
    expect(findCamera("river rd", cams, labels)?.id).toBe(6);
  });
  it("prefers a camera with a live feed", () => {
    const some = cams.map((c) => (c.id === 3 ? { ...c, noFeed: [3] } : c));
    expect(findCamera("pensacola bay", some, labels)?.id).toBe(4);
  });
  it("finds nothing for nothing, or for words no camera has", () => {
    expect(findCamera("  ", cams, labels)).toBeNull();
    expect(findCamera("seven mile", cams, labels)).toBeNull();
  });
});
