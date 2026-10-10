// The map: OpenFreeMap's basemap tinted to the page's colors, TomTom's speeds,
// the open route, FL511's cameras, the water cams, and FL511's events, in that
// order from the bottom. A color-scheme change reloads the basemap, and every
// layer here is added again from what the page last gave it.

import {
  GeoJSONSource,
  GeolocateControl,
  Map as MapLibre,
  NavigationControl,
  setWorkerUrl,
  type ExpressionSpecification,
  type MapGeoJSONFeature,
  type PointLike,
  type StyleSpecification,
  type VectorTileSource,
} from "maplibre-gl";
import type { FeatureCollection, Point } from "geojson";
import "maplibre-gl/dist/maplibre-gl.css";
// MapLibre finds its worker next to its own module, which Vite moves; hand it one Vite builds.
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { BASEMAP, FLORIDA } from "./config";
import { hasFeed } from "./data";
import type { LngLat } from "./geo";
import { KINDS, markerImage, waterCamImage } from "./icons";
import type { JamKind } from "./routes/tomtom";
import type { Camera, EventKind, TrafficEvent, Webcam } from "./shared/types";
import { flowUrl, SPEED_LAYERS, speedLayers, type Bands, type SpeedColors } from "./speeds";
import { cssVar, isDark } from "./theme";
import { playsHere } from "./webcams";

export type Pick = { type: "camera"; id: number } | { type: "event"; id: number } | { type: "webcam"; id: string };

export interface RouteDrawing {
  line: LngLat[];
  /** Stretches TomTom says are slow, closed, or under roadwork. */
  jams: { line: LngLat[]; kind: JamKind }[];
}

setWorkerUrl(workerUrl);

const FL511_CREDIT = 'Cameras and events <a href="https://fl511.com/" target="_blank" rel="noopener">FL511</a> (FDOT)';

type Features = FeatureCollection;
const none = (): Features => ({ type: "FeatureCollection", features: [] });

/** The speed colors in the current scheme, from tokens.css. */
const bands = (suffix: string): Bands => ({
  free: cssVar(`--flow-free${suffix}`),
  slow: cssVar(`--flow-slow${suffix}`),
  heavy: cssVar(`--flow-heavy${suffix}`),
  stopped: cssVar(`--flow-stopped${suffix}`),
  closed: cssVar(`--flow-closed${suffix}`),
});
const speedColors = (): SpeedColors => ({ line: bands(""), edge: bands("-edge"), dash: cssVar("--flow-dash") });

/** The basemap with its land, water, and labels in the page's colors. If OpenFreeMap
 *  doesn't answer, a blank one, so FL511's cameras and events still show. */
