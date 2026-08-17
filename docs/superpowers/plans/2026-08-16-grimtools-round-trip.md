# grimtools Round Trip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Export a copy of the associated grimtools build with the planner's devotions spliced in and everything else intact, and always show the associated build's title on the panel link.

**Architecture:** The base build is the `gt=` slug already in the hash. `POST /export` gains an optional `base: { slug, remove }`; the worker fetches the base page, runs the pure `spliceDevotions` from core (drop the named star entries, append the new stars, fix `bio.devotionPoints`, drop stale celestial-power bindings), and posts the result. The planner reads any associated build once per session through the gateway (import, load-time, or export), remembers title and skill list in a `builds` memo, computes `remove` from the base's skills and the star table, and renders the title as the link text with a tooltip.

**Tech Stack:** TypeScript, Bun (tests via `bun:test`), Cloudflare Worker (wrangler local dev), playwright-cli for the end-to-end gate, `just` for every command.

**Spec:** `docs/superpowers/specs/2026-08-16-grimtools-round-trip-design.md`

## Global Constraints

- Every user-facing string is a catalog key in all 13 `web/src/i18n/app.<locale>.json` files and in the `REQUIRED` list of `web/test/appCatalog.test.ts`; never a literal in app code.
- All planner state that a shared link must restore lives in the URL hash; the round trip adds no hash parameter (`gt=` is the base). A fetched build never changes the selection or the point cap; only Import does.
- The worker holds no game knowledge: it never decides which `sk` id is a devotion star. The only caller-controlled bytes that reach grimtools are validated `sk` ids and a slug.
- `POST /export` body stays at most 4096 bytes; `skills` is 1..55 distinct `^sk\d+$`; `base.remove` is 0..128 distinct `^sk\d+$`; `base.slug` passes `isSlug`.
- `EXPORT_CONTRACT_VERSION` becomes 2.
- Every code file starts with two `// ABOUTME:` lines. Comments are evergreen (no dates, no "now/currently", no history). No emojis or em dashes in docs.
- Match surrounding style; run `just fmt` before committing; `just check` (lint, format, typecheck, tests) must pass at every commit. Never `--no-verify`.
- The worktree's shell guard rejects heredocs, `eval`, and `$()`: write files with the Write/Edit tools, and use `git commit -m "..."`.

---

## File map

| File | Responsibility |
|---|---|
| `web/src/core/grimtools.ts` | `extractBuildInfo` returns `data`; new `spliceDevotions`; `EXPORT_CONTRACT_VERSION = 2` |
| `web/test/grimtools.test.ts` | core tests against `web/test/fixtures/grimtools-calc.html` (the real `qNYgbjeV` page) |
| `worker/src/index.ts` | `readCalcPage` shared by both routes; export body with `base`; base flow |
| `web/test/worker.test.ts` | worker tests |
| `worker/README.md` | export contract v2 |
| `web/src/ports/GrimtoolsGateway.ts` | `saveBuild(skills, base?)` |
| `web/src/adapters/grimtoolsWorkerGateway.ts` | body with `base`, `v=2` |
| `web/test/grimtoolsWorkerGateway.test.ts` | adapter tests |
| `web/src/adapters/importPanel.ts` | title as link text, `title` attribute, `base` error code |
| `web/test/importPanel.test.ts` | panel tests |
| `web/src/i18n/app.*.json`, `web/test/appCatalog.test.ts` | `ui.export.err.base` added, `ui.import.sourceTitled` removed |
| `web/src/app/main.ts` | `builds` memo, `readBuild`, `ensureSourceRead`, title on every repaint, export with base |
| `docs/grimtools-import.md`, `BACKLOG.md` | docs |

---

### Task 1: core: `extractBuildInfo` returns `data`; `spliceDevotions`; contract v2

**Files:**
- Modify: `web/src/core/grimtools.ts` (`extractBuildInfo` around line 110; `EXPORT_CONTRACT_VERSION` line 28; append `spliceDevotions` after `savePayload`)
- Test: `web/test/grimtools.test.ts`

**Interfaces:**
- Produces: `extractBuildInfo(html): { skillIds: string[]; gameVersion: string; data: unknown } | null`
- Produces: `spliceDevotions(data: unknown, remove: readonly string[], stars: readonly string[]): Record<string, unknown> | null`
- Produces: `EXPORT_CONTRACT_VERSION === 2`

