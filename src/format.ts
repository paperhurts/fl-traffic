// Times, durations, and distances in words.

const clockFmt = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });
const dayFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

/** "4:20 PM" in the viewer's own time zone. */
export const clock = (t: string | number | Date) => clockFmt.format(new Date(t));

/** "just now", "3 min ago", "2 hr ago", "Oct 3". */
export function ago(t: string | number | Date, now = Date.now()): string {
  const s = (now - new Date(t).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hr ago`;
  return dayFmt.format(new Date(t));
}

/** "34 min", "1 hr 5 min". */
export function duration(seconds: number): string {
  const m = Math.max(1, Math.round(seconds / 60));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} hr ${m % 60} min` : `${h} hr`;
}

/** "27 mi", "0.4 mi". */
export function miles(meters: number): string {
  const mi = meters / 1609.344;
  return mi < 10 ? `${mi.toFixed(1)} mi` : `${Math.round(mi)} mi`;
}

/** FL511 ends its sentences with "Last updated at 04:18 PM."; the card says when on its own line. */
export const withoutUpdated = (desc: string) => desc.replace(/\s*Last updated at \d{1,2}:\d{2} [AP]M\.?/i, "").trim();

/** FL511's camera names sometimes use underscores for spaces ("0517N_75_Alligator_Alley_M052"). */
export const cameraName = (location: string) => location.replace(/_/g, " ").replace(/\s+/g, " ").trim() || "Camera";

export const DIRECTION_WORDS: Record<string, string> = { N: "northbound", S: "southbound", E: "eastbound", W: "westbound", B: "both directions" };
