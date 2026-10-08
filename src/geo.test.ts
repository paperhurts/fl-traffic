import { describe, expect, it } from "vitest";
import { angleBetween, bearing, directionBearing, distance, lineAngle, measure, nearBox, place, slice, type LngLat } from "./geo";

// A line due east along 28°N, about 98 km per degree of longitude there.
const east: LngLat[] = [
  [-82, 28],
  [-81.5, 28],
  [-81, 28],
];

describe("distance and bearing", () => {
  it("measures a degree of latitude as about 111 km", () => {
    expect(distance([-81, 28], [-81, 29])).toBeCloseTo(111_195, -2);
  });
  it("shrinks a degree of longitude with latitude", () => {
    expect(distance([-82, 28], [-81, 28])).toBeCloseTo(111_195 * Math.cos((28 * Math.PI) / 180), -2);
  });
  it("gives compass bearings", () => {
    expect(bearing([-81, 28], [-81, 29])).toBeCloseTo(0);
    expect(bearing([-81, 28], [-80, 28])).toBeCloseTo(90);
    expect(bearing([-81, 28], [-81, 27])).toBeCloseTo(180);
    expect(bearing([-81, 28], [-82, 28])).toBeCloseTo(270);
  });
  it("compares bearings and lines", () => {
    expect(angleBetween(350, 10)).toBe(20);
    expect(angleBetween(90, 270)).toBe(180);
    expect(lineAngle(90, 270)).toBe(0);
    expect(lineAngle(0, 100)).toBe(80);
  });
  it("reads FL511's directions as bearings", () => {
    expect(directionBearing("E")).toBe(90);
    expect(directionBearing("B")).toBeNull();
  });
});

describe("measure and place", () => {
  const line = measure(east);
  it("adds up the length and the box", () => {
    expect(line.length).toBeCloseTo(distance([-82, 28], [-81, 28]), 3);
    expect(line.bbox).toEqual([-82, 28, -81, 28]);
  });
  it("places a point beside the line by its distance off and along", () => {
    const p = place(line, [-81.25, 28.001]);
    expect(p.dist).toBeCloseTo(111.2, 0);
    expect(p.along).toBeCloseTo(line.length * 0.75, -1);
    expect(p.bearing).toBeCloseTo(90);
  });
  it("clamps to the ends", () => {
    const p = place(line, [-82.5, 28]);
    expect(p.along).toBe(0);
    expect(p.dist).toBeCloseTo(distance([-82.5, 28], [-82, 28]), 0);
  });
  it("tells whether a point is near a box", () => {
    expect(nearBox(line.bbox, [-81.5, 28.0005], 100)).toBe(true);
    expect(nearBox(line.bbox, [-81.5, 28.01], 100)).toBe(false);
  });
  it("cuts out a stretch", () => {
    const s = slice(line, line.length * 0.25, line.length * 0.75);
    expect(s[0][0]).toBeCloseTo(-81.75);
    expect(s[1]).toEqual([-81.5, 28]);
    expect(s[2][0]).toBeCloseTo(-81.25);
  });
});
