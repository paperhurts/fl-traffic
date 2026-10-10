// Where the page's data comes from.

/** The FL511 relay (supabase/functions/fl511). `npm run relay` serves one locally; point VITE_RELAY_URL at it. */
export const RELAY = import.meta.env.VITE_RELAY_URL ?? "https://pbswebsavanetmieodsf.supabase.co/functions/v1/fl511";

/** A TomTom key for local testing; the deployed site gets its key from the relay. */
export const TOMTOM_KEY_OVERRIDE: string | undefined = import.meta.env.VITE_TOMTOM_KEY || undefined;

/** Florida, west/south/east/north. */
export const FLORIDA: [number, number, number, number] = [-87.64, 24.4, -79.97, 31.01];

/** OpenFreeMap's free vector basemaps (OpenStreetMap data), no key needed. */
export const BASEMAP = {
  light: "https://tiles.openfreemap.org/styles/positron",
  dark: "https://tiles.openfreemap.org/styles/dark",
};

/** FL511's latest still from a camera image. FL511 caches them for a minute. */
export const cameraImage = (imageId: number, minute: number) => `https://fl511.com/map/Cctv/${imageId}?t=${minute}`;

/** FL511's own map, opened on a camera, where its live video plays. */
export const cameraPage = (siteId: number) => `https://fl511.com/map#camera-${siteId}`;

export const FL511_LIST = "https://fl511.com/list/events/traffic";

/** How often to ask the relay for events, and to reload camera stills. */
export const EVENTS_EVERY_MS = 60_000;
export const STILLS_EVERY_MS = 60_000;
/** How often to reload TomTom's speed tiles and the open route. */
export const SPEEDS_EVERY_MS = 180_000;
/** How often to ask IEM whether a newer radar mosaic is out (it makes one every five minutes). */
export const RADAR_EVERY_MS = 150_000;
export const ROUTE_EVERY_MS = 180_000;
