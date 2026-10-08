import { describe, expect, it } from "vitest";
import { buildEvents, direction, eventKind, iconCoords, parseTime, plainText, toEvent, type ListRow } from "../supabase/functions/fl511/parse.ts";

describe("direction", () => {
  it("reads FL511's directions", () => {
    expect(direction("Northbound")).toBe("N");
    expect(direction("Westbound")).toBe("W");
    expect(direction("Both Directions")).toBe("B");
    expect(direction("Unknown")).toBe("");
    expect(direction(null)).toBe("");
  });
});

describe("plainText", () => {
  it("strips the HTML in construction descriptions", () => {
    expect(plainText("Lane closed. <div class='cellSpacer'><i><b>Comments:</b></i> Use caution &amp; slow down. </div>")).toBe(
      "Lane closed. Comments: Use caution & slow down.",
    );
  });
});

describe("parseTime", () => {
  it("reads FL511's times as Eastern, summer and winter", () => {
    expect(parseTime("10/8/26, 4:03 PM")).toBe("2026-10-08T20:03:00.000Z");
    expect(parseTime("1/15/26, 9:05 AM")).toBe("2026-01-15T14:05:00.000Z");
    expect(parseTime("12/31/25, 12:00 AM")).toBe("2025-12-31T05:00:00.000Z");
    expect(parseTime("7/4/26, 12:30 PM")).toBe("2026-07-04T16:30:00.000Z");
  });
  it("gives null for anything else", () => {
    expect(parseTime("")).toBeNull();
    expect(parseTime("2026-10-08T20:03:00Z")).toBeNull();
    expect(parseTime(null)).toBeNull();
  });
});

const row = (id: number, layerName: string, description = "Debris on roadway.", extra: Partial<ListRow> = {}): ListRow => ({
  id,
  layerName,
  roadwayName: "I-4",
  direction: "Eastbound",
  county: "Orange",
  description,
  laneDescription: "Right lane blocked",
  severity: "Minor",
  isFullClosure: false,
  startDate: "10/8/26, 3:30 PM",
  lastUpdated: "10/8/26, 4:07 PM",
  ...extra,
});

describe("eventKind", () => {
  it("calls an incident a crash only when FL511 says so", () => {
    expect(eventKind(row(1, "Incidents", "Multi-vehicle crash in Seminole County on I-4 East."))).toBe("crash");
    expect(eventKind(row(1, "Incidents", "Vehicle fire in Duval County on I-95 North."))).toBe("crash");
    expect(eventKind(row(1, "Incidents", "Debris on roadway in Polk County."))).toBe("incident");
  });
  it("names the other layers", () => {
    expect(eventKind(row(1, "Closures"))).toBe("closure");
    expect(eventKind(row(1, "Congestion"))).toBe("congestion");
    expect(eventKind(row(1, "Construction"))).toBe("construction");
    expect(eventKind(row(1, "DisabledVehicles"))).toBe("disabled");
    expect(eventKind(row(1, "RoadConditionIncident"))).toBe("weather");
    expect(eventKind(row(1, "SpecialEvents"))).toBe("event");
  });
});

describe("iconCoords", () => {
  it("swaps FL511's [lat, lon] and drops empty points", () => {
    const m = iconCoords({ item2: [{ itemId: "7", location: [28.41, -81.47] }, { itemId: "8", location: [0, 0] }] });
    expect([...m]).toEqual([[7, [-81.47, 28.41]]]);
  });
});

describe("toEvent", () => {
  const coords = new Map([[5, [-81.123456789, 28.987654321] as [number, number]]]);
  it("places a row and rounds its position", () => {
    expect(toEvent(row(5, "Incidents", "Crash on I-4."), coords)).toEqual({
      id: 5,
      kind: "crash",
      lon: -81.12346,
      lat: 28.98765,
      road: "I-4",
      dir: "E",
      county: "Orange",
      desc: "Crash on I-4.",
      lanes: "Right lane blocked",
      severity: "Minor",
      full: false,
      start: "2026-10-08T19:30:00.000Z",
      updated: "2026-10-08T20:07:00.000Z",
    });
  });
  it("skips rows FL511 doesn't map", () => {
    expect(toEvent(row(6, "Incidents"), coords)).toBeNull();
    expect(toEvent(row(5, "Incidents", "x", { showOnMap: false }), coords)).toBeNull();
  });
});

describe("buildEvents", () => {
  it("keeps each mapped event once, newest update first, from known layers", () => {
    const coords = new Map([
      ["Incidents", new Map([[1, [-81, 28] as [number, number]], [2, [-82, 27] as [number, number]]])],
      ["Closures", new Map([[3, [-80, 26] as [number, number]]])],
    ]);
    const evs = buildEvents(
      [
        row(1, "Incidents", "a", { lastUpdated: "10/8/26, 1:00 PM" }),
        row(2, "Incidents", "b", { lastUpdated: "10/8/26, 3:00 PM" }),
        row(2, "Incidents", "b again"),
        row(3, "Closures", "c", { lastUpdated: "10/8/26, 2:00 PM" }),
        row(4, "Mystery", "d"),
      ],
      coords,
    );
    expect(evs.map((e) => e.id)).toEqual([2, 3, 1]);
  });
});