Background for the fixture: `web/test/fixtures/grimtools-calc.html` is the real `qNYgbjeV` page. Its `data.skills` has 83 entries: 28 mastery skills and 55 devotion stars (all 55 are keys of `data/grimtools-stars.json`'s `stars`). Seven mastery skills carry `autoCastSkill` bindings to stars (`sk1126 -> sk699`, `sk1120 -> sk927`, `sk1139 -> sk2588`, `sk1277 -> sk963`, `sk1275 -> sk897`, `sk1282 -> sk2048`, `sk1290 -> sk843`), `itemSkills` is `[{ autoCastSkill: "sk891", name: "sk530", itemName: "it1499", itemSlot: 11 }]`, `transformSkills` is `[]`, `bio.devotionPoints` is `0`, `bio.physique` is `154`.

- [ ] **Step 1: Write the failing tests**

Add to the import list at the top of `web/test/grimtools.test.ts`: `spliceDevotions`. Append these tests at the end of the file:

```ts
const STARS = (realTable as { stars: Record<string, string> }).stars;

async function fixtureData(): Promise<Record<string, unknown>> {
  const html = await Bun.file("test/fixtures/grimtools-calc.html").text();
  return extractBuildInfo(html)!.data as Record<string, unknown>;
}
type Entry = { name: string; level: number; autoCastSkill?: string };

test("extractBuildInfo returns the whole data object alongside the skill ids", async () => {
  const data = await fixtureData();
  expect((data.bio as { physique: number }).physique).toBe(154);
  expect((data.skills as Entry[]).length).toBe(83);
  expect(Object.keys(data)).toContain("equipment");
});

test("spliceDevotions replaces every star with the new set, fixes devotionPoints, and drops every stale binding", async () => {
  const data = await fixtureData();
  const allStars = (data.skills as Entry[]).map((s) => s.name).filter((id) => id in STARS);
  expect(allStars.length).toBe(55);
  const out = spliceDevotions(data, allStars, ["sk739"])!;
  expect(out).not.toBeNull();
  const skills = out.skills as Entry[];
  expect(skills.length).toBe(29); // 28 mastery skills kept, one star added
  expect(skills[28]).toEqual({ name: "sk739", level: 1 });
  expect(skills.some((s) => s.name in STARS && s.name !== "sk739")).toBe(false);
  expect(skills.some((s) => "autoCastSkill" in s)).toBe(false);
  expect((out.bio as { devotionPoints: number }).devotionPoints).toBe(54); // 0 + 55 removed - 1 added
  expect(out.itemSkills).toEqual([]);
  expect(out.transformSkills).toEqual([]);
});

test("spliceDevotions passes every other field through unchanged, including the rest of bio and each kept entry", async () => {
  const data = await fixtureData();
  const out = spliceDevotions(data, ["sk699"], ["sk739"])!;
  const { skills: _s, bio: _b, itemSkills: _i, transformSkills: _t, ...rest } = data;
  const { skills: _s2, bio: _b2, itemSkills: _i2, transformSkills: _t2, ...restOut } = out;
  expect(restOut).toEqual(rest);
  const { devotionPoints: _d, ...bioRest } = data.bio as Record<string, unknown>;
  const { devotionPoints: _d2, ...bioRestOut } = out.bio as Record<string, unknown>;
  expect(bioRestOut).toEqual(bioRest);
  // Kept entries are the same objects' contents, in the same order, with one star gone and one appended.
  const before = (data.skills as Entry[]).filter((s) => s.name !== "sk699");
  const after = out.skills as Entry[];
  expect(after.length).toBe(before.length + 1);
  expect(after.slice(0, -1).map((s) => s.name)).toEqual(before.map((s) => s.name));
});

test("spliceDevotions strips only the binding whose star is removed and keeps the others", async () => {
  const data = await fixtureData();
  const out = spliceDevotions(data, ["sk699"], ["sk739"])!;
  const skills = out.skills as Entry[];
  const sk1126 = skills.find((s) => s.name === "sk1126")!;
  expect(sk1126.level).toBe(14);
  expect("autoCastSkill" in sk1126).toBe(false);
  expect(skills.find((s) => s.name === "sk1120")!.autoCastSkill).toBe("sk927");
  expect((out.itemSkills as unknown[]).length).toBe(1); // sk891 stays, so its item binding stays
  expect((out.bio as { devotionPoints: number }).devotionPoints).toBe(0); // 0 + 1 - 1
});

test("spliceDevotions drops an item binding and a transform binding whose star is removed", () => {
  const data = {
    bio: { devotionPoints: 3 },
    skills: [
      { name: "sk10", level: 5, autoCastSkill: "sk900" },
      { name: "sk900", level: 1 },
      { name: "sk901", level: 1 },
    ],
    itemSkills: [
      { autoCastSkill: "sk900", name: "sk20", itemName: "it1", itemSlot: 1 },
      { autoCastSkill: "sk901", name: "sk21", itemName: "it2", itemSlot: 2 },
    ],
    transformSkills: [{ autoCastSkill: "sk900", name: "sk10", mastery: "m", transformSkill: "sk30" }],
  };
  const out = spliceDevotions(data, ["sk900"], ["sk902"])!;
  expect(out.skills).toEqual([{ name: "sk10", level: 5 }, { name: "sk901", level: 1 }, { name: "sk902", level: 1 }]);
  expect(out.itemSkills).toEqual([{ autoCastSkill: "sk901", name: "sk21", itemName: "it2", itemSlot: 2 }]);
  expect(out.transformSkills).toEqual([]);
  expect((out.bio as { devotionPoints: number }).devotionPoints).toBe(3);
});

test("spliceDevotions keeps a binding whose star is removed and requested again, re-adding the star at level 1", () => {
  const data = {
    bio: { devotionPoints: 3 },
    skills: [{ name: "sk10", level: 5, autoCastSkill: "sk900" }, { name: "sk900", level: 1 }],
    itemSkills: [{ autoCastSkill: "sk900", name: "sk20", itemName: "it1", itemSlot: 1 }],
    transformSkills: [],
  };
  const out = spliceDevotions(data, ["sk900"], ["sk900"])!;
  expect(out.skills).toEqual([{ name: "sk10", level: 5, autoCastSkill: "sk900" }, { name: "sk900", level: 1 }]);
  expect((out.itemSkills as unknown[]).length).toBe(1);
  expect((out.bio as { devotionPoints: number }).devotionPoints).toBe(3);
});

test("spliceDevotions does not duplicate a requested star that is already kept, and floors devotionPoints at 0", () => {
  const data = { bio: { devotionPoints: 0 }, skills: [{ name: "sk900", level: 1 }] };
  const same = spliceDevotions(data, [], ["sk900"])!;
  expect(same.skills).toEqual([{ name: "sk900", level: 1 }]);
  expect((same.bio as { devotionPoints: number }).devotionPoints).toBe(0);
  const over = spliceDevotions(data, [], ["sk901", "sk902"])!;
  expect((over.skills as unknown[]).length).toBe(3);
  expect((over.bio as { devotionPoints: number }).devotionPoints).toBe(0); // 0 + 0 - 2, floored
});

test("spliceDevotions leaves absent itemSkills/transformSkills absent rather than inventing them", () => {
  const out = spliceDevotions({ bio: { devotionPoints: 54 }, skills: [{ name: "sk1", level: 1 }] }, ["sk1"], ["sk2"])!;
  expect(out.skills).toEqual([{ name: "sk2", level: 1 }]);
  expect("itemSkills" in out).toBe(false);
  expect("transformSkills" in out).toBe(false);
});

test("spliceDevotions returns null for anything it does not understand", () => {
  expect(spliceDevotions(null, [], ["sk1"])).toBeNull();
  expect(spliceDevotions([], [], ["sk1"])).toBeNull();
  expect(spliceDevotions({ bio: { devotionPoints: 1 } }, [], ["sk1"])).toBeNull(); // no skills
  expect(spliceDevotions({ bio: { devotionPoints: 1 }, skills: [{ name: "sk1" }] }, [], ["sk1"])).toBeNull(); // no level
  expect(spliceDevotions({ bio: { devotionPoints: 1 }, skills: [null] }, [], ["sk1"])).toBeNull();
  expect(spliceDevotions({ bio: {}, skills: [] }, [], ["sk1"])).toBeNull(); // no devotionPoints
  expect(spliceDevotions({ skills: [] }, [], ["sk1"])).toBeNull(); // no bio
  expect(spliceDevotions({ bio: { devotionPoints: 1 }, skills: [], itemSkills: "no" }, [], ["sk1"])).toBeNull();
});
```

Also replace the existing test `"the export contract version is a positive integer"` with:

```ts
test("the export contract version is 2: the body gained the optional base", () => {
  expect(EXPORT_CONTRACT_VERSION).toBe(2);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && bun test test/grimtools.test.ts`
Expected: FAIL (`spliceDevotions` is not exported; `data` missing; version is 1).

- [ ] **Step 3: Implement**

In `web/src/core/grimtools.ts`:

Change the `EXPORT_CONTRACT_VERSION` block to:

```ts
/**
 * Version of the worker's export contract (`POST /export` with `{ skills, base? }` -> `{ slug }`).
 * Export responses are never cached, so this only exists to keep the two routes symmetrical:
 * the app sends it as `?v=` and the response-shape guard in `web/test/worker.test.ts` pins the
 * field set against it. Bump on a rename or removal, not on an additive field.
 */
export const EXPORT_CONTRACT_VERSION = 2;
```

Change `extractBuildInfo`'s doc comment first sentence to "Pull the skill ids, game version and the whole `data` object out of a calculator page." and its signature and last lines to:

```ts
export function extractBuildInfo(html: string): { skillIds: string[]; gameVersion: string; data: unknown } | null {
  ...
  const doc = parsed as { data?: { skills?: { name?: unknown }[] }; created_for_build?: unknown };
  const skills = doc.data?.skills;
  if (!Array.isArray(skills)) return null;
  const skillIds = skills.map((s) => s?.name).filter((n): n is string => typeof n === "string");
  return {
    skillIds,
    gameVersion: typeof doc.created_for_build === "string" ? doc.created_for_build : "",
    data: doc.data,
  };
}
```

Append after `savePayload`:

```ts
/** A `data.skills` entry as far as the splice needs to read it; every other field rides along. */
type SkillEntry = { name: string; level: number; autoCastSkill?: unknown } & Record<string, unknown>;

function isSkillEntry(v: unknown): v is SkillEntry {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as { name?: unknown }).name === "string" &&
    typeof (v as { level?: unknown }).level === "number"
  );
}

/** The `autoCastSkill` of a bound entry (`itemSkills[]`, `transformSkills[]`), or undefined. */
function autoCastOf(v: unknown): unknown {
  return typeof v === "object" && v !== null ? (v as { autoCastSkill?: unknown }).autoCastSkill : undefined;
}

/**
 * A copy of a build's `data` with its devotions replaced: the `skills` entries named in `remove`
 * are dropped, each of `stars` not already present is appended at level 1, `bio.devotionPoints`
 * moves by the count actually removed and added (floored at 0), and every celestial-power binding
 * whose star is removed and not requested again goes with it: the `autoCastSkill` field comes off
 * the mastery skill's `skills[]` entry, and the `itemSkills[]`/`transformSkills[]` entries are
 * dropped outright, since grimtools serializes those two arrays from bindings alone. Bindings to
 * stars that stay are untouched, and every other field of `data` and of every entry is passed
 * through as grimtools wrote it.
 *
 * The worker cannot tell a star from a mastery skill; `remove` is the caller's statement of which
 * of the base's ids are stars. Returns null unless `data` has a `skills` array of `{ name, level }`
 * entries and a numeric `bio.devotionPoints` (`itemSkills`/`transformSkills` may be absent), so a
 * page we do not understand is a clean failure rather than a corrupted save.
 */
export function spliceDevotions(
  data: unknown,
  remove: readonly string[],
  stars: readonly string[],
): Record<string, unknown> | null {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  const doc = data as Record<string, unknown>;
  const skills = doc.skills;
  if (!Array.isArray(skills) || !skills.every(isSkillEntry)) return null;
  const bio = doc.bio;
  if (typeof bio !== "object" || bio === null || Array.isArray(bio)) return null;
  const devotionPoints = (bio as { devotionPoints?: unknown }).devotionPoints;
  if (typeof devotionPoints !== "number") return null;
  const bound: Record<string, unknown> = {};
  for (const key of ["itemSkills", "transformSkills"]) {
    if (doc[key] === undefined) continue;
    if (!Array.isArray(doc[key])) return null;
    bound[key] = doc[key];
  }

  const removeSet = new Set(remove);
  const wanted = new Set(stars);
  const stale = (id: unknown) => typeof id === "string" && removeSet.has(id) && !wanted.has(id);

  const kept = skills.filter((s) => !removeSet.has(s.name));
  const present = new Set(kept.map((s) => s.name));
  const added = stars.filter((s) => !present.has(s));
  const out: Record<string, unknown> = {
    ...doc,
    bio: { ...bio, devotionPoints: Math.max(0, devotionPoints + (skills.length - kept.length) - added.length) },
    skills: [
      ...kept.map((s) => {
        if (!stale(s.autoCastSkill)) return s;
        const { autoCastSkill: _dropped, ...rest } = s;
        return rest;
      }),
      ...added.map((name) => ({ name, level: 1 })),
    ],
  };
  for (const [key, list] of Object.entries(bound)) out[key] = (list as unknown[]).filter((e) => !stale(autoCastOf(e)));
  return out;
}
```

Also update the file's second ABOUTME line to end with `(invertStarTable, savePayload, spliceDevotions).`

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd web && bun test test/grimtools.test.ts`
Expected: PASS. Then `just typecheck` (the worker's `BuildInfoResult` derives from `extractBuildInfo`'s return type, so it should still compile).

- [ ] **Step 5: Format and commit**

```bash
just fmt
git add web/src/core/grimtools.ts web/test/grimtools.test.ts
git commit -m "feat(export): spliceDevotions and extractBuildInfo.data in core; export contract v2"
```

---

### Task 2: worker: `readCalcPage` shared by both routes; `POST /export` with `base`

**Files:**
- Modify: `worker/src/index.ts`
- Modify: `worker/README.md` (export contract paragraph, lines 26-35)
- Test: `web/test/worker.test.ts`

**Interfaces:**
- Consumes: `spliceDevotions`, `extractBuildInfo(...).data` from Task 1.
- Produces: `POST /export` accepts `{ skills, base?: { slug, remove } }`; with `base`, posts `spliceDevotions(basePage.data, remove, skills)`; without, `savePayload(skills)` as before.

- [ ] **Step 1: Write the failing tests**

Add to the imports at the top of `web/test/worker.test.ts`: `import { savePayload, spliceDevotions, extractBuildInfo } from "../src/core/grimtools";` (replacing the existing `savePayload` import line) and `import realTable from "../../data/grimtools-stars.json";`.

Append after the last export test in the file:

```ts
// --- POST /export with a base build ------------------------------------------------------------

const CALC_URL = "https://www.grimtools.com/calc/";
const STARS = (realTable as { stars: Record<string, string> }).stars;

/** Answers the base page for any calc URL and a saved id for the save URL, recording both. */
function baseFetch(basePage: string, saveStatus = 200) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    if (String(url).startsWith(CALC_URL)) return new Response(basePage, { status: 200 });
    if (String(url) === SAVE_URL) return new Response('{"id":"2ga0aJyZ"}', { status: saveStatus });
    return new Response("", { status: 404 });
  }) as never;
  return { f, calls };
}

