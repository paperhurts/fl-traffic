// Checks every water cam in public/data/webcams.json, which is edited by hand:
//   npm run webcams
// - each YouTube stream still exists and still lets other sites play it (YouTube's oEmbed
//   answers 401 once its owner turns embedding off, and 400 or 404 once the video is gone; a
//   stream that restarts comes back under a new id, which its owner's page will have);
// - each picture loads, and how old it is;
// - each owner's page answers. Some turn away scripts (403 and the like): those are listed to
//   open in a browser, not counted as broken.
// Exits 1 if anything is broken. Behind a proxy (as in a cloud session), Node's fetch needs
// NODE_USE_ENV_PROXY=1.

import { readFileSync } from "node:fs";
import type { WebcamFile } from "../src/shared/types.ts";

const UA = "fl-traffic (+https://github.com/paperhurts/fl-traffic)";
const file = JSON.parse(readFileSync(new URL("../public/data/webcams.json", import.meta.url), "utf8")) as WebcamFile;

type Verdict = "ok" | "open in a browser" | "broken";
interface Check {
  what: string;
  run: () => Promise<[Verdict, string]>;
}

/** One more try after a pause when the connection fails: some city sites are slow to answer. */
async function get(url: string): Promise<Response> {
  try {
    return await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(30_000) });
  } catch {
    await new Promise((r) => setTimeout(r, 3000));
    return await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(30_000) });
  }
}

const hours = (modified: string | null) => (modified ? `${((Date.now() - Date.parse(modified)) / 3_600_000).toFixed(1)} h old` : "no date");

async function youtube(id: string): Promise<[Verdict, string]> {
  const res = await get(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}`);
  if (res.status === 401) return ["broken", "its owner no longer lets other sites play it"];
  if (!res.ok) return ["broken", `YouTube has no video ${id} (HTTP ${res.status})`];
  const o = (await res.json()) as { title?: string; author_name?: string };
  return ["ok", `"${o.title}" from ${o.author_name}`];
}

async function picture(url: string): Promise<[Verdict, string]> {
  const res = await get(url);
  await res.body?.cancel();
  const type = res.headers.get("content-type") ?? "";
  if (!res.ok || !type.startsWith("image/")) return ["broken", `HTTP ${res.status}, ${type || "no type"}`];
  return ["ok", hours(res.headers.get("last-modified"))];
}

async function page(url: string): Promise<[Verdict, string]> {
  const res = await get(url);
  await res.body?.cancel();
  if (res.ok) return ["ok", `HTTP ${res.status}`];
  if ([401, 403, 429].includes(res.status)) return ["open in a browser", `HTTP ${res.status} to a script`];
  return ["broken", `HTTP ${res.status}`];
}

const checks: Check[] = [];
for (const pageUrl of new Set(file.cams.map((w) => w.page))) {
  const names = file.cams.filter((w) => w.page === pageUrl).map((w) => w.name);
  checks.push({ what: `page of ${names.join(", ")}: ${pageUrl}`, run: () => page(pageUrl) });
}
for (const w of file.cams) {
  for (const v of w.views ?? []) {
    const what = `${w.name}, ${v.label}`;
    if (v.youtube) checks.push({ what: `${what}: youtube ${v.youtube}`, run: () => youtube(v.youtube!) });
    if (v.picture) checks.push({ what: `${what}: ${v.picture}`, run: () => picture(v.picture!) });
  }
}

/** A few at a time, to go easy on everyone's servers. */
const results: [Verdict, string][] = new Array(checks.length);
let next = 0;
await Promise.all(
  Array.from({ length: 6 }, async () => {
    while (next < checks.length) {
      const i = next++;
      try {
        results[i] = await checks[i].run();
      } catch (e) {
        const cause = (e as Error & { cause?: { code?: string } }).cause?.code;
        results[i] = ["broken", `${(e as Error).message}${cause ? ` (${cause})` : ""}`];
      }
    }
  }),
);

const ORDER: Verdict[] = ["broken", "open in a browser", "ok"];
for (const verdict of ORDER) {
  const these = checks.map((c, i) => [c, results[i]] as const).filter(([, r]) => r[0] === verdict);
  if (!these.length) continue;
  console.log(`\n${verdict.toUpperCase()} (${these.length})`);
  for (const [c, [, detail]] of these) console.log(`  ${c.what}\n      ${detail}`);
}
const broken = results.filter((r) => r[0] === "broken").length;
console.log(`\n${checks.length} checks, ${broken} broken. The list was last checked by hand on ${file.checked}.`);
process.exitCode = broken ? 1 : 0;
