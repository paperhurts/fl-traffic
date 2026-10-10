// The card over the map for a tapped camera, water cam, or event. FL511's text
// is escaped everywhere it's shown, and so is the water cams' list.

import { cameraImage, cameraPage, FL511_LIST, STILLS_EVERY_MS } from "./config";
import { ago, cameraName, clock, DIRECTION_WORDS, withoutUpdated } from "./format";
import { KINDS, markerUrl } from "./icons";
import type { Camera, TrafficEvent, Webcam, WebcamView } from "./shared/types";
import { pictureUrl, WEBCAM_KINDS, youtubeEmbed } from "./webcams";

export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

/** FL511 caches each still for a minute; asking once a minute gets each new one. */
export const minute = () => Math.floor(Date.now() / 60_000);

/** For a camera with no live feed, FL511 serves a "No live camera feed at this time" picture in
 *  place of its still: always this size, which no camera's stills are. */
export const isNoFeedPicture = (img: HTMLImageElement) => img.naturalWidth === 540 && img.naturalHeight === 330;

/** A camera's still, and words in its place while FL511 has no live feed from it. The page flips
 *  `data-feed` as each still loads (main.ts), so a feed that comes back shows. `src` waits for the
 *  route panel to set it when `lazy`. */
export function stillTag(imageId: number, alt: string, cls = "still", off = false, lazy = false): string {
  const src = lazy ? "" : ` src="${cameraImage(imageId, minute())}"`;
  return `<span class="feed" data-feed="${off ? "off" : "on"}"><img class="${cls}" data-image="${imageId}"${src} alt="${esc(alt)}" decoding="async"><span class="nofeed">No live feed right now</span></span>`;
}

/** Points every still inside `root` at this minute's image. */
export function refreshStills(root: ParentNode) {
  const m = minute();
  for (const img of root.querySelectorAll<HTMLImageElement>("img[data-image]")) {
    const next = cameraImage(Number(img.dataset.image), m);
    if (img.src !== next) img.src = next;
  }
}

export class Card {
  onClose: () => void = () => {};
  onCamera: (id: number) => void = () => {};
  private el = document.getElementById("card")!;
  private body = document.getElementById("cardBody")!;
  private timer = 0;
  /** The open water cam's name and views, for its view buttons. */
  private views: { name: string; list: WebcamView[] } | null = null;

