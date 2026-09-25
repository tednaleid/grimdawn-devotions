// ABOUTME: Sends one anonymous page-load hit to the worker's POST /hit when a page's document loads.
// ABOUTME: Fire-and-forget: silent under GPC/DNT, without sendBeacon, or on any error.
import { type PageName, privacySignalSet, referrerLabel } from "../core/pageHit";
import { workerApi } from "./workerApi";

export interface BeaconHost {
  navigator: {
    sendBeacon?: (url: string, data: Blob) => boolean;
    globalPrivacyControl?: boolean;
    doNotTrack?: string | null;
  };
  location: { hostname: string };
  document: { referrer: string };
}

/** Call once per document load, never on hash changes. A text/plain body keeps the beacon a CORS
 * simple request, so the browser sends no preflight. */
export function sendPageHit(
  page: PageName,
  api: string = workerApi,
  host: BeaconHost = globalThis as unknown as BeaconHost,
): void {
  try {
    const nav = host.navigator;
    if (!nav.sendBeacon || privacySignalSet(nav)) return;
    const ref = referrerLabel(host.document.referrer, host.location.hostname);
    nav.sendBeacon(`${api}/hit`, new Blob([JSON.stringify({ page, ref })], { type: "text/plain" }));
  } catch {
    // Counting must never affect the page.
  }
}
