// Saved routes live in this browser only. They're a convenience: if storage is
// blocked or cleared, the page still works and just has none saved.

export interface Place {
  lon: number;
  lat: number;
  label: string;
}

export interface SavedRoute {
  id: string;
  name: string;
  from: Place;
  to: Place;
  /** Cameras the viewer took off this route (a camera on a road that only crosses it, say). */
  hidden?: number[];
}

const KEY = "fl-traffic.routes";

const isPlace = (p: unknown): p is Place =>
  !!p && typeof p === "object" && Number.isFinite((p as Place).lon) && Number.isFinite((p as Place).lat) && typeof (p as Place).label === "string";

export function loadRoutes(): SavedRoute[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    if (!Array.isArray(v)) return [];
    return v.filter((r): r is SavedRoute => !!r && typeof r.id === "string" && typeof r.name === "string" && isPlace(r.from) && isPlace(r.to));
  } catch {
    return [];
  }
}

export function saveRoutes(routes: SavedRoute[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(routes));
  } catch {
    // Storage blocked (a private window, say): the routes last until the page closes.
  }
}

export const newId = () => Math.random().toString(36).slice(2, 10);

/** Per-viewer conveniences: the last map view and the last open route. */
export function remember<T>(key: string, value: T) {
  try {
    localStorage.setItem(`fl-traffic.${key}`, JSON.stringify(value));
  } catch {
    // ignore
  }
}

export function recall<T>(key: string): T | null {
  try {
    const v = localStorage.getItem(`fl-traffic.${key}`);
    return v === null ? null : (JSON.parse(v) as T);
  } catch {
    return null;
  }
}
