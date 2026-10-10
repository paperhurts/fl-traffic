import { describe, expect, it } from "vitest";
import { jamKind, parsePlaces, parseRoutes, roadRuns, shieldName, worthShowing, type Jam } from "./tomtom";

// Shaped like TomTom's Calculate Route answer with computeTravelTimeFor=all, sectionType=traffic and
// roadShields, and maxAlternatives (here, one other way, slower).
const answer = {
  formatVersion: "0.0.12",
  routes: [
    {
      summary: {
        lengthInMeters: 43210,
        travelTimeInSeconds: 2400,
        trafficDelayInSeconds: 360,
        trafficLengthInMeters: 3200,
        noTrafficTravelTimeInSeconds: 2040,
        historicTrafficTravelTimeInSeconds: 2160,
        liveTrafficIncidentsTravelTimeInSeconds: 2400,
      },
      legs: [
        {
          summary: { lengthInMeters: 43210 },
          points: [
            { latitude: 28.1, longitude: -82.0 },
            { latitude: 28.2, longitude: -81.9 },
            { latitude: 28.3, longitude: -81.8 },
            { latitude: 28.4, longitude: -81.7 },
          ],
        },
      ],
      sections: [
        { startPointIndex: 0, endPointIndex: 3, sectionType: "TRAVEL_MODE", travelMode: "car" },
        { startPointIndex: 1, endPointIndex: 2, sectionType: "TRAFFIC", simpleCategory: "JAM", effectiveSpeedInKmh: 31, delayInSeconds: 300, magnitudeOfDelay: 2 },
        { startPointIndex: 2, endPointIndex: 9, sectionType: "TRAFFIC", simpleCategory: "JAM", magnitudeOfDelay: 1 },
        { startPointIndex: 0, endPointIndex: 1, sectionType: "ROAD_SHIELDS", roadShieldReferences: [{ reference: "usa-interstate", shieldContent: "275", affixes: ["N"] }] },
        { startPointIndex: 1, endPointIndex: 3, sectionType: "ROAD_SHIELDS", roadShieldReferences: [{ reference: "usa-interstate", shieldContent: "75", affixes: ["N"] }] },
      ],
    },
    {
      summary: { lengthInMeters: 50000, travelTimeInSeconds: 3000, historicTrafficTravelTimeInSeconds: 2900 },
      legs: [{ points: [{ latitude: 28.1, longitude: -82.0 }, { latitude: 28.4, longitude: -81.6 }] }],
    },
  ],
};

describe("parseRoutes", () => {
  it("reads each way's line, times, slow stretches, and roads, fastest first", () => {
    const [r, other] = parseRoutes({ routes: [...answer.routes].reverse() }, 1000);
    expect(r.line).toEqual([
      [-82, 28.1],
      [-81.9, 28.2],
      [-81.8, 28.3],
      [-81.7, 28.4],
    ]);
    expect(r).toMatchObject({ meters: 43210, seconds: 2400, delay: 360, noTraffic: 2040, usual: 2160, at: 1000 });
    // The travel-mode section isn't traffic, and a stretch past the line's end is dropped.
    expect(r.jams).toEqual([{ from: 1, to: 2, magnitude: 2, delay: 300, speedKmh: 31, category: "JAM" }]);
    expect(r.roads.map((x) => x.road)).toEqual(["I-275", "I-75"]);
    expect(r.roads[1].meters).toBeCloseTo(2 * r.roads[0].meters, -2);
    expect(other).toMatchObject({ seconds: 3000, usual: 2900, roads: [], jams: [] });
  });

  it("says so when there's no route", () => {
    expect(() => parseRoutes({ routes: [] })).toThrow(/no route/);
  });

  it("does without the optional times", () => {
    const bare = { routes: [{ summary: { lengthInMeters: 1, travelTimeInSeconds: 60 }, legs: [{ points: [] }] }] };
    expect(parseRoutes(bare)[0]).toMatchObject({ delay: 0, noTraffic: null, usual: null, jams: [], roads: [] });
  });
});

