import { describe, expect, it } from "vitest";
import { ago, cameraName, duration, miles, withoutUpdated } from "./format";

describe("format", () => {
  it("says how long a drive takes", () => {
    expect(duration(20)).toBe("1 min");
    expect(duration(34 * 60)).toBe("34 min");
    expect(duration(65 * 60)).toBe("1 hr 5 min");
    expect(duration(120 * 60)).toBe("2 hr");
  });
  it("says how far", () => {
    expect(miles(644)).toBe("0.4 mi");
    expect(miles(43_452)).toBe("27 mi");
  });
  it("says how long ago", () => {
    const now = Date.parse("2026-10-08T20:00:00Z");
    expect(ago("2026-10-08T19:59:30Z", now)).toBe("just now");
    expect(ago("2026-10-08T19:57:00Z", now)).toBe("3 min ago");
    expect(ago("2026-10-08T17:30:00Z", now)).toBe("2 hr ago");
  });
  it("drops FL511's own update time from its sentences", () => {
    expect(withoutUpdated("Crash on I-4 East. Right shoulder blocked. Last updated at 04:18 PM.")).toBe("Crash on I-4 East. Right shoulder blocked.");
  });
  it("tidies FL511's camera names", () => {
    expect(cameraName("0517N_75_Alligator_Alley_M052")).toBe("0517N 75 Alligator Alley M052");
    expect(cameraName("")).toBe("Camera");
  });
});