async function basemap(): Promise<StyleSpecification> {
  const land = cssVar("--land");
  let style: StyleSpecification | null = null;
  for (let attempt = 0; attempt < 2 && !style; attempt++) {
    try {
      if (attempt) await new Promise((r) => setTimeout(r, 1500));
      const res = await fetch(isDark() ? BASEMAP.dark : BASEMAP.light);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      style = (await res.json()) as StyleSpecification;
    } catch (e) {
      console.warn("basemap:", e);
    }
  }
  if (!style) return { version: 8, sources: {}, layers: [{ id: "background", type: "background", paint: { "background-color": land } }] };
  const green = cssVar("--green");
  const paint: Record<string, Record<string, string>> = {
    background: { "background-color": land },
    water: { "fill-color": cssVar("--sea") },
    waterway: { "line-color": cssVar("--sea") },
    park: { "fill-color": green },
    landuse_park: { "fill-color": green },
    landcover_wood: { "fill-color": green },
    landuse_residential: { "fill-color": cssVar("--town") },
    road_area_pier: { "fill-color": land },
    road_pier: { "line-color": land },
  };
  if (isDark()) {
    // The dark basemap draws roads darker than the land, as voids; draw them a little lighter instead.
    const road = cssVar("--road");
    const minor = cssVar("--road-minor");
    Object.assign(paint, {
      highway_motorway_inner: { "line-color": road },
      highway_motorway_bridge_inner: { "line-color": road },
      highway_major_inner: { "line-color": minor },
      highway_major_subtle: { "line-color": minor },
      highway_motorway_subtle: { "line-color": minor },
      highway_minor: { "line-color": minor },
      // Runways and taxiways, which it draws black.
      "aeroway-runway": { "line-color": minor },
      "aeroway-taxiway": { "line-color": minor },
      "aeroway-area": { "fill-color": cssVar("--town") },
    });
  }
  // Every label above every road and fill, so the speeds and the route can go between them
  // (the dark basemap puts its water names under its roads).
  style.layers = [...style.layers.filter((l) => l.type !== "symbol"), ...style.layers.filter((l) => l.type === "symbol")];
  const label = cssVar("--label");
  const halo = cssVar("--label-halo");
  for (const layer of style.layers) {
    const p = (layer as { paint?: Record<string, unknown> }).paint;
    if (!p) continue;
    Object.assign(p, paint[layer.id]);
    // Place names, which the dark basemap draws very dim.
    if (layer.type === "symbol" && /^(place|label)_/.test(layer.id) && "text-color" in p) {
      p["text-color"] = label;
      p["text-halo-color"] = halo;
    }
  }
  return style;
}

export class TrafficMap {
  readonly map: MapLibre;
  readonly geolocate: GeolocateControl;
  /** A tap or click: where it landed, and the event or camera it hit. */
  onClick: (at: LngLat, pick: Pick | null) => void = () => {};

  private cameras: Features = none();
  private webcams: Features = none();
  private events: Features = none();
  private route: RouteDrawing | null = null;
  private routeCams: number[] = [];
  private selected: LngLat | null = null;
  private flowKey: string | null = null;
  private flowStamp = Date.now();
  private showFlow = true;
  private showCams = true;
  private showWater = true;
  private showWork = false;
  private onFlowError: () => void = () => {};
  /** Tiles TomTom refused since the last reload; a few in a row mean the key or its allowance, not a blip. */
  private flowErrors = 0;

  private constructor(map: MapLibre) {
    this.map = map;
    map.touchZoomRotate.disableRotation();
    map.keyboard.disableRotation();
    map.addControl(new NavigationControl({ showCompass: false }), "top-right");
    this.geolocate = new GeolocateControl({ positionOptions: { enableHighAccuracy: false }, showAccuracyCircle: false });
    map.addControl(this.geolocate, "top-right");
    map.on("style.load", () => this.addLayers());
    map.on("click", (e) => this.onClick([e.lngLat.lng, e.lngLat.lat], this.pickAt([e.point.x, e.point.y])));
    map.on("mousemove", (e) => {
      map.getCanvas().style.cursor = this.pickAt([e.point.x, e.point.y]) ? "pointer" : "";
    });
    map.on("error", (e) => {
      if ((e as { sourceId?: string }).sourceId === "flow" && ++this.flowErrors === 4) this.onFlowError();
    });
    // MapLibre opens the compact credits until the first drag; on a phone they cover the bottom of the map.
    map.once("load", () => {
      if (matchMedia("(max-width: 760px)").matches) {
        map.getContainer().querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show");
      }
    });
    // The basemaps name a few icons their sprites lack; a blank one keeps the console quiet.
    map.setMissingStyleImageResolver((id) => {
      if (!map.hasImage(id)) map.addImage(id, { width: 1, height: 1, data: new Uint8Array(4) });
    });
  }

  static async create(container: HTMLElement, view: { center: LngLat; zoom: number } | null): Promise<TrafficMap> {
    const map = new MapLibre({
      container,
      style: await basemap(),
      ...(view ? { center: view.center, zoom: view.zoom } : { bounds: FLORIDA, fitBoundsOptions: { padding: 12 } }),
      minZoom: 4,
      maxZoom: 19,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      maxPitch: 0,
      renderWorldCopies: false,
      attributionControl: { compact: true },
    });
    return new TrafficMap(map);
  }

