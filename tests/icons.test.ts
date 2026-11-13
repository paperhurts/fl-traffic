import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = new URL("../", import.meta.url);
const read = (f: string) => readFileSync(new URL(f, root), "utf8");

/** A PNG's width and height, from its header. */
const pngSize = (f: string) => {
  const b = readFileSync(new URL(f, root));
  return `${b.readUInt32BE(16)}x${b.readUInt32BE(20)}`;
};

describe("home screen icons", () => {
  it("has every icon the manifest lists, at its size", () => {
    const manifest = JSON.parse(read("public/manifest.webmanifest"));
    for (const icon of manifest.icons) expect(pngSize(`public/${icon.src}`), icon.src).toBe(icon.sizes);
    expect(manifest.icons.some((i: { purpose?: string }) => i.purpose === "maskable")).toBe(true);
    expect(pngSize("public/apple-touch-icon.png")).toBe("180x180");
  });

  it("links them from the page", () => {
    const html = read("index.html");
    expect(html).toMatch(/<link rel="apple-touch-icon" href="\.\/apple-touch-icon\.png">/);
    expect(html).toMatch(/<link rel="manifest" href="\.\/manifest\.webmanifest">/);
  });
});