  constructor() {
    document.getElementById("cardX")!.addEventListener("click", () => this.close());
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.el.classList.contains("on")) this.close();
    });
    this.body.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>("[data-cam]");
      if (b) this.onCamera(Number(b.dataset.cam));
      const v = (e.target as HTMLElement).closest<HTMLElement>("[data-view]");
      if (v) this.play(Number(v.dataset.view));
    });
  }

  get isOpen() {
    return this.el.classList.contains("on");
  }

  close() {
    if (!this.isOpen) return;
    this.el.classList.remove("on");
    clearInterval(this.timer);
    // A water cam's player would keep streaming out of sight.
    this.body.innerHTML = "";
    this.views = null;
    this.onClose();
  }

  private open(html: string) {
    this.body.innerHTML = html;
    this.views = null;
    this.el.classList.add("on");
    this.el.scrollTop = 0;
    clearInterval(this.timer);
    if (this.body.querySelector("img[data-image]")) {
      this.timer = window.setInterval(() => refreshStills(this.body), STILLS_EVERY_MS);
    }
  }

  camera(c: Camera) {
    const name = cameraName(c.location);
    const dir = DIRECTION_WORDS[c.dir];
    const where = [esc(c.road), dir, c.county && `${esc(c.county)} County`].filter(Boolean).join(" · ");
    this.open(`
      <h2>${esc(name)}</h2>
      <div class="kind">Camera · ${where}</div>
      <div class="stills">${c.images.map((id) => stillTag(id, `Latest still from the camera at ${name}`, "still", c.noFeed.includes(id))).join("")}</div>
      <p class="when">FL511's latest still, reloaded every minute.</p>
      <p class="links"><a href="${cameraPage(c.id)}" target="_blank" rel="noopener">Watch it live on FL511 ↗</a></p>`);
  }

  /** A water cam: its first view playing, buttons for any others, and its owner's page. */
  webcam(w: Webcam) {
    const list = w.views ?? [];
    const buttons =
      list.length > 1
        ? `<div class="views" role="group" aria-label="Views">${list.map((v, i) => `<button type="button" data-view="${i}" aria-pressed="false">${esc(v.label)}</button>`).join("")}</div>`
        : "";
    this.open(`
      <h2>${esc(w.name)}</h2>
      <div class="kind">${WEBCAM_KINDS[w.kind]} · ${esc(w.by)}</div>
      ${buttons}
      ${list.length ? `<div class="player"></div>` : ""}
      ${w.note ? `<p class="when">${esc(w.note)}</p>` : ""}
      <p class="links"><a href="${esc(w.page)}" target="_blank" rel="noopener">${list.length ? "More on its own page" : "See it on its own page"} ↗</a></p>`);
    if (!list.length) return;
    this.views = { name: w.name, list };
    this.play(0);
  }

  private play(i: number) {
    const v = this.views?.list[i];
    const box = this.body.querySelector<HTMLElement>(".player");
    if (!v || !box) return;
    const what = `${this.views!.name}: ${v.label}`;
    box.className = "player";
    if (v.youtube) {
      box.innerHTML = `<iframe src="${youtubeEmbed(v.youtube)}" title="${esc(what)}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
    } else if (v.picture) {
      box.innerHTML = `<img src="${esc(pictureUrl(v.picture))}" alt="${esc(`Latest picture from ${what}`)}" decoding="async">`;
      // A buoy's six pictures come as one long strip: scroll it rather than shrink it to a sliver.
      const img = box.querySelector("img")!;
      img.addEventListener("load", () => box.classList.toggle("strip", img.naturalWidth > img.naturalHeight * 3), { once: true });
    }
    for (const b of this.body.querySelectorAll<HTMLElement>("[data-view]")) b.setAttribute("aria-pressed", String(b.dataset.view === String(i)));
  }

  event(e: TrafficEvent, nearby: Camera[]) {
    const kind = KINDS[e.kind];
    const desc = withoutUpdated(e.desc);
    const dir = DIRECTION_WORDS[e.dir];
    const where = [e.road && `${esc(e.road)}${dir ? ` ${dir}` : ""}`, e.county && `${esc(e.county)} County`, e.severity && esc(e.severity.toLowerCase())]
      .filter(Boolean)
      .join(" · ");
    const when = [e.start && `Reported ${clock(e.start)}`, e.updated && `updated ${ago(e.updated)}`].filter(Boolean).join(", ");
    const lanes = e.lanes && !desc.toLowerCase().includes(e.lanes.toLowerCase()) ? `<p class="lanes">${esc(e.lanes)}</p>` : "";
    const cams = nearby.length
      ? `<div class="nearby"><div class="kind">Cameras nearby</div><div class="thumbs">${nearby
          .map(
            (c) =>
              `<button type="button" data-cam="${c.id}">${stillTag(c.images[0], `Latest still from ${cameraName(c.location)}`, "thumb")}<span>${esc(cameraName(c.location))}</span></button>`,
          )
          .join("")}</div></div>`
      : "";
    this.open(`
      <div class="ev-head"><img src="${markerUrl(kind)}" alt="" width="22" height="22"><h2>${kind.label}${e.full ? " · all lanes closed" : ""}</h2></div>
      <div class="kind">${where}</div>
      <p>${esc(desc)}</p>
      ${lanes}
      <p class="when">${when}${when ? "." : ""}</p>
      ${cams}
      <p class="links"><a href="${FL511_LIST}" target="_blank" rel="noopener">FL511's list of everything on the roads ↗</a></p>`);
  }
}
