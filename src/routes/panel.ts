// "My routes": the drives the viewer saved, each with its time in today's
// traffic, what FL511 and TomTom report along it, and its cameras in order.

import { esc, minute } from "../cards";
import { cameraImage, ROUTE_EVERY_MS } from "../config";
import { ago, cameraName, clock, DIRECTION_WORDS, duration, miles, withoutUpdated } from "../format";
import { measure, type LngLat, type Measured } from "../geo";
import { KINDS, markerUrl } from "../icons";
import type { TrafficMap } from "../mapview";
import type { Camera, EventKind, TrafficEvent } from "../shared/types";
import { byRoad, camerasAlong, eventsAlong, type Along, type EventAlong } from "./match";
import { loadRoutes, newId, recall, remember, saveRoutes, type Place, type SavedRoute } from "./store";
import { nameOf, route as fetchRoute, search, type Jam, type RouteResult } from "./tomtom";
import { atMile, compareUsual, countWords } from "./words";

export interface PanelDeps {
  map: TrafficMap;
  key: string | null;
  cameras: Camera[];
  events: () => TrafficEvent[];
  openCamera: (id: number) => void;
  openEvent: (id: number) => void;
}

type View = { name: "list" } | { name: "edit"; id: string | null } | { name: "detail"; id: string; back: boolean };

interface Draft {
  from: Place | null;
  to: Place | null;
  name: string;
}

interface Opened {
  result: RouteResult;
  line: Measured;
  cams: Along<Camera>[];
}

/** Events worth listing even on the other side of the road. */
const BOTH_WAYS = new Set<EventKind>(["crash", "closure", "incident", "weather"]);

const short = (label: string) => label.split(",")[0].trim();

const flip = (r: SavedRoute): SavedRoute => ({ ...r, from: r.to, to: r.from });

export class RoutePanel {
  /** Set while the viewer is choosing a spot on the map for From or To. */
  picking: "from" | "to" | null = null;
  onOpenChange: (open: boolean) => void = () => {};

