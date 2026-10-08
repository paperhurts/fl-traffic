// The card over the map for a tapped camera or event. FL511's text is escaped
// everywhere it's shown.

import { cameraImage, cameraPage, FL511_LIST, STILLS_EVERY_MS } from "./config";
import { ago, cameraName, clock, DIRECTION_WORDS, withoutUpdated } from "./format";
import { KINDS, markerUrl } from "./icons";
import type { Camera, TrafficEvent } from "./shared/types";

export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

/** FL511 caches each still for a minute; asking once a minute gets each new one. */
export const minute = () => Math.floor(Date.now() / 60_000);

export function stillTag(imageId: number, alt: string, cls = "still"): string {
  return `<img class="${cls}" data-image="${imageId}" src="${cameraImage(imageId, minute())}" alt="${esc(alt)}" decoding="async">`;
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

  constructor() {
    document.getElementById("cardX")!.addEventListener("click", () => this.close());
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.el.classList.contains("on")) this.close();
    });
    this.body.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>("[data-cam]");
      if (b) this.onCamera(Number(b.dataset.cam));
    });
  }

  get isOpen() {
    return this.el.classList.contains("on");
  }

  close() {
    if (!this.isOpen) return;
    this.el.classList.remove("on");
    clearInterval(this.timer);
    this.onClose();
  }

  private open(html: string) {
    this.body.innerHTML = html;
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
    this.open(`
      <h2>${esc(name)}</h2>
      <div class="kind">Camera · ${esc(c.road)}${dir ? ` · ${dir}` : ""}</div>
      <div class="stills">${c.images.map((id) => stillTag(id, `Latest still from the camera at ${name}`)).join("")}</div>
      <p class="when">FL511's latest still, reloaded every minute.</p>
      <p class="links"><a href="${cameraPage(c.id)}" target="_blank" rel="noopener">Watch it live on FL511 ↗</a></p>`);
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
