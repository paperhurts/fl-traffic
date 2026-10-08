import { describe, expect, it } from "vitest";
import { measure, type LngLat } from "../geo";
import type { Camera, TrafficEvent } from "../shared/types";
import { byRoad, camerasAlong, crossesRoute, eventsAlong } from "./match";

// About 111 m per 0.001° of latitude; at 28°N, about 98 m per 0.001° of longitude.
const cam = (id: number, lon: number, lat: number, road: string): Camera => ({ id, lon, lat, road, dir: "E", location: `${road} ${id}`, images: [id] });

// A route due east along 28°N, from -82 to -81.
const route: LngLat[] = [
  [-82, 28],
  [-81, 28],
];

describe("camerasAlong", () => {
  const cams = [
    cam(1, -81.2, 28.0005, "I-4"), // beside the road, 56 m off
    cam(2, -81.8, 27.9995, "I-4"), // beside the road on the other side
    cam(3, -81.5, 28.003, "I-4"), // 333 m off: too far
    cam(4, -81.5, 28.0008, "SR-100"), // 89 m off, on a road that crosses...
    cam(5, -81.5, 28.03, "SR-100"), // ...going north
    cam(6, -81.4, 28.0002, "SR-200"), // 22 m off, on a crossing road, but close enough to see it
    cam(7, -81.4, 28.04, "SR-200"),
  ];

  it("keeps cameras beside the route, in the order you'd pass them", () => {
    const got = camerasAlong(measure(route), cams).map((a) => a.item.id);
    expect(got).toEqual([2, 6, 1]);
  });

  it("knows a crossing road by its next camera along it", () => {
    const roads = byRoad(cams);
    expect(crossesRoute(cams[3], 90, roads)).toBe(true);
    expect(crossesRoute(cams[0], 90, roads)).toBe(false);
    // A camera with no neighbor on its road can't be judged, so it stays.
    expect(crossesRoute(cam(9, -81.5, 28, "Lonely Rd"), 90, roads)).toBe(false);
  });
});

describe("eventsAlong", () => {
  const ev = (id: number, lon: number, lat: number, dir: TrafficEvent["dir"]): TrafficEvent => ({
    id,
    kind: "crash",
    lon,
    lat,
    road: "I-4",
    dir,
    county: "Polk",
    desc: "",
    lanes: "",
    severity: "Minor",
    full: false,
    start: null,
    updated: null,
  });

  it("finds events on the route and which way they block", () => {
    const got = eventsAlong(measure(route), [ev(1, -81.3, 28.001, "W"), ev(2, -81.7, 28.0005, "E"), ev(3, -81.5, 28.01, "E"), ev(4, -81.6, 28, "B")]);
    expect(got.map((e) => [e.item.id, e.sameWay])).toEqual([
      [2, true],
      [4, true],
      [1, false],
    ]);
  });

  it("reads nominal directions by whichever is nearer", () => {
    // A road signed east that runs north-northeast here, like I-4 through Orlando.
    const nne = measure([
      [-81.4, 28.5],
      [-81.36, 28.6],
    ]);
    expect(eventsAlong(nne, [ev(1, -81.38, 28.55, "E")])[0].sameWay).toBe(true);
    expect(eventsAlong(nne, [ev(1, -81.38, 28.55, "W")])[0].sameWay).toBe(false);
  });
});
