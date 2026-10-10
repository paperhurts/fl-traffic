import { describe, expect, it } from "vitest";
import { nearbyCameras, sameRoad } from "./nearby";
import type { Camera } from "./shared/types";

describe("sameRoad", () => {
  it("matches FL511's spellings of one road", () => {
    expect(sameRoad("I-4", "I-4 Express Lanes")).toBe(true);
    expect(sameRoad("SR-40 / Silver Springs Blvd / Ft Brooks Rd", "SR 40")).toBe(true);
    expect(sameRoad("S.R. 64", "SR-64")).toBe(true);
  });
  it("keeps different numbers apart", () => {
    expect(sameRoad("I-4", "I-45")).toBe(false);
    expect(sameRoad("SR-40", "SR-408")).toBe(false);
    expect(sameRoad("US-1", "US-19")).toBe(false);
    expect(sameRoad("", "I-4")).toBe(false);
  });
});

describe("nearbyCameras", () => {
  const cam = (id: number, lon: number, road: string): Camera => ({ id, lon, lat: 28.5, road, dir: "E", location: "", county: "", images: [id], noFeed: [] });
  // About 98 m per 0.001° of longitude here.
  const cams = [cam(1, -81.001, "SR-408"), cam(2, -81.004, "I-4"), cam(3, -81.008, "I-4"), cam(4, -81.05, "I-4"), cam(5, -81.0005, "Colonial Dr")];

  it("ranks cameras by distance, another road's counting 2.5 times as far, within reach", () => {
    // 5 is 49 m off (counts 122), 1 is 98 m off (244), 2 and 3 are on I-4 at 391 and 782 m, 4 is out of reach.
    expect(nearbyCameras(cams, [-81, 28.5], "I-4").map((c) => c.id)).toEqual([5, 1, 2]);
    expect(nearbyCameras(cams, [-81, 28.5], "I-4", 5).map((c) => c.id)).toEqual([5, 1, 2, 3]);
  });
});
