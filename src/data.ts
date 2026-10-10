// Loading the camera list and the relay's events and settings.

import { RELAY, TOMTOM_KEY_OVERRIDE } from "./config";
import type { Camera, CameraFile, EventsResponse, RelayConfig, Webcam, WebcamFile } from "./shared/types";

export function decodeCameras(file: CameraFile): Camera[] {
  const off = new Set(file.noFeed);
  return file.cameras.map((c) => {
    const images = c.length === 8 ? c[7] : [c[0]];
    return {
      id: c[0],
      lon: c[1],
      lat: c[2],
      road: file.roads[c[3]],
      dir: c[4],
      location: c[5],
      county: file.counties[c[6]],
      images,
      noFeed: images.filter((id) => off.has(id)),
    };
  });
}

/** Whether any of a camera's images has a live feed. */
export const hasFeed = (c: Camera) => c.images.some((id) => !c.noFeed.includes(id));

export async function loadCameras(): Promise<{ cameras: Camera[]; generated: string }> {
  const res = await fetch(new URL("./data/cameras.json", document.baseURI));
  if (!res.ok) throw new Error(`cameras.json: HTTP ${res.status}`);
  const file = (await res.json()) as CameraFile;
  return { cameras: decodeCameras(file), generated: file.generated };
}

/** The beach and water cams; without them the rest of the page still works. */
export async function loadWebcams(): Promise<Webcam[]> {
  try {
    const res = await fetch(new URL("./data/webcams.json", document.baseURI));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return ((await res.json()) as WebcamFile).cams;
  } catch (e) {
    console.warn("webcams.json:", e);
    return [];
  }
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