test("export with a base: the base page is fetched, its stars replaced, and the spliced data posted", async () => {
  const html = await Bun.file("test/fixtures/grimtools-calc.html").text();
  const data = extractBuildInfo(html)!.data as { skills: { name: string }[]; equipment: unknown };
  const remove = data.skills.map((s) => s.name).filter((id) => id in STARS);
  expect(remove.length).toBe(55);
  const { f, calls } = baseFetch(html);
  const res = await handleRequest(exportRequest({ skills: ["sk739"], base: { slug: "qNYgbjeV", remove } }), exportEnv(f));
  expect(res.status).toBe(201);
  expect(await res.json()).toEqual({ slug: "2ga0aJyZ" });

  const pageCall = calls.find((c) => c.url.startsWith(CALC_URL))!;
  expect(pageCall.url).toBe(`${CALC_URL}qNYgbjeV`);
  expect(pageCall.init?.redirect).toBe("manual");
  expect(new Headers(pageCall.init?.headers).get("User-Agent")).toContain("grimdawn-devotions");

  const save = calls.find((c) => c.url === SAVE_URL)!;
  const form = new URLSearchParams(String(save.init?.body));
  expect(form.get("mod")).toBe("");
  const posted = JSON.parse(form.get("data")!);
  expect(posted).toEqual(spliceDevotions(data, remove, ["sk739"]));
  expect(posted.equipment).toEqual(data.equipment);
  expect(posted.skills.length).toBe(29);
  expect(posted.skills.at(-1)).toEqual({ name: "sk739", level: 1 });
  expect(posted.bio.devotionPoints).toBe(54);
});

test("export with a base: an empty remove list is accepted and only appends", async () => {
  const html = await Bun.file("test/fixtures/grimtools-calc.html").text();
  const { f, calls } = baseFetch(html);
  const res = await handleRequest(exportRequest({ skills: ["sk739"], base: { slug: "qNYgbjeV", remove: [] } }), exportEnv(f));
  expect(res.status).toBe(201);
  const form = new URLSearchParams(String(calls.find((c) => c.url === SAVE_URL)!.init?.body));
  const posted = JSON.parse(form.get("data")!);
  expect(posted.skills.length).toBe(84);
  expect(posted.bio.devotionPoints).toBe(0); // 0 + 0 - 1, floored
});

