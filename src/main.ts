import "./style.css";
import { Card, isNoFeedPicture } from "./cards";
import { EVENTS_EVERY_MS, RADAR_EVERY_MS, SPEEDS_EVERY_MS, STILLS_EVERY_MS } from "./config";
import { fetchConfig, fetchEvents, hasFeed, loadCameras, loadWebcams } from "./data";
import { cameraLabels, findPlace } from "./find";
import { clock } from "./format";
import type { LngLat } from "./geo";
import { imageUrl, KINDS, markerUrl, waterCamImage } from "./icons";
import { TrafficMap } from "./mapview";
import { nearbyCameras } from "./nearby";
import { RADAR_VALID_URL, radarStamp } from "./radar";
import { RoutePanel } from "./routes/panel";
import { recall, remember } from "./routes/store";
import type { EventKind, EventsResponse, TrafficEvent } from "./shared/types";
import { onSchemeChange } from "./theme";
import { webcamLabel } from "./webcams";

const $ = (id: string) => document.getElementById(id)!;
const lede = $("lede");

/** The kinds the lede counts, in the order it names them. */
const LEDE_KINDS: EventKind[] = ["crash", "closure", "congestion"];

async function start() {
  const saved = recall<{ center: LngLat; zoom: number }>("view");
  const view = saved && saved.center?.every(Number.isFinite) && Number.isFinite(saved.zoom) ? saved : null;
  const [tm, cams, config, webcams] = await Promise.all([TrafficMap.create($("map"), view), loadCameras(), fetchConfig(), loadWebcams()]);
  const camById = new Map(cams.cameras.map((c) => [c.id, c]));
  const webcamById = new Map(webcams.map((w) => [w.id, w]));
  const camByImage = new Map(cams.cameras.flatMap((c) => c.images.map((im) => [im, c] as const)));
  let events: TrafficEvent[] = [];
  let evById = new Map<number, TrafficEvent>();
  let last: EventsResponse | null = null;
  let failed = false;
  /** The event whose card is open, to bring up to date with each refresh. */
  let shownEvent: number | null = null;
  /** When the radar mosaic on the map was made (ISO), once one is. */
  let radarTime: string | null = null;

  tm.setCameras(cams.cameras);
  tm.setWebcams(webcams);

  const card = new Card();
  const panel = new RoutePanel({
    map: tm,
    key: config.tomtomKey,
    cameras: cams.cameras,
    events: () => events,
    openCamera: (id) => openCamera(id, true),
    openEvent: (id) => openEvent(id, true),
  });

  function openCamera(id: number, bringIntoView = false) {
    const c = camById.get(id);
    if (!c) return;
    shownEvent = null;
    card.camera(c);
    tm.select([c.lon, c.lat]);
    if (bringIntoView) tm.show([c.lon, c.lat]);
  }

  function openWebcam(id: string, bringIntoView = false) {
    const w = webcamById.get(id);
    if (!w) return;
    shownEvent = null;
    card.webcam(w);
    tm.select([w.lon, w.lat]);
    if (bringIntoView) tm.show([w.lon, w.lat]);
  }

  function openEvent(id: number, bringIntoView = false) {
    const e = evById.get(id);
    if (!e) return;
    shownEvent = id;
    card.event(e, nearbyCameras(cams.cameras.filter(hasFeed), [e.lon, e.lat], e.road));
    tm.select([e.lon, e.lat]);
    if (bringIntoView) tm.show([e.lon, e.lat]);
  }

  // Each still that loads says whether FL511 has a live feed from its camera now, which the
  // daily list can't: show it or the words in its place, and ring the camera on the map or not.
  document.addEventListener(
    "load",
    (e) => {
      const img = e.target;
      if (!(img instanceof HTMLImageElement) || !img.dataset.image) return;
      const live = !isNoFeedPicture(img);
      img.closest(".feed")?.setAttribute("data-feed", live ? "on" : "off");
      const id = Number(img.dataset.image);
      const c = camByImage.get(id);
      if (!c || c.noFeed.includes(id) === !live) return;
      const was = hasFeed(c);
      c.noFeed = live ? c.noFeed.filter((x) => x !== id) : [...c.noFeed, id];
      if (hasFeed(c) !== was) tm.setCameraFeed(c.id, !was);
    },
    true,
  );

  card.onClose = () => {
    shownEvent = null;
    tm.select(null);
  };
  card.onCamera = (id) => openCamera(id, true);
  tm.onClick = (at, pick) => {
    if (panel.picking) panel.picked(at);
    else if (!pick) card.close();
    else if (pick.type === "camera") openCamera(pick.id);
    else if (pick.type === "webcam") openWebcam(pick.id);
    else openEvent(pick.id);
  };

  function renderLede() {
    const parts: string[] = [];
    if (last) {
      const n = new Map<EventKind, number>();
      for (const e of events) n.set(e.kind, (n.get(e.kind) ?? 0) + 1);
      const counts = LEDE_KINDS.map((k) => `<b>${(n.get(k) ?? 0).toLocaleString()}</b> ${n.get(k) === 1 ? KINDS[k].label.toLowerCase() : KINDS[k].plural}`);
      parts.push(`On FL511 now: ${counts.slice(0, -1).join(", ")}, and ${counts[counts.length - 1]}, with <b>${cams.cameras.length.toLocaleString()}</b> cameras.`);
      const stale = last.stale || failed;
      parts.push(stale ? `<span class="warn">FL511 hasn't answered since ${clock(last.fetched)}.</span>` : `Updated ${clock(last.fetched)}.`);
    } else if (failed) {
      parts.push(`<span class="warn">FL511's crashes and closures aren't loading right now.</span> Its <b>${cams.cameras.length.toLocaleString()}</b> cameras still work.`);
    }
    lede.innerHTML = parts.join(" ");
  }

  async function loadEvents() {
    try {
      last = await fetchEvents();
      events = last.events;
      evById = new Map(events.map((e) => [e.id, e]));
      failed = false;
      tm.setEvents(events);
      panel.eventsChanged();
      // An open card keeps what it last said if FL511 has since cleared the event.
      if (shownEvent !== null && card.isOpen && evById.has(shownEvent)) openEvent(shownEvent);
    } catch {
      failed = true;
    }
    renderLede();
  }

  function renderLegend() {
    const shown: EventKind[] = ["crash", "incident", "closure", "congestion", "disabled", "construction", "weather", "event"];
    const items = shown.map((k) => `<li><img src="${markerUrl(KINDS[k])}" alt="">${KINDS[k].label}</li>`);
    items.push(`<li><span class="dot"></span>Camera</li>`, `<li><span class="dot off"></span>Camera, no live feed now</li>`);
    if (webcams.length) {
      items.push(`<li><img src="${imageUrl(waterCamImage(true))}" alt="">Water cam, plays here</li>`);
      items.push(`<li><img src="${imageUrl(waterCamImage(false))}" alt="">Water cam, on its own page</li>`);
    }
    if (tm.hasFlow) {
      items.push(`<li><span class="ramp"></span>Speeds, free to stopped <span class="note">TomTom</span></li>`);
      items.push(`<li><span class="shut"></span>Closed <span class="note">TomTom</span></li>`);
    }
    if (pressed("bRadar")) items.push(`<li><span class="rain"></span>Rain, light to heavy <span class="note">radar${radarTime ? ` at ${clock(radarTime)}` : ""}</span></li>`);
    items.push(`<li><span class="band"></span>Your route</li>`);
    $("legendList").innerHTML = items.join("");
  }

  // Chips
  const chip = (id: string, on: boolean) => $(id).setAttribute("aria-pressed", String(on));
  const pressed = (id: string) => $(id).getAttribute("aria-pressed") === "true";
  $("bRoutes").addEventListener("click", () => panel.open(!panel.isOpen));
  panel.onOpenChange = (open) => {
    chip("bRoutes", open);
    document.body.classList.toggle("routes-open", open);
    requestAnimationFrame(() => tm.map.resize());
    if (!open) tm.setRoute(null);
  };
  $("bCams").addEventListener("click", () => {
    chip("bCams", !pressed("bCams"));
    tm.showCameras(pressed("bCams"));
  });
  // Radar: off until asked for, then IEM's newest mosaic, checked again every few minutes.
  async function refreshRadar() {
    try {
      const res = await fetch(RADAR_VALID_URL, { cache: "no-cache" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const valid = ((await res.json()) as { meta: { valid: string } }).meta.valid;
      if (valid === radarTime) return;
      radarTime = valid;
      tm.setRadar(radarStamp(valid));
    } catch (e) {
      // IEM's newest tiles still show, without a time to give them.
      console.warn("radar:", e);
      if (!radarTime) tm.setRadar(null);
    }
    renderLegend();
  }
  $("bRadar").addEventListener("click", () => {
    chip("bRadar", !pressed("bRadar"));
    tm.showRadar(pressed("bRadar"));
    renderLegend();
    if (pressed("bRadar")) void refreshRadar();
  });
  $("bWater").hidden = !webcams.length;
  $("bWater").addEventListener("click", () => {
    chip("bWater", !pressed("bWater"));
    tm.showWaterCams(pressed("bWater"));
  });
  $("bWork").addEventListener("click", () => {
    chip("bWork", !pressed("bWork"));
    tm.showConstruction(pressed("bWork"));
  });
  $("bAll").addEventListener("click", () => tm.fitFlorida());

  // Finding a camera: the suggestions are every camera's and water cam's label; anything else typed is
  // matched word by word.
  const labels = cameraLabels(cams.cameras);
  const list = $("camList");
  for (const label of [...labels.values(), ...webcams.map(webcamLabel)].sort((a, b) => a.localeCompare(b))) {
    const o = document.createElement("option");
    o.value = label;
    list.appendChild(o);
  }
  const find = $("find") as HTMLInputElement;
  /** What the box last found, so the change that follows a picked suggestion doesn't find it again. */
  let found = "";
  const go = (exactOnly: boolean) => {
    const q = find.value.trim();
    const hit = findPlace(q, cams.cameras, labels, webcams, exactOnly);
    if (!hit) {
      if (!exactOnly && q) {
        find.setCustomValidity("No camera's name, road, county, or owner has all of those words.");
        find.reportValidity();
      }
      return;
    }
    found = q;
    if (hit.type === "camera") {
      openCamera(hit.camera.id);
      tm.show([hit.camera.lon, hit.camera.lat], 14);
    } else {
      // A water cam found while they're hidden shows them again, so its marker is there.
      if (!pressed("bWater")) $("bWater").click();
      openWebcam(hit.webcam.id);
      tm.show([hit.webcam.lon, hit.webcam.lat], 12);
    }
    find.blur();
  };
  // Picking a suggestion fills in its whole label; Enter takes whatever was typed.
  find.addEventListener("input", () => {
    find.setCustomValidity("");
    found = "";
    go(true);
  });
  find.addEventListener("change", () => {
    if (find.value.trim() !== found) go(false);
  });
  if (config.tomtomKey) {
    $("bSpeeds").hidden = false;
    tm.setFlowKey(config.tomtomKey, () => {
      // A refused key or a used-up daily allowance: say so once, and stop asking.
      if (!pressed("bSpeeds")) return;
      chip("bSpeeds", false);
      tm.showSpeeds(false);
      $("bSpeeds").title = "TomTom isn't sending speeds right now.";
    });
    $("bSpeeds").addEventListener("click", () => {
      chip("bSpeeds", !pressed("bSpeeds"));
      tm.showSpeeds(pressed("bSpeeds"));
    });
  }
  renderLegend();
  if (matchMedia("(min-width: 900px)").matches) ($("legend") as HTMLDetailsElement).open = true;

  onSchemeChange(() => {
    tm.restyle();
    renderLegend();
  });

  let saveView = 0;
  tm.map.on("moveend", () => {
    clearTimeout(saveView);
    saveView = window.setTimeout(() => {
      const c = tm.map.getCenter();
      remember("view", { center: [c.lng, c.lat], zoom: tm.map.getZoom() });
    }, 800);
  });

  // Live updates, paused while the page is hidden.
  const live = () => document.visibilityState === "visible";
  setInterval(() => live() && loadEvents(), EVENTS_EVERY_MS);
  setInterval(() => live() && tm.refreshSpeeds(), SPEEDS_EVERY_MS);
  setInterval(() => live() && pressed("bRadar") && refreshRadar(), RADAR_EVERY_MS);
  setInterval(() => live() && panel.refreshStills(), STILLS_EVERY_MS);
  document.addEventListener("visibilitychange", () => {
    if (live() && last && Date.now() - Date.parse(last.fetched) > EVENTS_EVERY_MS) {
      loadEvents();
      tm.refreshSpeeds();
      if (pressed("bRadar")) void refreshRadar();
    }
  });

  await loadEvents();
  if (panel.hasRoutes) panel.resume();
  // For poking at the page from the console on the dev server.
  if (import.meta.env.DEV) Object.assign(window, { traffic: { tm, panel, card, events: () => events, cameras: cams.cameras, labels, webcams } });
}

start().catch((e) => {
  console.error(e);
  lede.textContent = "The map couldn't load. Reload the page to try again.";
});
