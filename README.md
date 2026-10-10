# Florida traffic

A live map of Florida's roads, built around the drives you make, with FL511's crashes, closures, slowdowns, and construction, its 4,961 traffic cameras, TomTom's speeds on every road, the Weather Service's radar, and 114 beach and water cams: **[fl-traffic.paperhurts.dev](https://fl-traffic.paperhurts.dev/)**

- **The map** draws every FL511 camera and every event FL511 reports, checked every minute. Tap a camera for its latest still (reloaded each minute) and a link to its live video on FL511; a camera FL511 has no live feed from is a ring, and its card says so. *Find a camera* takes a name, road, or county ("Skyway", "Gandy", "bridge Pinellas"). Tap an event for FL511's account of it (what happened, which lanes, when it was reported and updated) and stills from the nearest live cameras, on the same road first. TomTom's speeds color every road from free-flowing to stopped. *Radar* shows where it's raining now, light to heavy, from the Weather Service's newest radar picture (a new one every five minutes). Construction zones and radar are off until you turn them on.
- **Water cams** are the drops along the coast and up the rivers: beach, pier, inlet, bay, river, spring, and buoy cams run by counties, cities, tourism bureaus, USGS, NOAA, and nonprofits. The 18 filled drops play on the page, as live YouTube streams or USGS's and NOAA's latest pictures; the rest open on their owners' pages (see [Water cams](#water-cams)). *Find a camera* finds them by name or owner ("Siesta", "Naples pier", "Volusia").
- **My routes** keeps the drives you make in your browser. Each one gets its time in today's traffic against the usual time (TomTom), any crash, closure, or slowdown FL511 reports along it, in the order you'd reach it and dimmed when it's on the other side of the road or on a road the route only crosses, TomTom's slow stretches and roadwork, and the route's cameras in the order you'd pass them, their stills loading as you scroll. *The trip back* reverses a route; a camera on a road that only crosses yours can be left off. The page opens on the route you last looked at.

Check before you go; don't use it while driving.

## How it works

```
index.html                 the page (Vite entry)
src/                       the map (MapLibre), cards, routes panel, data contracts (src/shared/types.ts)
scripts/cameras.ts         fetches FL511's camera list into public/data/cameras.json
scripts/webcams.ts         checks the hand-picked water cams in public/data/webcams.json
scripts/dev-relay.ts       serves the relay locally
supabase/functions/fl511/  the relay: FL511's live events (and the page's TomTom key)
tests/                     data checks on public/data and tests of the relay
```

| Data | From | How |
|---|---|---|
| Cameras | FL511's camera list (`/List/GetData/Cameras`, 100 a page) and its map layer (`/map/mapIcons/Cameras`) | Fetched at each deploy (daily) into `public/data/cameras.json`: id, position, road, direction, county, FL511's name for it, its image ids, and which images FL511 lists with no video feed (about one in six). Images FL511 marks disabled or blocked are dropped. A camera with no feed gets FL511's "No live camera feed" picture for a still, so the page rings it, leaves it off routes and event cards, and checks each still as it loads, since feeds come back during the day. Stills load straight from FL511 (`/map/Cctv/<image id>`), which caches each for a minute; live video stays on FL511, which requires its own sign-in token. |
| Crashes, closures, slowdowns, construction | FL511's traffic list (`/List/GetData/traffic`) and each map layer's positions (`/map/mapIcons/<layer>`) | FL511 has no public API and its feeds send no CORS headers, so a Supabase Edge Function relays them: about ten requests to FL511 at most once a minute, however many people have the page open, with the last good copy (marked stale) if FL511 stops answering. FL511's times are Eastern everywhere, the Panhandle's Central-time counties included. |
| Speeds | TomTom's vector flow tiles (`relative`) | Each road colored by its speed as a share of free flow, in the bands of TomTom's `relative0` style (stopped under 15%, heavy under 35%, slow under 75%), with closed roads dashed, reloaded every three minutes. The vector tiles carry state roads from zoom 8 or 9 and county roads from 10 or 11; TomTom's raster tiles left all but the interstates and a few US highways blank until zoom 13. Zoomed out, a two-way road is one line showing its slower direction; by zoom 13 each direction has its own side. |
| Drive times, slow stretches | TomTom's Calculate Route (`traffic=true`, `computeTravelTimeFor=all`, `sectionType=traffic`) | Asked when a route opens and every three minutes while it's open. |
| Places | TomTom's search and reverse geocoding | Only when a search is submitted or a spot is picked. |
| Radar | The National Weather Service's NEXRAD radars, mosaicked nationwide by the Iowa Environmental Mesonet (IEM): base reflectivity (N0Q), every five minutes | Asked for only while Radar is on. The tiles are fetched by mosaic time (`ridge::USCOMP-N0Q-<UTC minute>`, from IEM's `n0q_0.json`), so a browser keeps them and new ones come only with a new mosaic. IEM draws every tile from its n0q color table, so the page reads each pixel's dBZ back through the table, hides anything under 20 dBZ (drizzle, and the birds, insects, and clutter radar picks up on clear nights), and repaints the rest in one blue ramp, light to heavy: the Weather Service's green-to-red would read as speeds. |
| Water cams | Picked by hand into `public/data/webcams.json` | Name, owner, position, and owner's page for each; for the ones that play here, YouTube ids or picture URLs. Streams play through YouTube's privacy-enhanced player, loaded only when a card opens; pictures load straight from USGS and NOAA. |
| Basemap | [OpenFreeMap](https://openfreemap.org/) (OpenStreetMap data) | Tinted to the page's colors; no key. |

**Along a route:** a camera is on a route when it's within 120 m of TomTom's line, unless its road crosses the route there, and within 35 m it counts either way. A road's direction is the long axis of its cameras within 3 km; one neighbor isn't enough, since at a big interchange the nearest camera on the crossing road is often on a ramp alongside the route. An event is on a route within 200 m. FL511's directions are nominal (I-4 "east" runs north through Orlando), so an event counts as the other direction only when its direction is nearer the opposite of the route's. An event is on a road the route only crosses when none of the route's own cameras within 3 km are on its road. Across the median or on a crossing road, only crashes, closures, incidents, and road conditions are listed, dimmed. TomTom's slow stretches are listed when they cost half a minute or more; closures and roadwork always are.

## Water cams

The list keeps cams run by public bodies and nonprofits, and plays one on the page only when its owner allows that:

- **Pictures** that are public domain: USGS's CoastCam at Madeira Beach and its Loxahatchee River camera (from USGS's camera service), and NOAA's three buoy cams off Florida. A data test holds pictures to those agencies' hosts.
- **YouTube streams** from public bodies and nonprofits that let other sites play them: Volusia County's five beach cams, the Santa Rosa Island Authority's three on Pensacola Beach, Deerfield Beach's five, Hollywood's two, Siesta Beach, Wahoo Bay's reef, and Save the Manatee Club's cams at Blue Spring, Homosassa, and Silver Springs (live in manatee season, highlights the rest of the year).

