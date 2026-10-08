// Loading the camera list and the relay's events and settings.

import { RELAY, TOMTOM_KEY_OVERRIDE } from "./config";
import type { Camera, CameraFile, EventsResponse, RelayConfig } from "./shared/types";

export function decodeCameras(file: CameraFile): Camera[] {
  return file.cameras.map((c) => ({
    id: c[0],
    lon: c[1],
    lat: c[2],
    road: file.roads[c[3]],
    dir: c[4],
    location: c[5],
    images: c.length === 7 ? c[6] : [c[0]],
  }));
}

export async function loadCameras(): Promise<{ cameras: Camera[]; generated: string }> {
  const res = await fetch(new URL("./data/cameras.json", document.baseURI));
  if (!res.ok) throw new Error(`cameras.json: HTTP ${res.status}`);
  const file = (await res.json()) as CameraFile;
  return { cameras: decodeCameras(file), generated: file.generated };
}

export async function fetchEvents(signal?: AbortSignal): Promise<EventsResponse> {
  const res = await fetch(RELAY, { signal, cache: "no-cache" });
  if (!res.ok) throw new Error(`relay: HTTP ${res.status}`);
  return (await res.json()) as EventsResponse;
}

/** The relay's settings; a page that can't reach it still runs, without TomTom. */
export async function fetchConfig(): Promise<RelayConfig> {
  if (TOMTOM_KEY_OVERRIDE) return { tomtomKey: TOMTOM_KEY_OVERRIDE };
  try {
    const res = await fetch(`${RELAY}/config`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as RelayConfig;
  } catch {
    return { tomtomKey: null };
  }
}
