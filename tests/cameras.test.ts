import { describe, expect, it } from "vitest";
import { cameraFile, wktPoint, type CameraListRow } from "../scripts/cameras.ts";

describe("wktPoint", () => {
  it("reads lon and lat", () => {
    expect(wktPoint("POINT (-81.580975 28.292213)")).toEqual([-81.580975, 28.292213]);
  });
  it("rejects FL511's empty point and junk", () => {
    expect(wktPoint("POINT (0 0)")).toBeNull();
    expect(wktPoint("")).toBeNull();
    expect(wktPoint(null)).toBeNull();
  });
});

describe("cameraFile", () => {
  const live = (id: number) => ({ id, videoUrl: `https://example.test/chan-${id}/index.m3u8` });
  const row = (id: number, roadway: string, images: CameraListRow["images"], wkt = "POINT (-81.5 28.3)", county = "Orange"): CameraListRow => ({
    id,
    roadway,
    direction: "Eastbound",
    location: `${roadway} @ MM ${id}`,
    county,
    latLng: { geography: { wellKnownText: wkt } },
    images,
  });

  it("packs rows, leaving out image ids that match the site's", () => {
    const f = cameraFile([row(2, "I-4", [live(2)]), row(1, "I-75", [live(9)], undefined, "Lee")], new Map(), "2026-10-08T20:00:00Z");
    expect(f.roads).toEqual(["I-4", "I-75"]);
    expect(f.counties).toEqual(["Lee", "Orange"]);
    expect(f.cameras).toEqual([
      [1, -81.5, 28.3, 1, "E", "I-75 @ MM 1", 0, [9]],
      [2, -81.5, 28.3, 0, "E", "I-4 @ MM 2", 1],
    ]);
    expect(f.noFeed).toEqual([]);
  });

  it("prefers the map layer's position and rounds to about a meter", () => {
    const f = cameraFile([row(1, "I-4", [live(1)])], new Map([[1, [-81.1234567, 28.7654321]]]), "x");
    expect(f.cameras[0].slice(1, 3)).toEqual([-81.12346, 28.76543]);
  });

  it("drops disabled and blocked images, then sites with none, then roads and counties with no sites", () => {
    const f = cameraFile(
      [
        row(1, "I-4", [{ ...live(1), disabled: true }], undefined, "Polk"),
        row(2, "I-95", [{ ...live(2), blocked: true }, live(3)], undefined, "Duval"),
        row(4, "I-10", [], "POINT (0 0)", "Leon"),
      ],
      new Map(),
      "x",
    );
    expect(f.roads).toEqual(["I-95"]);
    expect(f.counties).toEqual(["Duval"]);
    expect(f.cameras).toEqual([[2, -81.5, 28.3, 0, "E", "I-95 @ MM 2", 0, [3]]]);
  });

  it("notes the images FL511 has no video feed from", () => {
    const f = cameraFile([row(1, "I-4", [{ id: 1, videoUrl: "" }]), row(2, "I-4", [live(2), { id: 5, videoUrl: null }]), row(3, "I-4", [{ id: 3 }])], new Map(), "x");
    expect(f.noFeed).toEqual([1, 3, 5]);
  });

  it("files a camera FL511 gives no county under an empty name", () => {
    const f = cameraFile([{ ...row(1, "I-4", [live(1)]), county: null }], new Map(), "x");
    expect(f.counties).toEqual([""]);
    expect(f.cameras[0][6]).toBe(0);
  });
});
