// Beach and water cams (public/data/webcams.json). A cam plays on the page only when its
// owner allows that: pictures from public-domain sources (USGS, NOAA), and YouTube streams
// run by public bodies and nonprofits, which YouTube lets anyone embed when the owner allows
// it. Every other cam links to its owner's page.

import type { Webcam, WebcamKind } from "./shared/types";

export const WEBCAM_KINDS: Record<WebcamKind, string> = {
  beach: "Beach cam",
  pier: "Pier cam",
  inlet: "Inlet cam",
  bay: "Bay cam",
  river: "River cam",
  lake: "Lake cam",
  spring: "Spring cam",
  marina: "Harbor cam",
  offshore: "Buoy cam",
  reef: "Reef cam",
  marsh: "Wetland cam",
};

/** Whether anything of the cam's plays on the page. */
export const playsHere = (w: Webcam) => (w.views?.length ?? 0) > 0;

/** "Siesta Beach (beach cam)", as the find box suggests it. */
export const webcamLabel = (w: Webcam) => `${w.name} (${WEBCAM_KINDS[w.kind].toLowerCase()})`;

/** YouTube's privacy-enhanced player, which sets no cookies until it plays. Opening a card is
 *  the tap that starts it, muted, as browsers allow. */
export const youtubeEmbed = (id: string) => `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=1&mute=1&playsinline=1&rel=0`;

/** The cams' pictures change every half hour or hour; a new URL every ten minutes gets past
 *  a browser's cached copy. */
export const pictureUrl = (url: string, now = Date.now()) => `${url}${url.includes("?") ? "&" : "?"}t=${Math.floor(now / 600_000)}`;