  private el = document.getElementById("panel")!;
  private body = document.getElementById("panelBody")!;
  private routes = loadRoutes();
  private view: View = { name: "list" };
  private results = new Map<string, RouteResult>();
  private errors = new Map<string, string>();
  private pending = new Set<string>();
  private fitWhenReady: string | null = null;
  private draft: Draft = { from: null, to: null, name: "" };
  private found: { from: Place[]; to: Place[] } = { from: [], to: [] };
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
      { root: this.body, rootMargin: "200px 0px" },
    );
    this.body.addEventListener("click", (e) => this.click(e));
    this.body.addEventListener("submit", (e) => {
      e.preventDefault();
      const f = e.target as HTMLFormElement;
      if (f.dataset.search) this.search(f.dataset.search as "from" | "to");
      else if (f.id === "routeForm") this.save();
    });
    this.body.addEventListener("input", (e) => {
      const t = e.target as HTMLInputElement;
      if (t.id === "rName") this.draft.name = t.value;
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
      if (this.pending.has(k) || (!force && old && Date.now() - old.at < ROUTE_EVERY_MS - 5000)) continue;
      this.pending.add(k);
      fetchRoute(key, r.from, r.to)
        .then((res) => {
          this.results.set(k, res);
          this.errors.delete(k);
          if (this.fitWhenReady === k) {
            this.fitWhenReady = null;
            this.deps.map.fitLine(res.line);
          }
        })
        .catch((e: Error) => this.errors.set(k, e.message))
        .finally(() => {
          this.pending.delete(k);
          if (this.view.name !== "edit") this.render();
        });
    }
  }

  private go(view: View) {
    this.view = view;
    remember("route", view.name === "detail" ? view.id : null);
    if (view.name === "edit") {
      const r = view.id ? this.routeById(view.id) : null;
      this.draft = r ? { from: r.from, to: r.to, name: r.name } : { from: null, to: null, name: "" };
      this.found = { from: [], to: [] };
    }
    this.body.scrollTop = 0;
    // Show the whole route on opening it, now or when TomTom answers.
    this.fitWhenReady = view.name === "detail" ? this.routeKey(view.id, view.back) : null;
    const res = this.fitWhenReady ? this.results.get(this.fitWhenReady) : undefined;
    if (res) {
      this.fitWhenReady = null;
      this.deps.map.fitLine(res.line);
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
        return this.render();
      }
      case "fit": {
        const res = v.name === "detail" ? this.results.get(this.routeKey(v.id, v.back)) : null;
        if (res) this.deps.map.fitLine(res.line);
        return;
      }
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
    const name = this.draft.name.trim() || `${short(from.label)} to ${short(to.label)}`;
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

  /** The open route's line, cameras, and result, once TomTom has answered. */
  private opened(): Opened | null {
    const v = this.view;
    if (v.name !== "detail") return null;
    const result = this.results.get(this.routeKey(v.id, v.back));
    if (!result) return null;
    const line = measure(result.line);
    const hidden = new Set(this.routeById(v.id)?.hidden ?? []);
    const cams = camerasAlong(line, this.deps.cameras, this.roads).filter((a) => !hidden.has(a.item.id));
    return { result, line, cams };
  }

  private render() {
    for (const img of this.visible) this.io.unobserve(img);
    this.visible.clear();
    const v = this.view;
    let html: string;
    if (!this.deps.key) html = this.noKey();
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
    if (!o) {
      this.deps.map.setRoute(null);
      return;
    }
    const jams = o.result.jams.map((j) => ({ line: o.result.line.slice(j.from, j.to + 1), magnitude: j.magnitude }));
    this.deps.map.setRoute({ line: o.result.line, jams }, o.cams.map((a) => a.item.id));
  }

  private head(title: string, back: View["name"] | null) {
    return `<div class="ph">${back ? `<button type="button" class="link" data-act="${back}">‹ Routes</button>` : ""}<h2>${esc(title)}</h2><button type="button" class="x" data-act="close" aria-label="Close routes">×</button></div>`;
  }

  private noKey() {
    return `${this.head("My routes", null)}
      <p>Routes need TomTom, which times each drive in today's traffic. Add a TomTom key to the relay's secrets as <code>TOMTOM_KEY</code> and they'll turn on.</p>`;
  }

  /** "34 min, 6 min slower than usual" and what's on the way, for a route in the list. */
  private summary(r: SavedRoute): string {
    const k = r.id;
    const res = this.results.get(k);
    if (!res) return this.errors.has(k) ? `<span class="err">${esc(this.errors.get(k)!)}</span>` : "Checking traffic…";
    const bits = [`<b>${duration(res.seconds)}</b>`, compareUsual(res)];
    const bad = eventsAlong(measure(res.line), this.deps.events()).filter(
      (e) => e.sameWay && (e.item.kind === "crash" || e.item.kind === "closure" || e.item.full),
    );
    if (bad.length) bits.push(`<span class="warn">${countWords(bad)} on the way</span>`);
    return bits.join(" · ");
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
          : `<p>Add the drives you make. Each one gets its time in today's traffic, any crash or closure FL511 reports on the way, and the cameras along it in the order you'd pass them.</p>`
      }
      <button type="button" class="primary" data-act="new">Add a route</button>`;
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
      <form data-search="${which}" class="find"><input id="q-${which}" type="search" placeholder="Search a place or address" aria-label="${label}: search a place or address" enterkeyhint="search"><button type="submit">Find</button></form>
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
          this.draft.from && this.draft.to ? esc(`${short(this.draft.from.label)} to ${short(this.draft.to.label)}`) : "Home to work"
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
    const bottom = `<div class="row tail"><button type="button" class="link" data-act="edit">Edit this route</button><button type="button" class="link" data-act="delete">Delete it</button></div>`;
    if (!o) {
      const err = this.errors.get(k);
      return `${top}<p class="${err ? "err" : "hint"}">${err ? esc(err) : "Asking TomTom for today's traffic…"}</p>${bottom}`;
    }
    const res = o.result;
    // Across the median, only what slows everyone (people slow down to look at a crash) is worth a line.
    const events = eventsAlong(o.line, this.deps.events()).filter((e) => e.sameWay || BOTH_WAYS.has(e.item.kind) || e.item.full);
    const alerts = [
      ...events.map((e) => ({ along: e.along, html: this.eventItem(e) })),
      ...res.jams.map((j) => ({ along: o.line.cum[j.from], html: this.jamItem(j, o.line) })),
    ].sort((a, b) => a.along - b.along);
    const hiddenCount = saved.hidden?.length ?? 0;
    const cams = o.cams
      .map(
        (a) => `<li><button type="button" class="cam" data-act="cam" data-id="${a.item.id}">
          <img class="thumb" data-image="${a.item.images[0]}" alt="Latest still from ${esc(cameraName(a.item.location))}" decoding="async">
          <span><b>${atMile(a.along).replace(/^at /, "")}</b> ${esc(cameraName(a.item.location))}</span></button>
          <button type="button" class="link hide" data-act="hide" data-id="${a.item.id}" aria-label="Leave this camera off the route">Not on my way</button></li>`,
      )
      .join("");
    return `${top}
      <div class="sum">
        <div class="big">${duration(res.seconds)}</div>
        <div>${compareUsual(res)} · ${miles(res.meters)} · TomTom, ${clock(res.at)}</div>
      </div>
      <h3>On the way</h3>
      ${alerts.length ? `<ol class="alerts">${alerts.map((a) => a.html).join("")}</ol>` : `<p class="hint">Nothing reported on the way.</p>`}
      <h3>Cameras on the way <span class="count">${o.cams.length}</span></h3>
      ${
        cams
          ? `<ol class="cams">${cams}</ol>`
          : `<p class="hint">FL511 has no cameras along this drive.</p>`
      }
      ${hiddenCount ? `<p class="hint">${hiddenCount} camera${hiddenCount === 1 ? "" : "s"} left off. <button type="button" class="link" data-act="unhide">Put them back</button></p>` : ""}
      ${bottom}`;
  }

  private eventItem(a: EventAlong) {
    const e = a.item;
    const kind = KINDS[e.kind];
    const dir = DIRECTION_WORDS[e.dir];
    const what = [e.road && `${esc(e.road)}${dir ? ` ${dir}` : ""}`, e.lanes && esc(e.lanes)].filter(Boolean).join(" · ");
    return `<li class="${a.sameWay ? "" : "other"}"><button type="button" data-act="event" data-id="${e.id}">
      <img src="${markerUrl(kind)}" alt="" width="20" height="20">
      <span><b>${kind.label}${e.full ? ", all lanes closed" : ""}</b> ${atMile(a.along)}${a.sameWay ? "" : ", the other direction"}
      <small>${what || esc(withoutUpdated(e.desc))}${e.updated ? ` · updated ${ago(e.updated)}` : ""}</small></span></button></li>`;
  }

  private jamItem(j: Jam, line: Measured) {
    const from = line.cum[j.from];
    const len = line.cum[j.to] - from;
    const what = j.category === "ROAD_CLOSURE" ? "Closed" : j.category === "ROAD_WORK" ? "Roadwork, slow" : j.magnitude >= 3 ? "Stop and go" : "Slow";
    const lost = j.delay >= 60 ? `, about ${duration(j.delay)} lost` : "";
    const speed = j.speedKmh !== null && j.category !== "ROAD_CLOSURE" ? ` · about ${Math.round(j.speedKmh / 1.609)} mph` : "";
    const sw = j.magnitude >= 4 ? "--closure" : j.magnitude >= 3 ? "--crash" : "--slow";
    return `<li class="jam"><span class="swatch" style="background:var(${sw})"></span>
      <span><b>${what} for ${miles(len)}</b> ${atMile(from)}${lost}<small>TomTom's speeds${speed}</small></span></li>`;
  }
}