describe("shieldName", () => {
  it("names roads as FL511 does, and the toll roads by their names", () => {
    const name = (reference: string, shieldContent: string, lat = 28) => shieldName({ reference, shieldContent }, lat)?.name;
    expect(name("usa-interstate", "75")).toBe("I-75");
    expect(name("usa-highway", "301")).toBe("US-301");
    expect(name("usa-highway-buisness-route", "41")).toBe("US-41 Bus");
    expect(name("usa-fl-state-route", "200")).toBe("SR-200");
    expect(name("usa-county-highway", "491")).toBe("CR-491");
    expect(name("usa-fl-state-route", "91")).toBe("Turnpike");
    // SR-589 changes names north of Tampa.
    expect(name("usa-fl-state-route", "589", 28.05)).toBe("Veterans Expwy");
    expect(name("usa-fl-state-route", "589", 28.5)).toBe("Suncoast Pkwy");
    expect(shieldName({ reference: "usa-interstate" }, 28)).toBe(null);
  });
});

describe("roadRuns", () => {
  // Points a kilometer apart, northward.
  const line = Array.from({ length: 11 }, (_, i) => [-82, 28 + i / 111.195] as [number, number]);
  const shields = (from: number, to: number, ...refs: [string, string][]) => ({
    sectionType: "ROAD_SHIELDS",
    startPointIndex: from,
    endPointIndex: to,
    roadShieldReferences: refs.map(([reference, shieldContent]) => ({ reference, shieldContent })),
  });

  it("gives a shared stretch to the more important road, then to the one followed farther", () => {
    const runs = roadRuns(
      [
        shields(0, 2, ["usa-fl-state-route", "52"]),
        // US-98 and US-301 run together for a while, with SR-35 on both.
        shields(2, 5, ["usa-highway", "98"], ["usa-highway", "301"], ["usa-fl-state-route", "35"]),
        shields(5, 8, ["usa-highway", "301"], ["usa-fl-state-route", "35"]),
        // TomTom leaves gaps between stretches of one road (at a turn, say).
        shields(9, 10, ["usa-highway", "301"]),
      ],
      line,
    );
    expect(runs.map((r) => [r.road, Math.round(r.meters / 1000)])).toEqual([
      ["SR-52", 2],
      ["US-301", 7],
    ]);
  });

  it("skips sections that aren't road shields or fall off the line", () => {
    expect(roadRuns([{ sectionType: "TRAFFIC", startPointIndex: 0, endPointIndex: 3 }, shields(4, 40, ["usa-interstate", "4"])], line)).toEqual([]);
  });
});

describe("parsePlaces", () => {
  it("names a business by its name and town, anything else by its address", () => {
    const got = parsePlaces({
      results: [
        { type: "POI", poi: { name: "Ybor City Museum" }, address: { municipality: "Tampa", freeformAddress: "1818 E 9th Ave, Tampa, FL 33605" }, position: { lat: 27.96, lon: -82.43 } },
        { type: "Point Address", address: { freeformAddress: "400 S Orange Ave, Orlando, FL 32801" }, position: { lat: 28.54, lon: -81.38 } },
        { type: "Geography", address: {} },
      ],
    });
    expect(got).toEqual([
      { lon: -82.43, lat: 27.96, label: "Ybor City Museum, Tampa" },
      { lon: -81.38, lat: 28.54, label: "400 S Orange Ave, Orlando, FL 32801" },
    ]);
  });
});

describe("jamKind and worthShowing", () => {
  const jam = (category: string, magnitude: number, delay: number): Jam => ({ from: 0, to: 1, magnitude, delay, speedKmh: null, category });
  it("lets the category decide before the magnitude", () => {
    // TomTom gives roadwork of unknown delay magnitude 4, which it also uses for closures.
    expect(jamKind(jam("ROAD_WORK", 4, 0))).toBe("work");
    expect(jamKind(jam("ROAD_CLOSURE", 4, 0))).toBe("closed");
    expect(jamKind(jam("JAM", 3, 300))).toBe("heavy");
    expect(jamKind(jam("JAM", 1, 300))).toBe("slow");
    expect(jamKind(jam("OTHER", 2, 60))).toBe("slow");
  });
  it("skips slowdowns that cost under half a minute", () => {
    expect(worthShowing(jam("JAM", 1, 19))).toBe(false);
    expect(worthShowing(jam("JAM", 1, 30))).toBe(true);
    expect(worthShowing(jam("ROAD_WORK", 4, 0))).toBe(true);
    expect(worthShowing(jam("ROAD_CLOSURE", 4, 0))).toBe(true);
  });
});