test("export with a base: a base that is 404, a null build, or unreachable is 502 upstream and nothing is saved", async () => {
  const cases: (() => Response | Promise<Response>)[] = [
    () => new Response("nope", { status: 404 }),
    () => new Response(`<script>window['buildInfo'] = null;</script>`, { status: 200 }),
    () => new Response("", { status: 302, headers: { Location: "https://elsewhere.example/" } }),
    () => {
      throw new TypeError("offline");
    },
  ];
  for (const respond of cases) {
    const calls: string[] = [];
    const f = (async (url: string) => {
      calls.push(String(url));
      if (String(url).startsWith(CALC_URL)) return respond();
      return new Response('{"id":"2ga0aJyZ"}', { status: 200 });
    }) as never;
    const res = await handleRequest(
      exportRequest({ skills: ["sk739"], base: { slug: "qNYgbjeV", remove: ["sk688"] } }),
      exportEnv(f),
    );
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "upstream" });
    expect(calls).not.toContain(SAVE_URL);
  }
});

test("export with a base: a base page whose data cannot be spliced is 502 unparseable and nothing is saved", async () => {
  const pages = [
    `<script>window['buildInfo'] = {"data":{"skills":[{"name":"sk688","level":1}]},"created_for_build":"1.2.1.6"};</script>`, // no bio
    `<script>window['buildInfo'] = {"data":{"bio":{"devotionPoints":1},"skills":[{"name":"sk688"}]}};</script>`, // no level
    `<html>nothing here</html>`,
  ];
  for (const page of pages) {
    const { f, calls } = baseFetch(page);
    const res = await handleRequest(
      exportRequest({ skills: ["sk739"], base: { slug: "qNYgbjeV", remove: [] } }),
      exportEnv(f),
    );
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "unparseable" });
    expect(calls.some((c) => c.url === SAVE_URL)).toBe(false);
  }
});

test("export with a base: every malformed base is 400 and nothing is fetched at all", async () => {
  const calls: string[] = [];
  const spy = (async (url: string) => {
    calls.push(String(url));
    return new Response("", { status: 200 });
  }) as never;
  const bad: unknown[] = [
    "qNYgbjeV",
    { slug: "not a slug!", remove: [] },
    { slug: "qNYgbjeV" },
    { slug: "qNYgbjeV", remove: "sk1" },
    { slug: "qNYgbjeV", remove: ["nope"] },
    { slug: "qNYgbjeV", remove: ["sk1", "sk1"] },
    { slug: "qNYgbjeV", remove: Array.from({ length: 129 }, (_, i) => `sk${i + 1}`) },
    { remove: [] },
  ];
  for (const base of bad) {
    const res = await handleRequest(exportRequest({ skills: ["sk739"], base }), exportEnv(spy));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad_request" });
  }
  expect(calls).toEqual([]);
});

test("export with a base: 128 distinct remove ids are accepted", async () => {
  const html = await Bun.file("test/fixtures/grimtools-calc.html").text();
  const { f } = baseFetch(html);
  const remove = Array.from({ length: 128 }, (_, i) => `sk${i + 1}`);
  const res = await handleRequest(exportRequest({ skills: ["sk739"], base: { slug: "qNYgbjeV", remove } }), exportEnv(f));
  expect(res.status).toBe(201);
});

