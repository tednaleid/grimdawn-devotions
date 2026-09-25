// ABOUTME: Pure rules for the anonymous page-load counter, shared by the browser beacon and the worker.
// ABOUTME: Defines the page names, how a referrer is reduced to a domain label, and how a hit body is validated.

export const PAGE_NAMES = ["planner", "rr", "monsters", "items"] as const;
export type PageName = (typeof PAGE_NAMES)[number];

export function isPageName(v: unknown): v is PageName {
  return typeof v === "string" && (PAGE_NAMES as readonly string[]).includes(v);
}

/** A referrer label as stored: a hostname, or one of `direct`, `internal`, `other`. */
export const REFERRER_LABEL_RE = /^[a-z0-9.-]{1,253}$/;

/** Reduce `document.referrer` to a domain so no path, query, or build hash ever leaves the browser. */
export function referrerLabel(referrer: string, selfHost: string): string {
  if (!referrer) return "direct";
  let host: string;
  try {
    host = new URL(referrer).hostname.toLowerCase();
  } catch {
    return "other";
  }
  if (host === selfHost.toLowerCase()) return "internal";
  const label = host.startsWith("www.") ? host.slice(4) : host;
  return REFERRER_LABEL_RE.test(label) ? label : "other";
}

export interface PrivacySignals {
  globalPrivacyControl?: boolean;
  doNotTrack?: string | null;
}

/** True when the browser asks not to be tracked (Global Privacy Control or Do Not Track). */
export function privacySignalSet(s: PrivacySignals): boolean {
  return s.globalPrivacyControl === true || s.doNotTrack === "1";
}

export interface Hit {
  page: PageName;
  ref: string;
}

/** Null unless the body names a known page; a bad or missing `ref` degrades to `other`. */
export function parseHitBody(text: string): Hit | null {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof v !== "object" || v === null) return null;
  const { page, ref } = v as Record<string, unknown>;
  if (!isPageName(page)) return null;
  return { page, ref: typeof ref === "string" && REFERRER_LABEL_RE.test(ref) ? ref : "other" };
}
