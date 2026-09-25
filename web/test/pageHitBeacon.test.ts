// ABOUTME: Tests the page-load beacon: what it sends, where, and when it stays silent.
// ABOUTME: Browser globals are injected, so no DOM or network is needed.
import { test, expect } from "bun:test";
import { sendPageHit, type BeaconHost } from "../src/adapters/pageHitBeacon";

const API = "https://worker.example";

function fakeHost(overrides: Partial<BeaconHost["navigator"]> = {}, referrer = "") {
  const sent: { url: string; data: Blob }[] = [];
  const host: BeaconHost = {
    navigator: {
      sendBeacon: (url, data) => {
        sent.push({ url, data });
        return true;
      },
      ...overrides,
    },
    location: { hostname: "tednaleid.github.io" },
    document: { referrer },
  };
  return { host, sent };
}

test("sends one text/plain beacon to /hit with the page and referrer label", async () => {
  const { host, sent } = fakeHost({}, "https://www.reddit.com/r/Grimdawn/");
  sendPageHit("monsters", API, host);
  expect(sent.length).toBe(1);
  expect(sent[0]!.url).toBe(`${API}/hit`);
  expect(sent[0]!.data.type).toStartWith("text/plain");
  expect(JSON.parse(await sent[0]!.data.text())).toEqual({ page: "monsters", ref: "reddit.com" });
});

test("never sends the page URL or hash", async () => {
  const { host, sent } = fakeHost({}, "https://tednaleid.github.io/grimdawn-devotions/#s=secretbuild");
  sendPageHit("planner", API, host);
  const body = await sent[0]!.data.text();
  expect(body).not.toContain("secretbuild");
  expect(JSON.parse(body)).toEqual({ page: "planner", ref: "internal" });
});

test("stays silent under Global Privacy Control", () => {
  const { host, sent } = fakeHost({ globalPrivacyControl: true });
  sendPageHit("rr", API, host);
  expect(sent).toEqual([]);
});

test("stays silent under Do Not Track", () => {
  const { host, sent } = fakeHost({ doNotTrack: "1" });
  sendPageHit("rr", API, host);
  expect(sent).toEqual([]);
});

test("does nothing when sendBeacon is unavailable", () => {
  const { host } = fakeHost({ sendBeacon: undefined });
  expect(() => sendPageHit("items", API, host)).not.toThrow();
});

test("swallows a throwing sendBeacon", () => {
  const { host } = fakeHost({
    sendBeacon: () => {
      throw new TypeError("bad url");
    },
  });
  expect(() => sendPageHit("items", API, host)).not.toThrow();
});
