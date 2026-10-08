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
  const row = (id: number, roadway: string, images: CameraListRow["images"], wkt = "POINT (-81.5 28.3)"): CameraListRow => ({
    id,
    roadway,
    direction: "Eastbound",
    location: `${roadway} @ MM ${id}`,
    latLng: { geography: { wellKnownText: wkt } },
    images,
  });

  it("packs rows, leaving out image ids that match the site's", () => {
    const f = cameraFile([row(2, "I-4", [{ id: 2 }]), row(1, "I-75", [{ id: 9 }])], new Map(), "2026-10-08T20:00:00Z");
    expect(f.roads).toEqual(["I-4", "I-75"]);
    expect(f.cameras).toEqual([
      [1, -81.5, 28.3, 1, "E", "I-75 @ MM 1", [9]],
      [2, -81.5, 28.3, 0, "E", "I-4 @ MM 2"],
    ]);
  });

  it("prefers the map layer's position and rounds to about a meter", () => {
    const f = cameraFile([row(1, "I-4", [{ id: 1 }])], new Map([[1, [-81.1234567, 28.7654321]]]), "x");
    expect(f.cameras[0].slice(1, 3)).toEqual([-81.12346, 28.76543]);
  });

  it("drops disabled and blocked images, then sites with none, then roads with no sites", () => {
    const f = cameraFile(
      [row(1, "I-4", [{ id: 1, disabled: true }]), row(2, "I-95", [{ id: 2, blocked: true }, { id: 3 }]), row(4, "I-10", [], "POINT (0 0)")],
      new Map(),
      "x",
    );
    expect(f.roads).toEqual(["I-95"]);
    expect(f.cameras).toEqual([[2, -81.5, 28.3, 0, "E", "I-95 @ MM 2", [3]]]);
  });
});
