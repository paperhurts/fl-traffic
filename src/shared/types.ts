// Data contracts: every file in public/data/ and every relay response.
// scripts/cameras.ts writes cameras.json and supabase/functions/fl511/ writes
// the relay's responses to match these; webcams.json is edited by hand.
// tests/data.test.ts checks both files. The relay's types live with the
// relay, which deploys without this folder.

import type { Direction } from "../../supabase/functions/fl511/parse.ts";

export type { Direction, EventKind, EventsResponse, RelayConfig, TrafficEvent } from "../../supabase/functions/fl511/parse.ts";

/** One camera site: [id, lon, lat, road index, direction, location, county index, image ids].
 *  The image ids are left out when the site has one image with its own id. */
export type CameraRow =
  | [number, number, number, number, Direction, string, number]
  | [number, number, number, number, Direction, string, number, number[]];

/** public/data/cameras.json: every FL511 camera, fetched at build time. */
export interface CameraFile {
  /** When the list was fetched from FL511 (ISO). */
  generated: string;
  /** Road names as FL511 gives them ("I-4", "SR-528", "US-192 / Vine St / Bronson Hwy"). */
  roads: string[];
  /** County names as FL511 gives them ("Hillsborough"), and "" for cameras it gives none. */
  counties: string[];
  cameras: CameraRow[];
  /** Images FL511 listed with no video feed when the list was fetched. Their stills are FL511's
   *  "No live camera feed at this time" picture. */
  noFeed: number[];
}

export interface Camera {
  id: number;
  lon: number;
  lat: number;
  road: string;
  dir: Direction;
  location: string;
  county: string;
  images: number[];
  /** Its images with no live feed: from the daily list, then from each still as it loads. */
  noFeed: number[];
}

/** What a water cam looks at. */
export type WebcamKind = "beach" | "pier" | "inlet" | "bay" | "river" | "lake" | "spring" | "marina" | "offshore" | "reef" | "marsh";

/** Something a water cam shows on this page: one public-domain picture or one YouTube stream. */
export interface WebcamView {
  label: string;
  /** A YouTube video id, played through youtube-nocookie.com. */
  youtube?: string;
  /** Its latest picture, from a public-domain source (USGS or NOAA; a data test checks the host). */
  picture?: string;
}

export interface Webcam {
  /** A slug of its name. */
  id: string;
  name: string;
  /** Who runs it. */
  by: string;
  kind: WebcamKind;
  lon: number;
  lat: number;
  /** Where its owner shows it. */
  page: string;
  /** What plays here. A cam without views only links to its page. */
  views?: WebcamView[];
  note?: string;
}

/** public/data/webcams.json: beach and water cams run by public bodies and nonprofits, picked by hand. */
export interface WebcamFile {
  /** When every cam was last checked (YYYY-MM-DD). */
  checked: string;
  cams: Webcam[];
}
