import { describe, expect, it } from "vitest";
import { jamKind, parsePlaces, parseRoute, worthShowing, type Jam } from "./tomtom";

// Shaped like TomTom's Calculate Route answer with computeTravelTimeFor=all and sectionType=traffic.
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
      ],
    },
  ],
};

describe("parseRoute", () => {
  it("reads the line, the times, and the slow stretches", () => {
    const r = parseRoute(answer, 1000);
    expect(r.line).toEqual([
      [-82, 28.1],
      [-81.9, 28.2],
      [-81.8, 28.3],
      [-81.7, 28.4],
    ]);
    expect(r).toMatchObject({ meters: 43210, seconds: 2400, delay: 360, noTraffic: 2040, usual: 2160, at: 1000 });
    // The travel-mode section isn't traffic, and a stretch past the line's end is dropped.
    expect(r.jams).toEqual([{ from: 1, to: 2, magnitude: 2, delay: 300, speedKmh: 31, category: "JAM" }]);
  });

  it("says so when there's no route", () => {
    expect(() => parseRoute({ routes: [] })).toThrow(/no route/);
  });

  it("does without the optional times", () => {
    const bare = { routes: [{ summary: { lengthInMeters: 1, travelTimeInSeconds: 60 }, legs: [{ points: [] }] }] };
    expect(parseRoute(bare)).toMatchObject({ delay: 0, noTraffic: null, usual: null, jams: [] });
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
