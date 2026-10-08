// Event markers, drawn once per color scheme. Each kind has its own shape as
// well as its own color, so they stay apart for color-blind viewers and against
// TomTom's green-to-red speeds; cards and the legend name them in words too.

import type { EventKind } from "./shared/types";
import { cssVar } from "./theme";

type Shape = "diamond" | "circle" | "square" | "triangle";

export interface KindStyle {
  /** Card heading and legend label. */
  label: string;
  plural: string;
  token: string;
  shape: Shape;
  glyph: "bang" | "bar" | "lines" | "car" | "waves" | "star";
  /** Higher draws on top. */
  rank: number;
}

export const KINDS: Record<EventKind, KindStyle> = {
  closure: { label: "Road closed", plural: "closures", token: "--closure", shape: "circle", glyph: "bar", rank: 8 },
  crash: { label: "Crash", plural: "crashes", token: "--crash", shape: "diamond", glyph: "bang", rank: 7 },
  incident: { label: "Incident", plural: "other incidents", token: "--incident", shape: "diamond", glyph: "bang", rank: 6 },
  weather: { label: "Road conditions", plural: "road conditions", token: "--weather", shape: "circle", glyph: "waves", rank: 5 },
  congestion: { label: "Slow traffic", plural: "slowdowns", token: "--slow", shape: "square", glyph: "lines", rank: 4 },
  disabled: { label: "Disabled vehicle", plural: "disabled vehicles", token: "--disabled", shape: "circle", glyph: "car", rank: 3 },
  event: { label: "Special event", plural: "special events", token: "--event", shape: "circle", glyph: "star", rank: 2 },
  construction: { label: "Construction", plural: "construction zones", token: "--work", shape: "triangle", glyph: "bang", rank: 1 },
};

/** Logical size of a marker in CSS pixels; drawn at 2× for sharp screens. */
export const ICON_PX = 22;
const RATIO = 2;

function outline(ctx: CanvasRenderingContext2D, shape: Shape, c: number, r: number) {
  ctx.beginPath();
  if (shape === "circle") ctx.arc(c, c, r, 0, Math.PI * 2);
  else if (shape === "diamond") {
    ctx.moveTo(c, c - r * 1.12);
    ctx.lineTo(c + r * 1.12, c);
    ctx.lineTo(c, c + r * 1.12);
    ctx.lineTo(c - r * 1.12, c);
  } else if (shape === "triangle") {
    ctx.moveTo(c, c - r * 1.05);
    ctx.lineTo(c + r * 1.12, c + r * 0.85);
    ctx.lineTo(c - r * 1.12, c + r * 0.85);
  } else {
    const s = r * 0.88;
    ctx.roundRect(c - s, c - s, s * 2, s * 2, r * 0.3);
  }
  ctx.closePath();
}

function glyph(ctx: CanvasRenderingContext2D, kind: KindStyle, c: number, r: number, ink: string) {
  ctx.fillStyle = ink;
  ctx.strokeStyle = ink;
  ctx.lineCap = "round";
  const y = kind.shape === "triangle" ? c + r * 0.12 : c;
  switch (kind.glyph) {
    case "bang":
      ctx.fillRect(c - r * 0.11, y - r * 0.5, r * 0.22, r * 0.58);
      ctx.beginPath();
      ctx.arc(c, y + r * 0.34, r * 0.13, 0, Math.PI * 2);
      ctx.fill();
      break;
    case "bar":
      ctx.fillRect(c - r * 0.58, c - r * 0.15, r * 1.16, r * 0.3);
      break;
    case "lines":
      ctx.lineWidth = r * 0.17;
      for (const dy of [-0.36, 0, 0.36]) {
        ctx.beginPath();
        ctx.moveTo(c - r * 0.48, c + dy * r);
        ctx.lineTo(c + r * 0.48, c + dy * r);
        ctx.stroke();
      }
      break;
    case "car":
      ctx.beginPath();
      ctx.roundRect(c - r * 0.6, c - r * 0.12, r * 1.2, r * 0.42, r * 0.1);
      ctx.moveTo(c - r * 0.36, c - r * 0.12);
      ctx.lineTo(c - r * 0.22, c - r * 0.42);
      ctx.lineTo(c + r * 0.22, c - r * 0.42);
      ctx.lineTo(c + r * 0.36, c - r * 0.12);
      ctx.fill();
      for (const dx of [-0.34, 0.34]) {
        ctx.beginPath();
        ctx.arc(c + dx * r, c + r * 0.34, r * 0.14, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case "waves":
      ctx.lineWidth = r * 0.15;
      for (const dy of [-0.2, 0.2]) {
        ctx.beginPath();
        for (let i = 0; i <= 12; i++) {
          const x = c - r * 0.55 + (i / 12) * r * 1.1;
          const yy = c + dy * r + Math.sin((i / 12) * Math.PI * 2) * r * 0.12;
          if (i) ctx.lineTo(x, yy);
          else ctx.moveTo(x, yy);
        }
        ctx.stroke();
      }
      break;
    case "star": {
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const rr = i % 2 ? r * 0.26 : r * 0.6;
        ctx.lineTo(c + Math.cos(a) * rr, c + Math.sin(a) * rr);
      }
      ctx.closePath();
      ctx.fill();
      break;
    }
  }
}

/** One marker as image data for the map, at 2× (pass pixelRatio: 2). */
export function markerImage(kind: KindStyle, size = ICON_PX): ImageData {
  const px = size * RATIO;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = px;
  const ctx = canvas.getContext("2d")!;
  const c = px / 2;
  const r = px * 0.36;
  // A halo in the page's background color keeps the marker clear of roads and other markers.
  outline(ctx, kind.shape, c, r);
  ctx.lineJoin = "round";
  ctx.lineWidth = px * 0.1;
  ctx.strokeStyle = cssVar("--halo");
  ctx.stroke();
  ctx.fillStyle = cssVar(kind.token);
  ctx.fill();
  glyph(ctx, kind, c, r, cssVar(kind.token === "--work" ? "--glyph-dark" : "--glyph"));
  return ctx.getImageData(0, 0, px, px);
}

/** The same marker as a data URL, for the legend and cards. */
export function markerUrl(kind: KindStyle, size = ICON_PX): string {
  const img = markerImage(kind, size);
  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  canvas.getContext("2d")!.putImageData(img, 0, 0);
  return canvas.toDataURL();
}
