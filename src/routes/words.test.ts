import { describe, expect, it } from "vitest";
import type { TrafficEvent } from "../shared/types";
import type { EventAlong } from "./match";
import type { RouteResult } from "./tomtom";
import { atMile, compareUsual, countWords, milepost } from "./words";

const result = (seconds: number, usual: number | null, delay = 0): RouteResult => ({ line: [], meters: 0, seconds, delay, noTraffic: null, usual, jams: [], at: 0 });

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