  /** Reloads the basemap in the current color scheme; the layers come back with it. */
  async restyle() {
    this.map.setStyle(await basemap(), { diff: false });
  }

  private firstLabel(): string | undefined {
    return this.map.getStyle().layers.find((l) => l.type === "symbol")?.id;
  }

  private addLayers() {
    const map = this.map;
    const below = this.firstLabel();
    for (const [kind, style] of Object.entries(KINDS)) {
      const id = `ev-${kind}`;
      if (map.hasImage(id)) map.removeImage(id);
      map.addImage(id, markerImage(style), { pixelRatio: 2 });
    }
    for (const plays of [true, false]) {
      const id = plays ? "wc-plays" : "wc-link";
      if (map.hasImage(id)) map.removeImage(id);
      map.addImage(id, waterCamImage(plays), { pixelRatio: 2 });
    }

    map.addSource("route", { type: "geojson", data: this.routeLine() });
    map.addSource("jams", { type: "geojson", data: this.routeJams() });
    map.addLayer(
      {
        id: "route-halo",
        type: "line",
        source: "route",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": cssVar("--route"),
          "line-opacity": 0.38,
          "line-width": ["interpolate", ["linear"], ["zoom"], 6, 7, 10, 12, 14, 20],
        },
      },
      below,
    );
    map.addLayer(
      {
        id: "route-line",
        type: "line",
        source: "route",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": cssVar("--route"), "line-width": ["interpolate", ["linear"], ["zoom"], 6, 2, 12, 3.5] },
      },
      below,
    );

