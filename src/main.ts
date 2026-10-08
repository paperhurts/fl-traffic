import "./style.css";
import { Card } from "./cards";
import { EVENTS_EVERY_MS, SPEEDS_EVERY_MS, STILLS_EVERY_MS } from "./config";
import { fetchConfig, fetchEvents, loadCameras } from "./data";
import { clock } from "./format";
import type { LngLat } from "./geo";
import { KINDS, markerUrl } from "./icons";
import { TrafficMap } from "./mapview";
import { nearbyCameras } from "./nearby";
import { RoutePanel } from "./routes/panel";
import { recall, remember } from "./routes/store";
import type { EventKind, EventsResponse, TrafficEvent } from "./shared/types";
import { onSchemeChange } from "./theme";

const $ = (id: string) => document.getElementById(id)!;
const lede = $("lede");

/** The kinds the lede counts, in the order it names them. */
const LEDE_KINDS: EventKind[] = ["crash", "closure", "congestion"];

async function start() {
  const view = recall<{ center: LngLat; zoom: number }>("view");
  const [tm, cams, config] = await Promise.all([TrafficMap.create($("map"), view), loadCameras(), fetchConfig()]);
  const camById = new Map(cams.cameras.map((c) => [c.id, c]));
  let events: TrafficEvent[] = [];
  let evById = new Map<number, TrafficEvent>();
  let last: EventsResponse | null = null;
  let failed = false;

  tm.setCameras(cams.cameras);

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
    card.camera(c);
    tm.select([c.lon, c.lat]);
    if (bringIntoView) tm.show([c.lon, c.lat]);
  }

  function openEvent(id: number, bringIntoView = false) {
    const e = evById.get(id);
    if (!e) return;
    card.event(e, nearbyCameras(cams.cameras, [e.lon, e.lat], e.road));
    tm.select([e.lon, e.lat]);
    if (bringIntoView) tm.show([e.lon, e.lat]);
  }

  card.onClose = () => tm.select(null);
  card.onCamera = (id) => openCamera(id, true);
  tm.onClick = (at, pick) => {
    if (panel.picking) panel.picked(at);
    else if (!pick) card.close();
    else if (pick.type === "camera") openCamera(pick.id);
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
    } catch {
      failed = true;
    }
    renderLede();
  }

  function renderLegend() {
    const shown: EventKind[] = ["crash", "incident", "closure", "congestion", "disabled", "construction", "weather", "event"];
    const items = shown.map((k) => `<li><img src="${markerUrl(KINDS[k])}" alt="">${KINDS[k].label}</li>`);
    items.push(`<li><span class="dot"></span>Camera</li>`);
    if (tm.hasFlow) items.push(`<li><span class="ramp"></span>Speeds, free to stopped <span class="note">TomTom</span></li>`);
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
  $("bWork").addEventListener("click", () => {
    chip("bWork", !pressed("bWork"));
    tm.showConstruction(pressed("bWork"));
  });
  $("bAll").addEventListener("click", () => tm.fitFlorida());
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
  setInterval(() => live() && panel.refreshStills(), STILLS_EVERY_MS);
  document.addEventListener("visibilitychange", () => {
    if (live() && last && Date.now() - Date.parse(last.fetched) > EVENTS_EVERY_MS) {
      loadEvents();
      tm.refreshSpeeds();
    }
  });

  await loadEvents();
  if (panel.hasRoutes) panel.resume();
  // For poking at the page from the console on the dev server.
  if (import.meta.env.DEV) Object.assign(window, { traffic: { tm, panel, card, events: () => events, cameras: cams.cameras } });
}

start().catch((e) => {
  console.error(e);
  lede.textContent = "The map couldn't load. Reload the page to try again.";
});
