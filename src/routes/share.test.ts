import { describe, expect, it } from "vitest";
import { alreadySaved, routesInLink, shareLabel, shareLink, sharedRoute } from "./share";
import type { SavedRoute } from "./store";

const PAGE = "https://fl-traffic.paperhurts.dev/";

const route = (name: string, from: [number, number, string], to: [number, number, string]): SavedRoute => ({
  id: "x",
  name,
  from: { lon: from[0], lat: from[1], label: from[2] },
  to: { lon: to[0], lat: to[1], label: to[2] },
});

const zoo = route("To the zoo", [-81.37912, 28.53834, "400 S Orange Ave, Orlando, FL 32801"], [-81.12344, 28.0845, "Some Zoo, Kissimmee"]);

describe("shareLabel", () => {
  it("cuts a street address to its town", () => {
    expect(shareLabel("400 S Orange Ave, Orlando, FL 32801")).toBe("Orlando");
    expect(shareLabel("12 Main St, FL 32801")).toBe("A spot on the map");
  });
  it("keeps named places and streets without a house number", () => {
    expect(shareLabel("Ybor City Museum, Tampa")).toBe("Ybor City Museum, Tampa");
    expect(shareLabel("N Florida Ave, Tampa, FL 33602")).toBe("N Florida Ave, Tampa, FL 33602");
  });
  it("calls a spot named by its coordinates a spot on the map", () => {
    expect(shareLabel("28.5383, -81.3792")).toBe("A spot on the map");
  });
});

describe("sharedRoute", () => {
  it("rounds the ends to about a block", () => {
    const s = sharedRoute(zoo);
    expect(s.from).toEqual({ lon: -81.379, lat: 28.538, label: "Orlando" });
    expect(s.to).toEqual({ lon: -81.123, lat: 28.085, label: "Some Zoo, Kissimmee" });
    expect(s.name).toBe("To the zoo");
  });
  it("makes an automatic name again, so it doesn't carry the address", () => {
    const auto = { ...zoo, name: "400 S Orange Ave to Some Zoo" };
    expect(sharedRoute(auto).name).toBe("Orlando to Some Zoo");
  });
});

describe("shareLink and routesInLink", () => {
  it("carry routes through the fragment, names and all", () => {
    const back = route("Home from the zoo", [-81.12344, 28.0845, "Some Zoo, Kissimmee"], [-81.37912, 28.53834, "400 S Orange Ave, Orlando, FL 32801"]);
    const link = shareLink([zoo, { ...back, name: "Café — home ☕" }], PAGE);
    expect(link.startsWith(`${PAGE}#routes=`)).toBe(true);
    expect(link).not.toMatch(/Orange|32801/);
    const got = routesInLink(new URL(link).hash)!;
    expect(got).toEqual([sharedRoute(zoo), { ...sharedRoute(back), name: "Café — home ☕" }]);
  });

  it("offers nothing for other fragments or a damaged link", () => {
    expect(routesInLink("")).toBe(null);
    expect(routesInLink("#camera-12")).toBe(null);
    expect(routesInLink("#routes=not-base64!")).toBe(null);
    const link = shareLink([zoo], PAGE);
    expect(routesInLink(new URL(link).hash.slice(0, -6))).toBe(null);
  });

  it("drops routes with ends that aren't places", () => {
    const bad = btoa(JSON.stringify([1, [["Nowhere", [500, 28, "x"], [-81, 28, "y"]], ["Fine", [-81, 28, "a"], [-82, 27, ""]]]]));
    expect(routesInLink(`#routes=${bad.replace(/=+$/, "")}`)).toEqual([
      { name: "Fine", from: { lon: -81, lat: 28, label: "a" }, to: { lon: -82, lat: 27, label: "A spot on the map" } },
    ]);
  });
});

describe("alreadySaved", () => {
  it("knows a route that came from a link, or the sender's own copy of it", () => {
    const offered = routesInLink(new URL(shareLink([zoo], PAGE)).hash)![0];
    expect(alreadySaved(zoo, offered)).toBe(true);
    expect(alreadySaved({ ...zoo, id: "y", ...offered }, offered)).toBe(true);
    expect(alreadySaved({ ...zoo, name: "Somewhere else" }, offered)).toBe(false);
  });
});