    map.addLayer(
      {
        id: "route-jam",
        type: "line",
        source: "jams",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": ["match", ["get", "kind"], "closed", cssVar("--closure"), "heavy", cssVar("--crash"), "work", cssVar("--work"), cssVar("--slow")],
          "line-width": ["interpolate", ["linear"], ["zoom"], 6, 3, 12, 6],
        },
      },
      below,
    );
    this.addFlow();

    map.addSource("cams", { type: "geojson", data: this.cameras, attribution: FL511_CREDIT });
    // A camera FL511 has no live feed from is a ring: by the daily list, or by its still once seen.
    const off: ExpressionSpecification = ["boolean", ["coalesce", ["feature-state", "off"], ["get", "off"]], false];
    const cam = cssVar("--cam");
    const halo = cssVar("--halo");
    map.addLayer({
      id: "cams",
      type: "circle",
      source: "cams",
      layout: { visibility: this.showCams ? "visible" : "none" },
      paint: {
        "circle-color": ["case", off, halo, cam],
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 1.4, 8, 2.4, 11, 4, 15, 6.5],
        "circle-stroke-color": ["case", off, cam, halo],
        "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 5, ["case", off, 0.6, 0.3], 10, ["case", off, 1.6, 1.2]],
      },
    });
    map.addLayer({
      id: "cams-route",
      type: "circle",
      source: "cams",
      filter: this.routeCamFilter(),
      paint: {
        "circle-color": cssVar("--route"),
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 3, 10, 5, 15, 8],
        "circle-stroke-color": cssVar("--halo"),
        "circle-stroke-width": 1.5,
      },
    });

    // Each water cam's card names who runs it.
    map.addSource("webcams", { type: "geojson", data: this.webcams });
    map.addLayer({
      id: "webcams",
      type: "symbol",
      source: "webcams",
      layout: {
        visibility: this.showWater ? "visible" : "none",
        "icon-image": ["case", ["get", "plays"], "wc-plays", "wc-link"],
        "icon-size": ["interpolate", ["linear"], ["zoom"], 5, 0.55, 8, 0.75, 11, 1],
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
        "symbol-sort-key": ["case", ["get", "plays"], 1, 0],
      },
    });

    map.addSource("events", { type: "geojson", data: this.events, attribution: FL511_CREDIT });
    map.addLayer({
      id: "events",
      type: "symbol",
      source: "events",
      filter: this.eventFilter(),
      layout: {
        "icon-image": ["concat", "ev-", ["get", "kind"]],
        "icon-size": ["interpolate", ["linear"], ["zoom"], 5, 0.6, 8, 0.8, 11, 1],
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
        "symbol-sort-key": ["get", "rank"],
      },
    });

    map.addSource("sel", { type: "geojson", data: this.selection() });
    map.addLayer({
      id: "sel",
      type: "circle",
      source: "sel",
      paint: {
        "circle-radius": 15,
        "circle-color": "rgba(0,0,0,0)",
        "circle-stroke-color": cssVar("--hi"),
        "circle-stroke-width": 2.5,
      },
    });
  }

  private setData(source: string, data: Features) {
    (this.map.getSource(source) as GeoJSONSource | undefined)?.setData(data);
  }

  setCameras(cams: Camera[]) {
    this.cameras = {
      type: "FeatureCollection",
      features: cams.map((c) => ({ type: "Feature", id: c.id, properties: { off: !hasFeed(c) }, geometry: { type: "Point", coordinates: [c.lon, c.lat] } })),
    };
    this.setData("cams", this.cameras);
  }

  /** A camera's still showed it live, or dark, unlike the daily list said. */
  setCameraFeed(id: number, live: boolean) {
    const f = this.cameras.features.find((x) => x.id === id);
    if (f) f.properties = { off: !live };
    if (this.map.getSource("cams")) this.map.setFeatureState({ source: "cams", id }, { off: !live });
  }

  setWebcams(cams: Webcam[]) {
    this.webcams = {
      type: "FeatureCollection",
      features: cams.map((w) => ({ type: "Feature", properties: { id: w.id, plays: playsHere(w) }, geometry: { type: "Point", coordinates: [w.lon, w.lat] } })),
    };
    this.setData("webcams", this.webcams);
  }

  setEvents(events: TrafficEvent[]) {
    this.events = {
      type: "FeatureCollection",
      features: events.map((e) => ({
        type: "Feature",
        id: e.id,
        properties: { kind: e.kind, rank: KINDS[e.kind].rank },
        geometry: { type: "Point", coordinates: [e.lon, e.lat] },
      })),
    };
    this.setData("events", this.events);
  }

  private eventFilter(): ["!=", ["get", string], EventKind] | ["==", 1, 1] {
    return this.showWork ? ["==", 1, 1] : ["!=", ["get", "kind"], "construction"];
  }

  private routeCamFilter(): ["in", ["id"], ["literal", number[]]] {
    return ["in", ["id"], ["literal", this.routeCams]];
  }

  private routeLine(): Features {
    if (!this.route) return none();
    return { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: this.route.line } }] };
  }

  private routeJams(): Features {
    if (!this.route) return none();
    return {
      type: "FeatureCollection",
      features: this.route.jams.map((j) => ({ type: "Feature", properties: { kind: j.kind }, geometry: { type: "LineString", coordinates: j.line } })),
    };
  }

  setRoute(route: RouteDrawing | null, cameraIds: number[] = []) {
    this.route = route;
    this.routeCams = cameraIds;
    this.setData("route", this.routeLine());
    this.setData("jams", this.routeJams());
    if (this.map.getLayer("cams-route")) this.map.setFilter("cams-route", this.routeCamFilter());
  }

  private selection(): Features {
    if (!this.selected) return none();
    return { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: this.selected } }] };
  }

  select(at: LngLat | null) {
    this.selected = at;
    this.setData("sel", this.selection());
  }

  /** TomTom's speeds go over the route's line and under its slow stretches and the labels. */
  private addFlow() {
    if (!this.flowKey || this.map.getSource("flow") || !this.map.getLayer("route-jam")) return;
    this.map.addSource("flow", {
      type: "vector",
      tiles: [flowUrl(this.flowKey, this.flowStamp)],
      attribution: 'Speeds <a href="https://www.tomtom.com/" target="_blank" rel="noopener">© TomTom</a>',
    });
    for (const layer of speedLayers(speedColors(), this.showFlow)) this.map.addLayer(layer, "route-jam");
  }

  /** Turns TomTom's speeds on with a key. */
  setFlowKey(key: string, onError: () => void) {
    this.flowKey = key;
    this.onFlowError = onError;
    this.addFlow();
  }

  get hasFlow() {
    return this.flowKey !== null;
  }

  showSpeeds(on: boolean) {
    this.showFlow = on;
    for (const id of SPEED_LAYERS) if (this.map.getLayer(id)) this.map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
  }

  /** TomTom updates speeds every minute; new tile URLs make the map fetch them again. */
  refreshSpeeds() {
    if (!this.flowKey || !this.showFlow) return;
    this.flowStamp = Date.now();
    this.flowErrors = 0;
    (this.map.getSource("flow") as VectorTileSource | undefined)?.setTiles([flowUrl(this.flowKey, this.flowStamp)]);
  }

  showCameras(on: boolean) {
    this.showCams = on;
    if (this.map.getLayer("cams")) this.map.setLayoutProperty("cams", "visibility", on ? "visible" : "none");
  }

  showWaterCams(on: boolean) {
    this.showWater = on;
    if (this.map.getLayer("webcams")) this.map.setLayoutProperty("webcams", "visibility", on ? "visible" : "none");
  }

  showConstruction(on: boolean) {
    this.showWork = on;
    if (this.map.getLayer("events")) this.map.setFilter("events", this.eventFilter());
  }

  /** What a tap at a screen point hits: an event before a camera or water cam, the nearest of each. */
  pickAt(pt: [number, number]): Pick | null {
    const r = 13;
    const box: [PointLike, PointLike] = [
      [pt[0] - r, pt[1] - r],
      [pt[0] + r, pt[1] + r],
    ];
    const layers = ["events", "webcams", "cams-route", "cams"].filter((id) => this.map.getLayer(id));
    if (!layers.length) return null;
    const hits = this.map.queryRenderedFeatures(box, { layers });
    const nearest = (fs: MapGeoJSONFeature[]) => {
      let best: MapGeoJSONFeature | null = null;
      let bestD = Infinity;
      for (const f of fs) {
        const [lon, lat] = (f.geometry as Point).coordinates;
        const p = this.map.project([lon, lat]);
        const d = Math.hypot(p.x - pt[0], p.y - pt[1]);
        if (d < bestD) {
          best = f;
          bestD = d;
        }
      }
      return best;
    };
    const ev = nearest(hits.filter((f) => f.layer.id === "events"));
    if (ev) return { type: "event", id: Number(ev.id) };
    const cam = nearest(hits.filter((f) => f.layer.id !== "events"));
    if (!cam) return null;
    return cam.layer.id === "webcams" ? { type: "webcam", id: String(cam.properties.id) } : { type: "camera", id: Number(cam.id) };
  }

  fitFlorida() {
    this.map.fitBounds(FLORIDA, { padding: 12 });
  }

  fitLine(line: LngLat[]) {
    let w = Infinity;
    let s = Infinity;
    let e = -Infinity;
    let n = -Infinity;
    for (const [x, y] of line) {
      w = Math.min(w, x);
      e = Math.max(e, x);
      s = Math.min(s, y);
      n = Math.max(n, y);
    }
    if (w <= e) this.map.fitBounds([w, s, e, n], { padding: 40, maxZoom: 15 });
  }

  /** Brings a spot into view without zooming out from a closer look. */
  show(at: LngLat, zoom = 13) {
    this.map.easeTo({ center: at, zoom: Math.max(this.map.getZoom(), zoom) });
  }
}
