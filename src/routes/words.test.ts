import { describe, expect, it } from "vitest";
import type { TrafficEvent } from "../shared/types";
import type { EventAlong } from "./match";
import type { RouteResult } from "./tomtom";
import { atMile, compareUsual, countWords, milepost, usuallyFastest, wayNames } from "./words";

const result = (seconds: number, usual: number | null, delay = 0): RouteResult => ({ line: [], meters: 0, seconds, delay, noTraffic: null, usual, jams: [], roads: [], at: 0 });

describe("compareUsual", () => {
  it("compares today's time with the usual one", () => {
    expect(compareUsual(result(40 * 60, 32 * 60))).toBe("8 min slower than usual");
    expect(compareUsual(result(30 * 60, 33 * 60))).toBe("3 min faster than usual");
    expect(compareUsual(result(30 * 60, 30 * 60 + 50))).toBe("about as usual");
  });
  it("falls back on the delay against free flow", () => {
    expect(compareUsual(result(30 * 60, null, 300))).toBe("5 min lost to traffic");
    expect(compareUsual(result(30 * 60, null, 20))).toBe("traffic is light");
  });
});

describe("countWords", () => {
  const along = (kind: TrafficEvent["kind"], full = false) => ({ item: { kind, full } as TrafficEvent, along: 0, dist: 0, sameWay: true }) as EventAlong;
  it("counts crashes, closures, and the rest", () => {
    expect(countWords([along("crash")])).toBe("a crash");
    expect(countWords([along("crash"), along("crash"), along("closure")])).toBe("2 crashes and a closure");
    expect(countWords([along("incident", true), along("crash"), along("disabled")])).toBe("a closure, a crash and an incident");
    expect(countWords([])).toBe("");
  });
});

describe("atMile", () => {
  it("rounds to the mile", () => {
    expect(atMile(300)).toBe("at the start");
    expect(atMile(19_400)).toBe("at mile 12");
    expect(milepost(300)).toBe("Start");
    expect(milepost(19_400)).toBe("Mile 12");
  });
});

const MI = 1609.344;
const way = (...roads: [string, number][]) => ({ roads: roads.map(([road, mi]) => ({ road, meters: mi * MI })) });

describe("wayNames", () => {
  it("names each way by the road it follows farthest", () => {
    // Tampa to Ocala: I-275 into I-75; the Suncoast; and US-301 with a little I-75 at each end.
    const ways = [way(["I-275", 20], ["I-75", 70], ["SR-40", 4]), way(["I-275", 3], ["Suncoast Pkwy", 70], ["SR-200", 19]), way(["I-275", 20], ["I-75", 5], ["US-301", 39], ["Turnpike", 3], ["I-75", 28])];
    expect(wayNames(ways)).toEqual(["I-75", "Suncoast Pkwy", "US-301"]);
  });

  it("adds the road that sets a way apart when two follow the same road farthest", () => {
    expect(wayNames([way(["I-75", 60]), way(["I-75", 55], ["US-41", 6])])).toEqual(["I-75", "I-75 and US-41"]);
  });

  it("calls a way with no numbered road for a mile local roads", () => {
    expect(wayNames([way(["SR-60", 0.5]), way()])).toEqual(["local roads", "local roads"]);
  });
});

describe("usuallyFastest", () => {
  it("is the way with the shortest usual time", () => {
    expect(usuallyFastest([result(7000, 5400), result(5000, 5160), result(9000, null)])).toBe(1);
    expect(usuallyFastest([result(7000, null)])).toBe(null);
  });
});
