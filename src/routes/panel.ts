// "My routes": the drives the viewer saved, each with its ways in today's
// traffic (TomTom's best and the others it offers, named by their roads), what
// FL511 and TomTom report along the chosen way, and its cameras in order. Routes
// can be sent to another phone in a link (share.ts).

import { esc, minute, stillTag } from "../cards";
import { cameraImage, ROUTE_EVERY_MS } from "../config";
import { hasFeed } from "../data";
import { ago, cameraName, clock, DIRECTION_WORDS, duration, miles, withoutUpdated } from "../format";
import { measure, type LngLat, type Measured } from "../geo";
import { KINDS, markerUrl } from "../icons";
import type { TrafficMap } from "../mapview";
import type { Camera, EventKind, TrafficEvent } from "../shared/types";
import { byRoad, camerasAlong, eventsAlong, onCrossingRoad, type CameraAlong, type EventAlong } from "./match";
import { alreadySaved, autoName, sharedRoute, shareLink, short, type SharedRoute } from "./share";
import { loadRoutes, newId, recall, remember, saveRoutes, type Place, type SavedRoute } from "./store";
import { jamKind, nameOf, route as fetchRoute, search, worthShowing, type Jam, type JamKind, type RouteResult } from "./tomtom";
import { atMile, compareUsual, countWords, milepost, usuallyFastest, wayNames } from "./words";

export interface PanelDeps {
  map: TrafficMap;
  key: string | null;
  cameras: Camera[];
  events: () => TrafficEvent[];
  openCamera: (id: number) => void;
  openEvent: (id: number) => void;
}

type View =
  | { name: "list" }
  | { name: "edit"; id: string | null }
  | { name: "detail"; id: string; back: boolean }
  | { name: "share"; picked: Set<string>; copied: string | null }
  | { name: "offer"; routes: SharedRoute[] };

/** A way to make a drive, with what to call it. */
interface Way {
  way: RouteResult;
  name: string;
}

interface Draft {
  from: Place | null;
  to: Place | null;
  name: string;
}

interface Opened {
  result: RouteResult;
  line: Measured;
  /** The cameras listed: live ones the viewer hasn't left off. */
  cams: CameraAlong[];
  /** How many more FL511 has no live feed from. */
  dark: number;
  /** Every camera beside the route, which tells which roads it follows. */
  all: CameraAlong[];
}

/** An event along the route, and whether it's on a road the route only crosses. */
type Alert = EventAlong & { crossing: boolean };

const JAM_COLORS: Record<JamKind, string> = { closed: "--closure", heavy: "--crash", slow: "--slow", work: "--work" };
const JAM_WORDS: Record<JamKind, string> = { closed: "Closed", heavy: "Stop and go", slow: "Slow", work: "Roadwork" };

/** Events worth listing even on the other side of the road. */
const BOTH_WAYS = new Set<EventKind>(["crash", "closure", "incident", "weather"]);

const flip = (r: SavedRoute): SavedRoute => ({ ...r, from: r.to, to: r.from });

export class RoutePanel {
  /** Set while the viewer is choosing a spot on the map for From or To. */
  picking: "from" | "to" | null = null;
  onOpenChange: (open: boolean) => void = () => {};
  /** Routes offered by a link were turned down. */
  onOfferDeclined: () => void = () => {};

  private el = document.getElementById("panel")!;
  private body = document.getElementById("panelBody")!;
  private routes = loadRoutes();
  private view: View = { name: "list" };
  /** TomTom's ways for each route (and each trip back), fastest first. */
  private results = new Map<string, RouteResult[]>();
  /** The way the viewer picked on each, by name; the fastest otherwise. */
  private chosen = new Map<string, string>();
  private errors = new Map<string, string>();
  private pending = new Set<string>();
  private fitWhenReady: string | null = null;
  private draft: Draft = { from: null, to: null, name: "" };
  private found: { from: Place[]; to: Place[] } = { from: [], to: [] };
  /** What's typed in the search boxes, kept across redraws. */
  private queries = { from: "", to: "" };
  /** Each TomTom answer's measured line and cameras, worked out once. */
  private matched = new WeakMap<RouteResult, { line: Measured; all: CameraAlong[] }>();
  private roads: Map<string, Camera[]>;
  private visible = new Set<HTMLImageElement>();
  private io: IntersectionObserver;
  private timer = 0;
  private deps: PanelDeps;

