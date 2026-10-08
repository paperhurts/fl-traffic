# Florida traffic

A live map of Florida's roads, built around the drives you make: FL511's crashes, closures, slowdowns, and construction, its 4,961 traffic cameras, and TomTom's speeds on every road.

- **The map** draws every FL511 camera and every event FL511 reports, checked every minute. Tap a camera for its latest still (reloaded each minute) and a link to its live video on FL511. Tap an event for FL511's account of it (what happened, which lanes, when it was reported and updated) and stills from the nearest cameras, on the same road first. TomTom's speed tiles color every road from free-flowing to stopped. Construction zones are off until you turn them on.
- **My routes** keeps the drives you make in your browser. Each one gets its time in today's traffic against the usual time (TomTom), any crash, closure, or slowdown FL511 reports along it, in the order you'd reach it and marked when it's on the other side of the road, TomTom's slow stretches, and the route's cameras in the order you'd pass them, their stills loading as you scroll. *The trip back* reverses a route; a camera on a road that only crosses yours can be left off. The page opens on the route you last looked at.

Check before you go; don't use it while driving.

## How it works

```
index.html                 the page (Vite entry)
src/                       the map (MapLibre), cards, routes panel, data contracts (src/shared/types.ts)
scripts/cameras.ts         fetches FL511's camera list into public/data/cameras.json
scripts/dev-relay.ts       serves the relay locally
supabase/functions/fl511/  the relay: FL511's live events (and the page's TomTom key)
tests/                     data checks on public/data and tests of the relay
```

| Data | From | How |
|---|---|---|
| Cameras | FL511's camera list (`/List/GetData/Cameras`, 100 a page) and its map layer (`/map/mapIcons/Cameras`) | Fetched at each deploy (daily) into `public/data/cameras.json`: id, position, road, direction, FL511's name for it, and its image ids. Images FL511 marks disabled or blocked are dropped. Stills load straight from FL511 (`/map/Cctv/<image id>`), which caches each for a minute; live video stays on FL511, which requires its own sign-in token. |
| Crashes, closures, slowdowns, construction | FL511's traffic list (`/List/GetData/traffic`) and each map layer's positions (`/map/mapIcons/<layer>`) | FL511 has no public API and its feeds send no CORS headers, so a Supabase Edge Function relays them: about ten requests to FL511 at most once a minute, however many people have the page open, with the last good copy (marked stale) if FL511 stops answering. FL511's times are Eastern everywhere, the Panhandle's Central-time counties included. |
| Speeds | TomTom's raster flow tiles (`relative0`, `relative0-dark`) | Each road colored by its speed as a share of free flow, reloaded every three minutes. |
| Drive times, slow stretches | TomTom's Calculate Route (`traffic=true`, `computeTravelTimeFor=all`, `sectionType=traffic`) | Asked when a route opens and every three minutes while it's open. |
| Places | TomTom's search and reverse geocoding | Only when a search is submitted or a spot is picked. |
| Basemap | [OpenFreeMap](https://openfreemap.org/) (OpenStreetMap data) | Tinted to the page's colors; no key. |

**Along a route:** a camera is on a route when it's within 120 m of TomTom's line, unless its road crosses the route there (judged by the line to the next camera on the same road, 300 m to 5 km on), and within 35 m it counts either way. An event is on a route within 200 m. FL511's directions are nominal (I-4 "east" runs north through Orlando), so an event counts as the other direction only when its direction is nearer the opposite of the route's.

## Develop

```bash
npm install
npm run dev        # http://localhost:5191 (preview on 4191)
npm test           # unit tests + data checks
npm run build      # typecheck + production build into dist/
npm run cameras    # refetch FL511's camera list
```

The dev server talks to the deployed relay. To use a local one, run `npm run relay` (port 5291) and put `VITE_RELAY_URL=http://localhost:5291/fl511` in `.env.local`. With `TOMTOM_KEY` in its environment, the local relay hands the page that key; `VITE_TOMTOM_KEY` in `.env.local` does the same without a relay.

## Deploy

- **The site:** GitHub Pages, from `.github/workflows/deploy.yml` (Settings → Pages → Source: GitHub Actions). It deploys on every push to main and once a day, refreshing the camera list in the build only.
- **The relay:** `supabase functions deploy fl511 --no-verify-jwt --project-ref <ref>`. The page calls it without a key, so JWT checks stay off. Secrets: `TOMTOM_KEY` (TomTom's key for the page) and, optionally, `ALLOWED_ORIGINS` (comma-separated, to replace the built-in list of where the page is served).
- **TomTom:** a free key from [developer.tomtom.com](https://developer.tomtom.com). The page needs it in the browser, so anyone can read it there; the free tier refuses requests past its daily allowance rather than billing for them.

## Sources and credits

Cameras, events, and stills: [FL511](https://fl511.com/), the Florida Department of Transportation's traveler information service. Speeds, drive times, and places: [TomTom](https://www.tomtom.com/). Basemap: [OpenFreeMap](https://openfreemap.org/), © [OpenMapTiles](https://www.openmaptiles.org/), data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors.