The other 96 open on their owners' pages: the Florida Severe Weather Network's WeatherSTEM cams need written permission to show elsewhere, and the rest (the tourism bureaus' players, inlet districts' cams hosted by Erdman Video Systems, cities' own players) publish no terms that allow it. Left out: cams run by businesses (hotels, bars, surf shops, EarthCam's and similar networks), road views, and cams that were dead or long stale when checked.

YouTube gives a stream a new id when it restarts, and owners move their pages. `npm run webcams` checks every stream (still there, still playable elsewhere), picture, and page, and lists the sites that turn away scripts to check in a browser; fix what it finds from the owner's page and update `checked` in the file.

## Develop

```bash
npm install
npm run dev        # http://localhost:5191 (preview on 4191)
npm test           # unit tests + data checks
npm run build      # typecheck + production build into dist/
npm run cameras    # refetch FL511's camera list
npm run webcams    # check the water cams' streams, pictures, and pages
```

The dev server talks to the deployed relay. To use a local one, run `npm run relay` (port 5291) and put `VITE_RELAY_URL=http://localhost:5291/fl511` in `.env.local`. With `TOMTOM_KEY` in its environment, the local relay hands the page that key; `VITE_TOMTOM_KEY` in `.env.local` does the same without a relay.

## Deploy

- **The site:** GitHub Pages, from `.github/workflows/deploy.yml` (Settings → Pages → Source: GitHub Actions). It deploys on every push to main and once a day, refreshing the camera list in the build only.
- **The relay:** `supabase functions deploy fl511 --no-verify-jwt --project-ref <ref>`. The page calls it without a key, so JWT checks stay off. Secrets: `TOMTOM_KEY` (TomTom's key for the page) and, optionally, `ALLOWED_ORIGINS` (comma-separated, to replace the built-in list of where the page is served).
- **TomTom:** a free key from [developer.tomtom.com](https://developer.tomtom.com). The page needs it in the browser, so anyone can read it there; the free tier refuses requests past its daily allowance rather than billing for them.

## Sources and credits

Cameras, events, and stills: [FL511](https://fl511.com/), the Florida Department of Transportation's traveler information service. Radar: the [National Weather Service](https://www.weather.gov/)'s NEXRAD network, through the [Iowa Environmental Mesonet](https://mesonet.agron.iastate.edu/) at Iowa State University. Water cams: their owners, named on each card; pictures from the [U.S. Geological Survey](https://apps.usgs.gov/hivis/) and NOAA's [National Data Buoy Center](https://www.ndbc.noaa.gov/). Speeds, drive times, and places: [TomTom](https://www.tomtom.com/). Basemap: [OpenFreeMap](https://openfreemap.org/), © [OpenMapTiles](https://www.openmaptiles.org/), data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors.