  constructor(deps: PanelDeps) {
    this.deps = deps;
    this.roads = byRoad(deps.cameras);
    this.io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const img = e.target as HTMLImageElement;
          if (e.isIntersecting) {
            this.visible.add(img);
            if (!img.getAttribute("src")) img.src = cameraImage(Number(img.dataset.image), minute());
          } else this.visible.delete(img);
        }
      },
      { root: this.el, rootMargin: "200px 0px" },
    );
    this.body.addEventListener("click", (e) => this.click(e));
    this.body.addEventListener("submit", (e) => {
      e.preventDefault();
      const f = e.target as HTMLFormElement;
      if (f.dataset.search) this.search(f.dataset.search as "from" | "to");
      else if (f.id === "routeForm") this.save();
    });
    this.body.addEventListener("change", (e) => {
      const t = e.target as HTMLInputElement;
      const v = this.view;
      if (v.name !== "share" || !t.dataset.pick) return;
      if (t.checked) v.picked.add(t.dataset.pick);
      else v.picked.delete(t.dataset.pick);
      const send = this.body.querySelector<HTMLButtonElement>("[data-act=send]");
      if (send) send.disabled = !v.picked.size;
    });
    this.body.addEventListener("input", (e) => {
      const t = e.target as HTMLInputElement;
      if (t.id === "rName") this.draft.name = t.value;
      else if (t.id === "q-from") this.queries.from = t.value;
      else if (t.id === "q-to") this.queries.to = t.value;
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && this.isOpen) this.refresh(false);
    });
  }

  get isOpen() {
    return !this.el.hidden;
  }

  get hasRoutes() {
    return this.routes.length > 0;
  }

  open(open = true) {
    if (open === this.isOpen) return;
    this.el.hidden = !open;
    clearInterval(this.timer);
    if (open) {
      this.timer = window.setInterval(() => document.visibilityState === "visible" && this.refresh(false), ROUTE_EVERY_MS);
      this.render();
      this.refresh(false);
    }
    this.onOpenChange(open);
  }

  /** Opens the panel where the viewer left it: on their last route, or on the list. */
  resume() {
    const last = recall<string>("route");
    if (last && this.routes.some((r) => r.id === last)) {
      this.view = { name: "detail", id: last, back: false };
      this.fitWhenReady = this.routeKey(last, false);
    }
    this.open(true);
  }

  /** Routes a link offers: asks before saving them, or, from a bookmarked link whose routes
   *  are all here, just shows them. */
  offer(routes: SharedRoute[]) {
    const saved = routes.every((o) => this.routes.some((r) => alreadySaved(r, o)));
    this.go(saved ? { name: "list" } : { name: "offer", routes });
    this.open(true);
  }

  /** FL511's events changed: redraw what's along the open route. */
  eventsChanged() {
    if (this.isOpen && this.view.name !== "edit") this.render();
  }

  /** A spot tapped on the map while choosing From or To. */
  async picked(at: LngLat) {
    const which = this.picking;
    if (!which || !this.deps.key) return;
    this.picking = null;
    document.body.classList.remove("picking");
    this.draft[which] = { lon: at[0], lat: at[1], label: "Finding the address…" };
    this.render();
    this.draft[which] = { lon: at[0], lat: at[1], label: await nameOf(this.deps.key, at) };
    this.render();
  }

  private routeKey(id: string, back: boolean) {
    return back ? `${id}:back` : id;
  }

  private routeById(id: string) {
    return this.routes.find((r) => r.id === id) ?? null;
  }

  /** Asks TomTom for the routes on screen whose answers are older than the refresh interval (or all, when forced). */
  private refresh(force: boolean) {
    const key = this.deps.key;
    if (!key) return;
    const wanted: [SavedRoute, string][] =
      this.view.name === "list"
        ? this.routes.map((r) => [r, r.id])
        : this.view.name === "detail"
          ? (() => {
              const r = this.routeById(this.view.id);
              return r ? [[this.view.back ? flip(r) : r, this.routeKey(r.id, this.view.back)]] : [];
            })()
          : [];
    for (const [r, k] of wanted) {
      const old = this.results.get(k);
      if (this.pending.has(k) || (!force && old && Date.now() - old[0].at < ROUTE_EVERY_MS - 5000)) continue;
      this.pending.add(k);
      fetchRoute(key, r.from, r.to)
        .then((ways) => {
          this.results.set(k, ways);
          this.errors.delete(k);
          if (this.fitWhenReady === k) {
            this.fitWhenReady = null;
            this.fitWays(ways);
          }
        })
        .catch((e: Error) => this.errors.set(k, e.message))
        .finally(() => {
          this.pending.delete(k);
          if (this.view.name === "list" || this.view.name === "detail") this.render();
        });
    }
  }

  /** Shows every way, so the ones around a jam are on screen too. */
  private fitWays(ways: RouteResult[]) {
    this.deps.map.fitLine(ways.flatMap((w) => w.line));
  }

  /** A route's ways, named and fastest first (a way named like a faster one follows the same
   *  roads, so it's left out), the one picked, and the one that's usually fastest. */
  private ways(k: string): { list: Way[]; pick: Way; usual: Way | null } | null {
    const res = this.results.get(k);
    if (!res) return null;
    const names = wayNames(res);
    const seen = new Set<string>();
    const list = res.map((way, i) => ({ way, name: names[i] })).filter((w) => !seen.has(w.name) && !!seen.add(w.name));
    const pick = list.find((w) => w.name === this.chosen.get(k)) ?? list[0];
    const u = usuallyFastest(list.map((w) => w.way));
    return { list, pick, usual: u === null ? null : list[u] };
  }

  private go(view: View) {
    this.view = view;
    this.picking = null;
    document.body.classList.remove("picking");
    remember("route", view.name === "detail" ? view.id : null);
    if (view.name === "edit") {
      const r = view.id ? this.routeById(view.id) : null;
      this.draft = r ? { from: r.from, to: r.to, name: r.name } : { from: null, to: null, name: "" };
      this.found = { from: [], to: [] };
      this.queries = { from: "", to: "" };
    }
    this.el.scrollTop = 0;
    // Show the whole route on opening it, now or when TomTom answers.
    this.fitWhenReady = view.name === "detail" ? this.routeKey(view.id, view.back) : null;
    const res = this.fitWhenReady ? this.results.get(this.fitWhenReady) : undefined;
    if (res) {
      this.fitWhenReady = null;
      this.fitWays(res);
    }
    this.render();
    this.refresh(false);
  }

  private click(e: Event) {
    const t = (e.target as HTMLElement).closest<HTMLElement>("[data-act]");
    if (!t) return;
    const act = t.dataset.act!;
    const v = this.view;
    switch (act) {
      case "close":
        if (v.name === "offer") this.onOfferDeclined();
        return this.open(false);
      case "new":
        return this.go({ name: "edit", id: null });
      case "list":
        return this.go({ name: "list" });
      case "route":
        return this.go({ name: "detail", id: t.dataset.id!, back: false });
      case "back":
        if (v.name === "detail") this.go({ ...v, back: !v.back });
        return;
      case "edit":
        if (v.name === "detail") this.go({ name: "edit", id: v.id });
        return;
      case "delete":
        if (v.name === "detail" && confirm("Delete this route?")) {
          this.routes = this.routes.filter((r) => r.id !== v.id);
          saveRoutes(this.routes);
          this.go({ name: "list" });
        }
        return;
      case "cancel":
        return this.go(v.name === "edit" && v.id ? { name: "detail", id: v.id, back: false } : { name: "list" });
      case "here":
        return this.useLocation(t.dataset.which as "from" | "to");
      case "pick":
        this.picking = t.dataset.which as "from" | "to";
        document.body.classList.add("picking");
        return this.render();
      case "found": {
        const which = t.dataset.which as "from" | "to";
        this.draft[which] = this.found[which][Number(t.dataset.i)];
        this.found[which] = [];
        this.queries[which] = "";
        return this.render();
      }
      case "fit": {
        const res = v.name === "detail" ? this.results.get(this.routeKey(v.id, v.back)) : null;
        if (res) this.fitWays(res);
        return;
      }
      case "way":
        if (v.name === "detail") {
          this.chosen.set(this.routeKey(v.id, v.back), t.dataset.name!);
          this.render();
        }
        return;
      case "share":
        return this.go({ name: "share", picked: new Set(v.name === "detail" ? [v.id] : this.routes.map((r) => r.id)), copied: null });
      case "send":
        return void this.send();
      case "accept":
        if (v.name === "offer") {
          for (const r of v.routes) if (!this.routes.some((s) => alreadySaved(s, r))) this.routes.push({ id: newId(), ...r });
          saveRoutes(this.routes);
          this.go({ name: "list" });
        }
        return;
      case "decline":
        this.onOfferDeclined();
        return this.go({ name: "list" });
      case "refresh":
        return this.refresh(true);
      case "cam":
        return this.deps.openCamera(Number(t.dataset.id));
      case "event":
        return this.deps.openEvent(Number(t.dataset.id));
      case "hide":
        if (v.name === "detail") {
          const r = this.routeById(v.id);
          if (r) {
            r.hidden = [...new Set([...(r.hidden ?? []), Number(t.dataset.id)])];
            saveRoutes(this.routes);
            this.render();
          }
        }
        return;
      case "unhide":
        if (v.name === "detail") {
          const r = this.routeById(v.id);
          if (r) {
            r.hidden = [];
            saveRoutes(this.routes);
            this.render();
          }
        }
        return;
    }
  }

  private useLocation(which: "from" | "to") {
    if (!navigator.geolocation) return;
    this.draft[which] = { lon: 0, lat: 0, label: "Finding you…" };
    this.render();
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const at: LngLat = [pos.coords.longitude, pos.coords.latitude];
        this.draft[which] = { lon: at[0], lat: at[1], label: this.deps.key ? await nameOf(this.deps.key, at) : "Where you are" };
        this.render();
      },
      () => {
        this.draft[which] = null;
        this.render();
        alert("The browser didn't share your location.");
      },
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 },
    );
  }

  private async search(which: "from" | "to") {
    const input = this.body.querySelector<HTMLInputElement>(`#q-${which}`);
    const text = input?.value.trim();
    if (!text || !this.deps.key) return;
    const c = this.deps.map.map.getCenter();
    try {
      this.found[which] = await search(this.deps.key, text, [c.lng, c.lat]);
      if (!this.found[which].length) alert(`TomTom found nothing for “${text}”.`);
    } catch (e) {
      alert((e as Error).message);
    }
    this.render();
    this.body.querySelector<HTMLElement>(`[data-which="${which}"][data-act="found"]`)?.focus();
  }

  private save() {
    const v = this.view;
    const { from, to } = this.draft;
    if (v.name !== "edit" || !from || !to || !from.lat || !to.lat) return;
    const name = this.draft.name.trim() || autoName(from, to);
    let id = v.id;
    if (id) {
      const r = this.routeById(id)!;
      const moved = r.from.lat !== from.lat || r.from.lon !== from.lon || r.to.lat !== to.lat || r.to.lon !== to.lon;
      Object.assign(r, { name, from, to });
      if (moved) {
        r.hidden = [];
        this.results.delete(id);
        this.results.delete(this.routeKey(id, true));
      }
    } else {
      id = newId();
      this.routes.push({ id, name, from, to });
    }
    saveRoutes(this.routes);
    this.go({ name: "detail", id, back: false });
  }

  /** The open route's picked way: its line, cameras, and result, once TomTom has answered. */
  private opened(): Opened | null {
    const v = this.view;
    if (v.name !== "detail") return null;
    const result = this.ways(this.routeKey(v.id, v.back))?.pick.way;
    if (!result) return null;
    const hidden = new Set(this.routeById(v.id)?.hidden ?? []);
    const { line, all } = this.match(result);
    const mine = all.filter((a) => !hidden.has(a.item.id));
    const cams = mine.filter((a) => hasFeed(a.item));
    return { result, line, all, cams, dark: mine.length - cams.length };
  }

  private match(result: RouteResult) {
    let m = this.matched.get(result);
    if (!m) {
      const line = measure(result.line);
      m = { line, all: camerasAlong(line, this.deps.cameras, this.roads) };
      this.matched.set(result, m);
    }
    return m;
  }

  /** FL511's events along a route, each marked when it's on a road the route only crosses. */
  private alerts(line: Measured, all: CameraAlong[]): Alert[] {
    return eventsAlong(line, this.deps.events()).map((e) => ({ ...e, crossing: onCrossingRoad(e, all) }));
  }

  /** The crashes and closures ahead on a way, on its side of the road. */
  private trouble(way: RouteResult): Alert[] {
    const { line, all } = this.match(way);
    return this.alerts(line, all).filter((e) => e.sameWay && !e.crossing && (e.item.kind === "crash" || e.item.kind === "closure" || e.item.full));
  }

  private render() {
    this.io.disconnect();
    this.visible.clear();
    const v = this.view;
    let html: string;
    if (v.name === "offer") html = this.offerView(v.routes);
    else if (v.name === "share") html = this.shareView(v.picked, v.copied);
    else if (!this.deps.key) html = this.noKey();
    else if (v.name === "list") html = this.listView();
    else if (v.name === "edit") html = this.editView(v.id);
    else html = this.detailView(v.id, v.back);
    this.body.innerHTML = html;
    for (const img of this.body.querySelectorAll<HTMLImageElement>("img[data-image]")) this.io.observe(img);
    this.drawOnMap();
  }

  /** Keeps the route's camera stills current while they're on screen. */
  refreshStills() {
    for (const img of this.visible) img.src = cameraImage(Number(img.dataset.image), minute());
  }

  private drawOnMap() {
    const o = this.opened();
    const v = this.view;
    if (!o || v.name !== "detail") {
      this.deps.map.setRoute(null);
      return;
    }
    const jams = o.result.jams.filter(worthShowing).map((j) => ({ line: o.result.line.slice(j.from, j.to + 1), kind: jamKind(j) }));
    const others = (this.ways(this.routeKey(v.id, v.back))?.list ?? []).filter((w) => w.way !== o.result).map((w) => w.way.line);
    this.deps.map.setRoute({ line: o.result.line, jams, others }, o.cams.map((a) => a.item.id));
  }

  /** Sends the picked routes' link: the phone's share sheet, or the clipboard. */
  private async send() {
    const v = this.view;
    if (v.name !== "share") return;
    const routes = this.routes.filter((r) => v.picked.has(r.id));
    if (!routes.length) return;
    const url = shareLink(routes, location.origin + location.pathname);
    const names = routes.map((r) => sharedRoute(r).name);
    const text = `${names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0]}, on the Florida traffic map`;
    if (navigator.share) {
      try {
        await navigator.share({ title: "Florida traffic routes", text, url });
        return;
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Shown to copy by hand.
    }
    if (this.view === v) {
      v.copied = url;
      this.render();
    }
  }

  private head(title: string, back: View["name"] | null) {
    return `<div class="ph">${back ? `<button type="button" class="link" data-act="${back}">‹ Routes</button>` : ""}<h2>${esc(title)}</h2><button type="button" class="x" data-act="close" aria-label="Close routes">×</button></div>`;
  }

  private noKey() {
    return `${this.head("My routes", null)}
      <p>Routes need TomTom, which times each drive in today's traffic. Add a TomTom key to the relay's secrets as <code>TOMTOM_KEY</code> and they'll turn on.</p>`;
  }

  /** A way's time against its usual, and the crashes and closures on it. */
  private wayWords(w: RouteResult): string {
    const bad = this.trouble(w);
    return [compareUsual(w), bad.length ? `<span class="warn">${countWords(bad)} on the way</span>` : ""].filter(Boolean).join(" · ");
  }

  /** "34 min via I-75 · 6 min slower than usual", for a route in the list, and the way that's
   *  usually fastest under it when today it's at least five minutes slower. */
  private summary(r: SavedRoute): string {
    const k = r.id;
    const w = this.ways(k);
    if (!w) return this.errors.has(k) ? `<span class="err">${esc(this.errors.get(k)!)}</span>` : "Checking traffic…";
    const fast = w.list[0];
    const lines = [`<b>${duration(fast.way.seconds)}</b> via ${esc(fast.name)} · ${this.wayWords(fast.way)}`];
    const u = w.usual;
    if (u && u !== fast && u.way.seconds - fast.way.seconds >= 300) {
      lines.push(`${esc(u.name)}, usually fastest: <b>${duration(u.way.seconds)}</b> · ${this.wayWords(u.way)}`);
    }
    return lines.map((l) => `<span class="rway">${l}</span>`).join("");
  }

  private listView() {
    const items = this.routes
      .map(
        (r) => `<li><button type="button" class="route" data-act="route" data-id="${r.id}">
          <span class="rname">${esc(r.name)}</span>
          <span class="rsum">${this.summary(r)}</span></button></li>`,
      )
      .join("");
    return `${this.head("My routes", null)}
      ${
        items
          ? `<ol class="routes">${items}</ol><p class="hint">Saved in this browser. Times are TomTom's, in today's traffic.</p>`
          : `<p>Add the drives you make. Each one gets its time in today's traffic, the other ways to go, any crash or closure FL511 reports on the way, and the cameras along it in the order you'd pass them.</p>`
      }
      <div class="row"><button type="button" class="primary" data-act="new">Add a route</button>${
        items ? `<button type="button" class="primary quiet" data-act="share">Send to a phone</button>` : ""
      }</div>`;
  }

  private placeField(which: "from" | "to") {
    const p = this.draft[which];
    const label = which === "from" ? "From" : "To";
    const found = this.found[which]
      .map((f, i) => `<li><button type="button" data-act="found" data-which="${which}" data-i="${i}">${esc(f.label)}</button></li>`)
      .join("");
    const picking = this.picking === which ? `<p class="hint picking-hint">Tap the map where the drive ${which === "from" ? "starts" : "ends"}.</p>` : "";
    return `<fieldset class="place"><legend>${label}</legend>
      ${p ? `<p class="chosen">${esc(p.label)}</p>` : ""}
      <form data-search="${which}" class="find"><input id="q-${which}" type="search" value="${esc(this.queries[which])}" placeholder="Search a place or address" aria-label="${label}: search a place or address" enterkeyhint="search"><button type="submit">Find</button></form>
      ${found ? `<ul class="found">${found}</ul>` : ""}
      <div class="row"><button type="button" class="link" data-act="here" data-which="${which}">Where I am</button><button type="button" class="link" data-act="pick" data-which="${which}">Pick on the map</button></div>
      ${picking}
    </fieldset>`;
  }

  private editView(id: string | null) {
    const ready = this.draft.from && this.draft.to && this.draft.from.lat && this.draft.to.lat;
    return `${this.head(id ? "Edit route" : "New route", "list")}
      ${this.placeField("from")}
      ${this.placeField("to")}
      <form id="routeForm">
        <label class="name">Name <input id="rName" value="${esc(this.draft.name)}" placeholder="${
          this.draft.from && this.draft.to ? esc(autoName(this.draft.from, this.draft.to)) : "Home to work"
        }"></label>
        <div class="row"><button type="submit" class="primary" ${ready ? "" : "disabled"}>Save route</button><button type="button" class="link" data-act="cancel">Cancel</button></div>
      </form>`;
  }

  private detailView(id: string, back: boolean) {
    const saved = this.routeById(id);
    if (!saved) return this.listView();
    const r = back ? flip(saved) : saved;
    const k = this.routeKey(id, back);
    const o = this.opened();
    const title = back ? `${saved.name}, the trip back` : saved.name;
    const top = `${this.head(title, "list")}
      <p class="ends">${esc(short(r.from.label))} → ${esc(short(r.to.label))}</p>
      <div class="row acts">
        <button type="button" class="chip" data-act="back">${back ? "The trip there" : "The trip back"}</button>
        <button type="button" class="chip" data-act="fit">Show on map</button>
        <button type="button" class="chip" data-act="refresh">Refresh</button>
      </div>`;
    const bottom = `<div class="row tail"><button type="button" class="link" data-act="edit">Edit this route</button><button type="button" class="link" data-act="share">Send to a phone</button><button type="button" class="link" data-act="delete">Delete it</button></div>`;
    if (!o) {
      const err = this.errors.get(k);
      return `${top}<p class="${err ? "err" : "hint"}">${err ? esc(err) : "Asking TomTom for today's traffic…"}</p>${bottom}`;
    }
    const res = o.result;
    // Across the median or on a road the route only crosses, only what slows everyone
    // (people slow down to look at a crash) is worth a line.
    const events = this.alerts(o.line, o.all).filter((e) => (e.sameWay && !e.crossing) || BOTH_WAYS.has(e.item.kind) || e.item.full);
    const alerts = [
      ...events.map((e) => ({ along: e.along, html: this.eventItem(e) })),
      ...res.jams.filter(worthShowing).map((j) => ({ along: o.line.cum[j.from], html: this.jamItem(j, o.line) })),
    ].sort((a, b) => a.along - b.along);
    const hiddenCount = saved.hidden?.length ?? 0;
    const cams = o.cams
      .map(
        (a) => `<li><button type="button" class="cam" data-act="cam" data-id="${a.item.id}">
          ${stillTag(a.item.images[0], `Latest still from ${cameraName(a.item.location)}`, "thumb", false, true)}
          <span><b>${milepost(a.along)}</b> ${esc(cameraName(a.item.location))}</span></button>
          <button type="button" class="link hide" data-act="hide" data-id="${a.item.id}" aria-label="Leave this camera off the route">Not on my way</button></li>`,
      )
      .join("");
    const w = this.ways(k)!;
    return `${top}
      <div class="sum">
        <div class="big">${duration(res.seconds)}</div>
        <div>via ${esc(w.pick.name)} · ${compareUsual(res)} · ${miles(res.meters)} · TomTom, ${clock(res.at)}</div>
      </div>
      ${w.list.length > 1 ? `<h3>Ways to go</h3><ol class="ways">${w.list.map((x) => this.wayItem(x, w)).join("")}</ol>` : ""}
      <h3>On the way</h3>
      ${alerts.length ? `<ol class="alerts">${alerts.map((a) => a.html).join("")}</ol>` : `<p class="hint">Nothing reported on the way.</p>`}
      <h3>Cameras on the way <span class="count">${o.cams.length}</span></h3>
      ${
        cams
          ? `<ol class="cams">${cams}</ol>`
          : `<p class="hint">${o.dark ? "FL511 has no live feed from the cameras along this drive right now." : "FL511 has no cameras along this drive."}</p>`
      }
      ${cams && o.dark ? `<p class="hint">${o.dark} more on the way ${o.dark === 1 ? "has" : "have"} no live feed right now.</p>` : ""}
      ${hiddenCount ? `<p class="hint">${hiddenCount} camera${hiddenCount === 1 ? "" : "s"} left off. <button type="button" class="link" data-act="unhide">Put them back</button></p>` : ""}
      ${bottom}`;
  }

  /** A way to go, picked with a tap: drawn solid on the map when picked, dashed otherwise. */
  private wayItem(x: Way, w: { list: Way[]; pick: Way; usual: Way | null }) {
    const on = x === w.pick;
    const fast = x === w.list[0];
    const note = w.usual && w.usual !== w.list[0] ? (fast ? "fastest now" : x === w.usual ? "usually fastest" : "") : "";
    return `<li><button type="button" class="way${on ? " on" : ""}" data-act="way" data-name="${esc(x.name)}" aria-pressed="${on}">
      <span class="stroke" aria-hidden="true"></span>
      <span><b>${esc(x.name)}</b> ${duration(x.way.seconds)}${note ? ` <i>${note}</i>` : ""}<small>${this.wayWords(x.way)}</small></span></button></li>`;
  }

  /** Picks routes to send to another phone in a link. */
  private shareView(picked: Set<string>, copied: string | null) {
    const items = this.routes
      .map((r) => {
        const s = sharedRoute(r);
        return `<li><label><input type="checkbox" data-pick="${r.id}" ${picked.has(r.id) ? "checked" : ""}>
          <span><b>${esc(s.name)}</b><small>${esc(short(s.from.label))} → ${esc(short(s.to.label))}</small></span></label></li>`;
      })
      .join("");
    return `${this.head("Send to a phone", "list")}
      <p>Pick the routes to send. Whoever opens the link can add them to their own routes, on their phone or computer.</p>
      <ul class="picks">${items}</ul>
      <button type="button" class="primary" data-act="send" ${picked.size ? "" : "disabled"}>Send the link</button>
      ${
        copied
          ? `<p class="ok">Link copied. Paste it into a text or an email.</p><input class="linkbox" readonly value="${esc(copied)}" aria-label="The link" onfocus="this.select()">`
          : ""
      }
      <p class="hint">The link holds each route's name and its two ends, to about a block. A street address goes as its town, as shown above.</p>`;
  }

  /** Routes a link offers, saved only when the viewer says so. */
  private offerView(routes: SharedRoute[]) {
    const fresh = routes.filter((o) => !this.routes.some((r) => alreadySaved(r, o)));
    const items = routes
      .map((r) => `<li><span><b>${esc(r.name)}</b><small>${esc(short(r.from.label))} → ${esc(short(r.to.label))}</small></span></li>`)
      .join("");
    const these = routes.length === 1 ? "this route" : `these ${routes.length} routes`;
    const add = fresh.length === 1 ? (routes.length === 1 ? "Add it" : "Add the new one") : fresh.length === routes.length ? "Add them" : `Add the ${fresh.length} new ones`;
    return `${this.head("Routes from a link", null)}
      <p>Add ${these} to your routes? They're saved in this browser, like routes you make here, and each one shows its time in today's traffic and the other ways to go.</p>
      <ul class="picks">${items}</ul>
      <div class="row"><button type="button" class="primary" data-act="accept">${add}</button><button type="button" class="link" data-act="decline">Not now</button></div>
      <p class="hint">Bookmark the page once they're added: opening the bookmark shows them, and puts them back if the browser ever clears what it saved.</p>`;
  }

  private eventItem(a: Alert) {
    const e = a.item;
    const kind = KINDS[e.kind];
    const dir = DIRECTION_WORDS[e.dir];
    const what = [e.road && `${esc(e.road)}${dir ? ` ${dir}` : ""}`, e.lanes && esc(e.lanes)].filter(Boolean).join(" · ");
    const aside = a.crossing ? ", on a road it crosses" : a.sameWay ? "" : ", the other direction";
    return `<li class="${aside ? "other" : ""}"><button type="button" data-act="event" data-id="${e.id}">
      <img src="${markerUrl(kind)}" alt="" width="20" height="20">
      <span><b>${kind.label}${e.full ? ", all lanes closed" : ""}</b> ${atMile(a.along)}${aside}
      <small>${what || esc(withoutUpdated(e.desc))}${e.updated ? ` · updated ${ago(e.updated)}` : ""}</small></span></button></li>`;
  }

  private jamItem(j: Jam, line: Measured) {
    const from = line.cum[j.from];
    const len = line.cum[j.to] - from;
    const kind = jamKind(j);
    const lost = j.delay >= 60 ? `, about ${duration(j.delay)} lost` : "";
    const speed = j.speedKmh !== null && kind !== "closed" ? ` · about ${Math.round(j.speedKmh / 1.609)} mph` : "";
    return `<li class="jam"><span class="swatch" style="background:var(${JAM_COLORS[kind]})"></span>
      <span><b>${JAM_WORDS[kind]} for ${miles(len)}</b> ${atMile(from)}${lost}<small>TomTom's speeds${speed}</small></span></li>`;
  }
}