test("export with a base: a refused rate limit never fetches the base page", async () => {
  const calls: string[] = [];
  const spy = (async (url: string) => {
    calls.push(String(url));
    return new Response("", { status: 200 });
  }) as never;
  const env = exportEnv(spy, { EXPORT_LIMITER_IP: fakeLimiter(0) });
  const res = await handleRequest(
    exportRequest({ skills: ["sk739"], base: { slug: "qNYgbjeV", remove: [] } }, { ip: "203.0.113.9" }),
    env,
  );
  expect(res.status).toBe(429);
  expect(calls).toEqual([]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && bun test test/worker.test.ts`
Expected: the new tests FAIL (the base is ignored, so the happy path posts `savePayload` and the 400 cases return 201).

- [ ] **Step 3: Implement**

In `worker/src/index.ts`:

1. Second ABOUTME line: `// ABOUTME: slug (GET /) and saves a selection as a fresh build or a copy of a base build (POST /export). Never fetches a caller-named host.`

2. Import list: add `spliceDevotions` from `../../web/src/core/grimtools`.

3. Constants: after `MAX_EXPORT_SKILLS` add
```ts
const MAX_BASE_REMOVE = 128; // a base's star entries (normally at most 55); loose so an odd hand-built page is not refused misleadingly
```

4. Replace `parseExportBody` and its doc comment with:

```ts
/** `min`..`max` distinct `sk<digits>` strings, or null. */
function skillIdList(v: unknown, min: number, max: number): string[] | null {
  if (!Array.isArray(v) || v.length < min || v.length > max) return null;
  if (!v.every((s) => typeof s === "string" && SKILL_ID_RE.test(s))) return null;
  if (new Set(v).size !== v.length) return null;
  return v as string[];
}

/** The parsed export body. `base` names the build to copy and which of its skill ids are the
 * devotion stars to replace; absent means a fresh devotions-only build. */
interface ExportBody {
  skills: string[];
  base?: { slug: string; remove: string[] };
}

/** The export body: 1..MAX_EXPORT_SKILLS distinct `sk<digits>` strings under `skills`, plus an
 * optional `base` of `{ slug, remove }` where `remove` is 0..MAX_BASE_REMOVE distinct ids; other
 * top-level keys are ignored. The worker cannot tell a devotion star from a mastery skill (same as
 * import); this bound plus the rate limit is the protection. */
function parseExportBody(text: string): ExportBody | null {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) return null;
  const { skills: rawSkills, base } = doc as { skills?: unknown; base?: unknown };
  const skills = skillIdList(rawSkills, 1, MAX_EXPORT_SKILLS);
  if (!skills) return null;
  if (base === undefined) return { skills };
  if (typeof base !== "object" || base === null || Array.isArray(base)) return null;
  const { slug, remove } = base as { slug?: unknown; remove?: unknown };
  if (typeof slug !== "string" || !isSlug(slug)) return null;
  const removeIds = skillIdList(remove, 0, MAX_BASE_REMOVE);
  if (!removeIds) return null;
  return { skills, base: { slug, remove: removeIds } };
}
```

5. Add directly after `readBuildInfo` (which sits below `handleExport`; function declarations hoist, so no reordering is needed and the diff stays small):

```ts
/** How reading `CALC + slug` ends, for both routes: the page's own verdict (`readBuildInfo`), a
 * real HTTP 404 (grimtools serves one only for a request shape it does not recognize at all; an
 * unknown-but-plausible slug is a 200 with `buildInfo = null`, which is `missing`), or an upstream
 * failure: a non-ok status, a refused redirect, a network error or the timeout. */
type CalcPageResult = BuildInfoResult | { kind: "notFound" } | { kind: "upstream"; status?: number };

/** Fetch a calc page by slug and read its buildInfo. `fetchOpts` carries the caller's user agent,
 * timeout signal and `redirect: "manual"`; the URL is built from the constant CALC and the slug,
 * so this never names a caller-supplied host. Never throws. */
async function readCalcPage(slug: string, doFetch: typeof fetch, fetchOpts: RequestInit): Promise<CalcPageResult> {
  try {
    const page = await doFetch(`${CALC}${slug}`, fetchOpts);
    if (page.status === 404) return { kind: "notFound" };
    if (!page.ok) return { kind: "upstream", status: page.status };
    return await readBuildInfo(page);
  } catch {
    // Covers a network failure and the timeout firing mid-fetch or mid-read, so every failure path
    // still returns our structured JSON (with CORS headers) rather than an uncaught exception
    // reaching the caller with no Access-Control-Allow-Origin at all.
    return { kind: "upstream" };
  }
}
```

6. In `handleExport`, replace from `const text = await boundedBody(...)` through the `form` construction with:

```ts
  const text = await boundedBody(request, MAX_EXPORT_BODY);
  const body = text === null ? null : parseExportBody(text);
  if (!body) return json({ error: "bad_request" }, 400, origin);
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  if (!(await allowed(env.EXPORT_LIMITER_IP, `ip:${ip}`)) || !(await allowed(env.EXPORT_LIMITER_GLOBAL, "global")))
    return json({ error: "rate_limited" }, 429, origin);

  // With a base, the saved character is grimtools' own data read back from grimtools with only the
  // devotions replaced; without one it is the bare level-100 character. Either way the caller's
  // bytes in it are validated ids.
  let data: unknown;
  if (body.base) {
    const page = await readCalcPage(body.base.slug, doFetch, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: "manual",
    });
    // The planner confirmed the base moments before, so a missing base here is a race, not a user
    // state worth its own code: it reports as the upstream failure it is.
    if (page.kind === "notFound" || page.kind === "missing" || page.kind === "upstream")
      return json({ error: "upstream" }, 502, origin);
    if (page.kind === "unparseable") return json({ error: "unparseable" }, 502, origin);
    data = spliceDevotions(page.info.data, body.base.remove, body.skills);
    if (data === null) return json({ error: "unparseable" }, 502, origin);
  } else {
    data = savePayload(body.skills);
  }

  const form = new URLSearchParams({ data: JSON.stringify(data), mod: "" });
```

Update `handleExport`'s doc comment to: "Save a devotion selection as a new anonymous grimtools build and return its slug: either a fresh character holding only the stars, or a copy of a base build with its stars replaced. One POST to a constant URL, in the exact shape the calculator's own Share button sends (see savePayload and spliceDevotions); the only caller-controlled bytes are the validated skill ids and, with a base, the slug of the page read back from grimtools."

7. In `handleRequest`'s import branch, replace the block from `let result: BuildInfoResult;` through `if (result.kind === "unparseable") ...` with:

```ts
  const result = await readCalcPage(slug, doFetch, fetchOpts);
  if (result.kind === "notFound" || result.kind === "missing") return json({ error: "not_found" }, 404, origin);
  if (result.kind === "upstream")
    return json(result.status === undefined ? { error: "upstream" } : { error: "upstream", status: result.status }, 502, origin);
  if (result.kind === "unparseable") return json({ error: "unparseable" }, 502, origin);
```

Keep the `signal`/`fetchOpts` declarations above it as they are (the devotion.json fetch still shares them). Move the two comments that were on the removed lines ("grimtools serves a real 404 only for..." and "Covers a network failure...") into `readCalcPage`'s comments as shown above rather than leaving them stranded.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd web && bun test test/worker.test.ts`
Expected: PASS, including every pre-existing import and export test (the refactor must not change any response body).

- [ ] **Step 5: Update `worker/README.md`**

Replace the "Export contract" paragraph with:

```
Export contract: `POST /export?v=<contract version>` with JSON body
`{ skills: ["sk739", ...], base?: { slug, remove: ["sk699", ...] } }` (`skills` 1 to 55
distinct `sk<digits>` ids, `remove` 0 to 128 distinct ids, `slug` in the slug charset, at
most 4 KB, `Origin` equal to `ALLOWED_ORIGIN`) returns `201 { slug }`. Without `base` the
worker posts a fresh level-100 character holding exactly `skills`, in the shape the
calculator's own Share button uses (`savePayload` in `web/src/core/grimtools.ts`). With
`base` it reads that build's page, drops the `skills` entries named in `remove` (the
planner's statement of which of the base's ids are devotion stars; the worker cannot tell),
appends `skills`, fixes `bio.devotionPoints`, drops celestial-power bindings to removed
stars, and posts everything else exactly as grimtools wrote it (`spliceDevotions`, same
file). Errors: `400 bad_request`, `403 forbidden`, `429 rate_limited`, `502 upstream`
(grimtools failed, redirected, or timed out, for the save or for the base page) or
`502 unparseable` (grimtools answered without a valid id, or the base page could not be
read or spliced). Never cached. Rate limits are the two `[[ratelimits]]` bindings in
`wrangler.toml` (per address and global); `wrangler dev --local` simulates them, and the
handler treats an absent binding as unlimited so tests need no runtime.
```

And in "Slug, never a URL", change the last sentence to: "The export route is the same: the save URL is a constant, a base is named by slug and fetched from the same constant host, and the only caller-controlled bytes are validated skill ids inside the JSON `data` field."

- [ ] **Step 6: Format, check, commit**

```bash
just fmt
just check
git add worker/src/index.ts worker/README.md web/test/worker.test.ts
git commit -m "feat(worker): POST /export copies a base build with its devotions replaced"
```

---

### Task 3: port and gateway adapter: `saveBuild(skills, base?)`

**Files:**
- Modify: `web/src/ports/GrimtoolsGateway.ts`
- Modify: `web/src/adapters/grimtoolsWorkerGateway.ts`
- Test: `web/test/grimtoolsWorkerGateway.test.ts`

**Interfaces:**
- Produces: `saveBuild(skills: string[], base?: { slug: string; remove: string[] }): Promise<SaveBuildResult>`; body `{ skills }` or `{ skills, base }`; URL `/export?v=2`.

- [ ] **Step 1: Write the failing tests**

Add to `web/test/grimtoolsWorkerGateway.test.ts` after the existing `saveBuild POSTs JSON...` test:

```ts
test("saveBuild without a base sends no base key at all", async () => {
  const { f, calls } = fakeFetch(() => jsonRes({ slug: "2ga0aJyZ" }, 201));
  await makeWorkerGateway(BASE, f).saveBuild(["sk739"]);
  expect(Object.keys(JSON.parse(String(calls[0]!.init?.body)))).toEqual(["skills"]);
});

test("saveBuild with a base puts it in the body beside the skills", async () => {
  const { f, calls } = fakeFetch(() => jsonRes({ slug: "2d1W1Q8V" }, 201));
  const r = await makeWorkerGateway(BASE, f).saveBuild(["sk739"], { slug: "qNYgbjeV", remove: ["sk699", "sk927"] });
  expect(r).toEqual({ kind: "ok", slug: "2d1W1Q8V" });
  expect(calls[0]!.url).toBe(`${BASE}/export?v=${EXPORT_CONTRACT_VERSION}`);
  expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({
    skills: ["sk739"],
    base: { slug: "qNYgbjeV", remove: ["sk699", "sk927"] },
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && bun test test/grimtoolsWorkerGateway.test.ts`
Expected: the "with a base" test FAILS (typecheck error on the second argument, or body lacks `base`).

- [ ] **Step 3: Implement**

`web/src/ports/GrimtoolsGateway.ts`: change the interface to

```ts
/** The build an export copies: `slug` names it, `remove` lists which of its skill ids are the
 * devotion stars to replace (the worker cannot tell them apart; the planner can, via the table). */
export interface ExportBase {
  slug: string;
  remove: string[];
}

export interface GrimtoolsGateway {
  fetchBuild(slug: string): Promise<FetchBuildResult>;
  /** `skills` are grimtools `sk` ids (see toGrimtoolsSkills), never our star ids. With `base` the
   * saved build is a copy of that build with only its devotions replaced; without, a fresh
   * devotions-only character. */
  saveBuild(skills: string[], base?: ExportBase): Promise<SaveBuildResult>;
}
```

and update the file's ABOUTME lines: `// ABOUTME: read a build's skill ids by slug, and save a devotion selection as a fresh build or a copy of a base.`

`web/src/adapters/grimtoolsWorkerGateway.ts`: import `ExportBase` from the port and change `saveBuild`:

```ts
    async saveBuild(skills: string[], base?: ExportBase): Promise<SaveBuildResult> {
      let res: Response;
      try {
        res = await fetchImpl(`${baseUrl}/export?v=${EXPORT_CONTRACT_VERSION}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(base ? { skills, base } : { skills }),
        });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd web && bun test test/grimtoolsWorkerGateway.test.ts` then `just typecheck`.
Expected: PASS.

- [ ] **Step 5: Format and commit**

```bash
just fmt
git add web/src/ports/GrimtoolsGateway.ts web/src/adapters/grimtoolsWorkerGateway.ts web/test/grimtoolsWorkerGateway.test.ts
git commit -m "feat(export): gateway saveBuild takes an optional base build"
```

---

### Task 4: panel: title as link text with tooltip; `base` error; catalog

**Files:**
- Modify: `web/src/adapters/importPanel.ts` (types line 19; `paint()` done branch around lines 96-104)
- Modify: `web/src/i18n/app.{cs,de,en,es,fr,it,ja,ko,pl,pt,ru,vi,zh}.json`
- Modify: `web/test/appCatalog.test.ts` (`REQUIRED`, lines 136-152)
- Test: `web/test/importPanel.test.ts`

**Interfaces:**
- Produces: `ExportErrorCode = "rateLimited" | "network" | "upstream" | "base"`; a `done` state renders `title` as the link's text (HTML-escaped into `innerHTML`, as before) and as its `title` attribute; with no title the text is `ui.import.source` and the attribute is removed.

- [ ] **Step 1: Write the failing tests**

In `web/test/importPanel.test.ts`, add `removeAttribute(k: string) { this.attrs.delete(k); }` to `FakeElement` beside `setAttribute`. Replace the three title tests (`a done state with a title renders it via the titled source string`, `a done state with no title ... falls back`, `a done state with title explicitly null falls back`) and the markup-escaping test with:

```ts
test("a done state with a title renders the title itself as the link text, with no prefix, and as the tooltip", () => {
  const { kids, handle } = mount();
  handle.setState({ kind: "done", slug: "qNYgbjeV", title: "Warder, Level 100 (GD 1.2.1.6)" });
  expect(kids["#import-source"].innerHTML).toBe("Warder, Level 100 (GD 1.2.1.6)");
  expect(kids["#import-source"].getAttribute("title")).toBe("Warder, Level 100 (GD 1.2.1.6)");
});

test("a done state with no title (absent, e.g. a pre-title cached worker response) falls back to the untitled source string and no tooltip", () => {
  const { kids, handle } = mount();
  handle.setState({ kind: "done", slug: "qNYgbjeV", title: "Warder" });
  handle.setState({ kind: "done", slug: "qNYgbjeV" });
  expect(kids["#import-source"].innerHTML).toBe(enLoc.translate("ui.import.source"));
  expect(kids["#import-source"].getAttribute("title")).toBeNull();
});

test("a done state with title explicitly null falls back the same as an absent title", () => {
  const { kids, handle } = mount();
  handle.setState({ kind: "done", slug: "qNYgbjeV", title: null });
  expect(kids["#import-source"].innerHTML).toBe(enLoc.translate("ui.import.source"));
  expect(kids["#import-source"].getAttribute("title")).toBeNull();
});

test("a title containing markup is HTML-escaped in the link text, not passed through as live tags", () => {
  const { kids, handle } = mount();
  handle.setState({ kind: "done", slug: "qNYgbjeV", title: '<script>alert(1)</script> & "quoted"' });
  const rendered = kids["#import-source"].innerHTML;
  expect(rendered).not.toContain("<script>");
  expect(rendered).toBe("&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;quoted&quot;");
  // An attribute value is inert text, so the tooltip carries the title as-is.
  expect(kids["#import-source"].getAttribute("title")).toBe('<script>alert(1)</script> & "quoted"');
});
```

Add beside the other export-state tests:

```ts
test("the base error state renders its message", () => {
  const { kids, handle } = mount();
  handle.setExportState({ kind: "error", code: "base" });
  expect(kids["#export-msg"].innerHTML).toBe(enLoc.translate("ui.export.err.base"));
  expect(kids["#export-go"].disabled).toBe(false);
});
```

In `web/test/appCatalog.test.ts` `REQUIRED`: remove `"ui.import.sourceTitled",` and add `"ui.export.err.base",` after `"ui.export.err.upstream",`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && bun test test/importPanel.test.ts test/appCatalog.test.ts`
Expected: FAIL (prefix still rendered; no `title` attribute; `ui.export.err.base` missing).

- [ ] **Step 3: Implement**

`web/src/adapters/importPanel.ts`:

```ts
export type ExportErrorCode = "rateLimited" | "network" | "upstream" | "base";
```

In `paint()`'s `done` branch replace the `source.innerHTML = ...` statement (and its comment) with:

```ts
      // title is upstream content relayed through the worker; escape it before it enters this
      // innerHTML string. The slug above needs no escaping - parseSlug's charset already
      // guarantees it, so it is never attacker-influenced text. The tooltip carries the full
      // title for when the CSS truncates the label; an attribute value is inert text.
      source.innerHTML = state.title ? escapeHtml(state.title) : localization.translate("ui.import.source");
      if (state.title) source.setAttribute("title", state.title);
      else source.removeAttribute("title");
```

Catalog: in every `web/src/i18n/app.<locale>.json` delete the `"ui.import.sourceTitled"` line and add `"ui.export.err.base"` directly after `"ui.export.err.upstream"` (mind the trailing comma on the previous last line):

| locale | value |
|---|---|
| en | `The source build could not be read. Clear it (✕) to export a fresh build.` |
| cs | `Zdrojový build se nepodařilo načíst. Zrušte ho (✕) a exportujte nový build.` |
| de | `Der Quell-Build konnte nicht gelesen werden. Entferne ihn (✕), um einen neuen Build zu exportieren.` |
| es | `No se pudo leer el build de origen. Quítalo (✕) para exportar un build nuevo.` |
| fr | `Impossible de lire le build source. Retirez-le (✕) pour exporter un nouveau build.` |
| it | `Impossibile leggere la build di origine. Rimuovila (✕) per esportare una nuova build.` |
| ja | `元のビルドを読み込めませんでした。解除（✕）すると新しいビルドとしてエクスポートできます。` |
| ko | `원본 빌드를 읽을 수 없습니다. 해제(✕)하면 새 빌드로 내보낼 수 있습니다.` |
| pl | `Nie udało się odczytać builda źródłowego. Usuń go (✕), aby wyeksportować nowy build.` |
| pt | `Não foi possível ler a build de origem. Remova-a (✕) para exportar uma build nova.` |
| ru | `Не удалось прочитать исходный билд. Уберите его (✕), чтобы экспортировать новый билд.` |
| vi | `Không đọc được bản dựng gốc. Bỏ liên kết (✕) để xuất một bản dựng mới.` |
| zh | `无法读取源构筑。清除它（✕）后可导出一个新构筑。` |

Then `grep -rn "sourceTitled" web/ docs/ worker/` must return nothing outside git history (fix any straggler in the same commit).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd web && bun test test/importPanel.test.ts test/appCatalog.test.ts test/i18nBoundary.test.ts`
Expected: PASS.

- [ ] **Step 5: Format, check, commit**

```bash
just fmt
just check
git add web/src/adapters/importPanel.ts web/test/importPanel.test.ts web/test/appCatalog.test.ts web/src/i18n/
git commit -m "feat(export): show the build title plainly with a tooltip; base error message"
```

---

### Task 5: planner controller: builds memo, load-time read, export with a base

**Files:**
- Modify: `web/src/app/main.ts` (imports; the memo block around lines 931-962; `refresh` re-association around line 820-828; `runImport` 964-1011; `runExport` 1013-1071; `syncImportPanel` 1080-1084)

**Interfaces:**
- Consumes: `spliceDevotions` is not used here; `saveBuild(skills, base?)` from Task 3; `ExportErrorCode "base"` from Task 4; `mapStars`, `StarTable` already imported.
- Produces: no new exports (`main.ts` is the composition root).

There is no unit harness for `main.ts` (see the earlier plan and BACKLOG); this task is verified by `just typecheck`, `just check`, and the end-to-end gate in Task 6. Read the existing memo/export block once before editing so the new code matches its comment style.

- [ ] **Step 1: Add the builds memo and `readBuild`**

Import `FetchBuildResult` as a type from `../ports/GrimtoolsGateway` (beside the existing gateway import). Directly after the `knownBuilds`/`selectionKey` declarations add:

```ts
  // Every build read this session, by slug: the gateway's answer as received (`skills` mixes
  // devotion stars and mastery skills, in grimtools' `sk` ids). It supplies the link's title on
  // every repaint and the base an export copies from. Never the selection: only import applies a
  // build's stars to the planner.
  type KnownBuild = { title: string | null; skills: string[]; dataVersion: string | null };
  const builds = new Map<string, KnownBuild>();

  // Read a build through the gateway once per session and remember it. Its full star set is
  // memoized under its key (see knownBuilds) whenever the table can be trusted for it, because
  // "this exact set is that build" holds whether or not the planner could show it unpruned; a
  // data-version mismatch keeps the title (display only) and skips the memo. Errors are not
  // remembered, so a later read retries.
  async function readBuild(slug: string): Promise<FetchBuildResult> {
    const known = builds.get(slug);
    if (known) return { kind: "ok", ...known };
    const result = await gateway.fetchBuild(slug);
    if (result.kind !== "ok") return result;
    builds.set(slug, { title: result.title, skills: result.skills, dataVersion: result.dataVersion });
    const table = await loadStarTable();
    if (table && (!result.dataVersion || result.dataVersion === tableDataVersion)) {
      const stars = mapStars(result.skills, table);
      if (stars.length) knownBuilds.set(selectionKey(new Set(stars)), slug);
    }
    return result;
  }
```

Note `loadStarTable` and `tableDataVersion` are declared above this block; `knownBuilds` and `selectionKey` are the existing declarations.

- [ ] **Step 2: Route import through `readBuild` and drop its own memo line**

In `runImport`, change `const result = await gateway.fetchBuild(slug);` to `const result = await readBuild(slug);` and delete the two lines

```ts
    // A pruned import is a build the planner does not show as grimtools does, so it is not memoized;
    // Export stays offered for it.
    if (pruned === 0) knownBuilds.set(selectionKey(state.selected), slug);
```

(readBuild memoizes the build's full set; a clean import's `state.selected` is that set, and a pruned import's is not, so the export state comes out the same as before.) Update the `knownBuilds` comment above `const knownBuilds` to say "Star sets behind builds this session read (import, the load-time read, export), keyed by selectionKey, ..." instead of "imported cleanly or exported".

- [ ] **Step 3: Title on every repaint, and the load-time read**

Replace `syncImportPanel` with:

```ts
  // The panel's view of `source`: the link with the build's title when this session has read it,
  // else the untitled fallback.
  function sourceState(): ImportState {
    return source ? { kind: "done", slug: source, title: builds.get(source)?.title ?? null } : { kind: "idle" };
  }
  // A hash-restored or freshly exported gt= is a slug the session may never have read: fetch it
  // in the background for its title (and memo entry) and repaint if it is still the association
  // when the answer lands. Only a success repaints, so a failing read cannot loop; the fallback
  // label simply stays. Never touches the selection.
  const reading = new Set<string>();
  function ensureSourceRead(): void {
    const slug = source;
    if (!slug || builds.has(slug) || reading.has(slug)) return;
    reading.add(slug);
    void readBuild(slug)
      .finally(() => reading.delete(slug))
      .then((r) => {
        if (r.kind === "ok" && source === slug) syncImportPanel();
      });
  }
  // Reflects `source` and the export state into the panel: at mount, on every hashchange, on the
  // clear path, and around an export request. A plain refresh pushes only the export state, so
  // rendering never resets what the import half is showing.
  function syncImportPanel(): void {
    importPanel.setState(sourceState());
    importPanel.setExportState(exportStateFor());
    ensureSourceRead();
  }
  syncImportPanel();
```

Import `ImportState` as a type from `../adapters/importPanel` if it is not already imported. In `refresh`'s re-association branch change `importPanel.setState({ kind: "done", slug: source });` to `importPanel.setState(sourceState());` followed by `ensureSourceRead();` (an exported slug is memoized without a title until read).

- [ ] **Step 4: Export with a base**

In `runExport`, right after `const selected = new Set(state.selected);` add `const baseSlug = source; // the base is pinned with the selection: what was on screen when Export was pressed`. Then, after the `const skills = toGrimtoolsSkills(selected, inverseTable); if (!skills) {...}` block and before `const result = await gateway.saveBuild(skills);`, add:

```ts
      // With an associated build, the export is a copy of it with these devotions: read it (usually
      // from the memo) to learn which of its ids are stars to replace. Only the table decides that.
      let base: ExportBase | undefined;
      if (baseSlug) {
        const b = await readBuild(baseSlug);
        if (b.kind === "notFound") {
          exportError = { key, code: "base" };
          return;
        }
        if (b.kind === "network") {
          exportError = { key, code: "network" };
          return;
        }
        if (b.dataVersion && b.dataVersion !== tableDataVersion) {
          // Its ids cannot be trusted against this table, the same rule import applies.
          exportError = { key, code: "base" };
          return;
        }
        base = { slug: baseSlug, remove: [...new Set(b.skills.filter((id) => starIdTable[id] !== undefined))] };
      }
      const result = await gateway.saveBuild(skills, base);
```

Import `ExportBase` as a type from `../ports/GrimtoolsGateway`. The rest of `runExport` is unchanged; on success `source = result.slug` and the trailing `syncImportPanel()` (via `ensureSourceRead`) fetches the new build's title.

- [ ] **Step 5: Typecheck, full check**

Run: `just typecheck` then `just check`.
Expected: clean. If `just check` flags an unused import or a lint issue, fix it in place.

- [ ] **Step 6: Format and commit**

```bash
just fmt
git add web/src/app/main.ts
git commit -m "feat(export): copy the associated build on export; read it at load for its title and memo"
```

---

### Task 6: end-to-end verification against the local stack (manual gate)

**Files:** none committed unless a defect is found (then fix in the owning file with a test, and commit as `fix(export): ...`).

Prerequisites: `just worker-dev` (port 8787) and `just serve` (port 5173) may already be running from the controller's session; check with `lsof -nP -iTCP:8787 -iTCP:5173 -sTCP:LISTEN`. If both listen, run only `just build` (the serve process serves `web/dist` in place, and wrangler reloads the worker on source change). If not, start them in the background (`just worker-dev`, `just serve`), each with output redirected to a scratchpad log. `worker/.dev.vars` must contain `ALLOWED_ORIGIN=http://localhost:5173` (it exists in this worktree). Use `playwright-cli` (see the skill) with a fresh session; use `run-code --filename=<file>` for anything needing a script, since the shell guard blocks heredocs and `$()`.

- [ ] **Step 1: Import the full build and check the title**

`playwright-cli open http://localhost:5173/#gt=qNYgbjeV` and take a snapshot. Expected: within a couple of seconds the panel's link text becomes `Warder, Level 100 (GD 1.2.1.6)` (no "grimtools:" prefix), the link's `title` attribute equals it (`playwright-cli eval "el => el.title" <ref>`), and, because the selection restored from a hash holding only `gt=` is empty, the Export row shows the "empty" hint. Then navigate to `http://localhost:5173/`, type `qNYgbjeV` into the import box and press Import. Expected: 55 stars, link titled, Export hidden (the memo matches). Reload the page. Expected: still 55 stars, the title shows again after the background read, and Export stays hidden (load-time memo).

- [ ] **Step 2: Edit and export a copy**

Toggle off the star bound to a mastery skill: `anvil:4` (grimtools `sk699`, bound to `sk1126`). If the Export row then reads "incomplete" (Anvil's affinity was load-bearing), undo and instead toggle off `rhowan_s_crown:2` (`sk843`) or `widow:5` (`sk897`); the goal is any edit that removes at least one bound star and leaves Export enabled. Press Export. Expected: an "exporting" message, then a new link (a new slug in the hash as `gt=`), titled `Warder, Level 100 (GD 1.2.1.6)` after the background read, Export hidden. Record the new slug.

- [ ] **Step 3: Verify the copy on grimtools**

Fetch `https://www.grimtools.com/calc/<new slug>` with curl (User-Agent `Mozilla/5.0`) into the scratchpad and, with a small bun script written to the scratchpad that imports `extractBuildInfo` and `spliceDevotions` from the worktree's `web/src/core/grimtools.ts` by absolute path, assert: the new page's `data` deep-equals `spliceDevotions(basePage.data, <base star ids>, <exported star ids>)` where the base page is `web/test/fixtures/grimtools-calc.html` and the exported star ids are the base's stars minus the removed one; in particular equipment is identical, the removed star is absent, its binding is gone from the mastery skill, the other seven bindings (including the `itemSkills` entry) are present, and `bio.devotionPoints` is 1. Open the new slug in playwright too and eyeball the calculator: gear on the paper doll, Soldier and Shaman masteries, and one devotion point available.

- [ ] **Step 4: Round-trip and error paths**

Import the new slug in a fresh tab (`http://localhost:5173/`, type it, Import): 54 stars, Export hidden. Press ✕ then Export: a bare export happens (new slug, no base) and its title after the read is grimtools' generic one (no class name). Then, for the base error: navigate to `http://localhost:5173/#gt=zzzzzzzz` with any legal selection in the hash (for example paste the hash from a legal build and replace the `gt=` value), press Export, expect the `ui.export.err.base` message and no new build; press ✕ and Export again, expect a bare export to succeed.

- [ ] **Step 5: Report**

Report to the controller: the slugs created, which star was removed, the verification script's output, and any defect fixed (with its commit). Close the playwright session.

---

### Task 7: docs

**Files:**
- Modify: `docs/grimtools-import.md`
- Modify: `BACKLOG.md` (delete the "Round-trip a whole grimtools build" bullet, lines 55-68)
- Modify: `ONBOARDING.md` only if it describes export as devotions-only (grep `devotions-only|fresh level-100`); otherwise untouched.

- [ ] **Step 1: `docs/grimtools-import.md`**

Make these edits, keeping the document evergreen (describe what is true now; no history):

1. In "The planner" bullets: replace the `gt=<slug>` bullet with:
   ```
   - **`gt=<slug>` in the URL hash is provenance and the base of an export.** The
     authoritative selection stays in `s=`; a hand-edited `gt=` cannot change which build
     renders. On load with a `gt=` the planner reads that build through the gateway once, in
     the background, for its title and to memoize its star set; the read never changes the
     selection or the cap. If it fails the link keeps its untitled label.
   ```
2. In the worker section's "It never relays upstream bytes" bullet, after "HTML-escaped again at the panel, because the panel builds markup as `innerHTML`" add: "and set unescaped as the link's `title` attribute, which is inert text".
3. Rename the export section heading to `## Exporting a selection to grimtools` and rewrite its second and third paragraphs ("The planner maps, the worker relays" onward) to describe both shapes: `POST /export` with `{ skills }` for a fresh character, or `{ skills, base: { slug, remove } }` when a build is associated: the planner reads the base (memo or gateway), `remove` is the base's ids that are keys of the star table, the worker fetches the base page, `spliceDevotions` (drops the named entries, appends the stars, fixes `bio.devotionPoints`, drops bindings to removed stars in `skills[]`/`itemSkills[]`/`transformSkills[]`), everything else byte-for-byte; the copy inherits the base's title. Keep the validation, rate limit, and error lists, adding: a base that cannot be read at export (`notFound`, or `dataVersion` disagreeing with the table) shows `ui.export.err.base` and ✕ is the way to fall back to a fresh build.
4. In "An unchanged selection is not exported twice" replace "A reloaded link restores `gt=` but not the memo, so Export is offered again there." with "A reloaded link restores `gt=` and the load-time read refills the memo, so an unchanged imported build hides Export after a refresh too (until the read completes it is offered)."
5. Known limits: delete "Export covers devotions only ..." and "Duplicate-export detection is per session; a reloaded link offers Export again."; add "Quickbar entries are passed through untouched on export; celestial powers never appear there, so nothing dangles." Keep "The source link persists after the build is edited ..." and update "Import covers devotions only" to say the rest of `buildInfo` is carried through an export by reference (the worker copies it) but nothing in the planner reads it.
6. Under "Changing things", the export contract sentence: "The export route has its own `EXPORT_CONTRACT_VERSION` beside it (2: the body carries an optional `base`), pinned by the same test file."
7. Add the round-trip spec to the sentence naming the export design record.

- [ ] **Step 2: BACKLOG**

Delete the round-trip bullet (it begins "Round-trip a whole grimtools build (planner as the devotions editor)"). Leave the neighbouring bullets.

- [ ] **Step 3: Check and commit**

```bash
just check
git add docs/grimtools-import.md BACKLOG.md ONBOARDING.md
git commit -m "docs(export): describe the round trip, the load-time read, and the base error"
```
(Only add `ONBOARDING.md` if it changed.)

---

## Self-review

- Spec coverage: Part 1 (Task 1), Part 2 (Task 2), Part 3 memo/load-time read/panel/export/port (Tasks 3, 4, 5), errors table (Tasks 2, 4, 5), testing (each task; e2e Task 6), documentation (Tasks 2 and 7). Decision 3 (fetched build never changes selection) is enforced by construction in Task 5: `readBuild` and `ensureSourceRead` never write `state`.
- Types: `ExportBase` (Task 3) is what Task 5 imports; `ExportErrorCode "base"` (Task 4) is what Task 5 sets; `spliceDevotions(data, remove, stars)` argument order is the same in Tasks 1, 2 and 6; `readCalcPage(slug, doFetch, fetchOpts)` is used only inside Task 2.
- No placeholders: every code step carries its code; the e2e task names its expected values.
