# Grimtools Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One button in the planner that saves the current devotion selection as a fresh anonymous grimtools build and shows its link.

**Architecture:** The planner maps its star ids to grimtools `sk` ids with the committed table it already loads for import, and sends them through a `GrimtoolsGateway` port to a new `POST /export` route on the existing Cloudflare Worker, which validates shape, rate-limits, builds the grimtools payload and POSTs it to `save_build.php` (a single request that returns the slug). Success makes the new build the associated grimtools build (`gt=` in the hash), exactly like an import; a session memo of star sets prevents duplicate exports of an unchanged selection.

**Tech Stack:** TypeScript, bun (tests: `bun:test`, no DOM library, hand-rolled fakes), Cloudflare Workers with wrangler 4.120 (`[[ratelimits]]` binding), Biome, `just`.

**Spec:** `docs/superpowers/specs/2026-08-16-grimtools-export-design.md`. Read it first; every task below cites it.

## Global Constraints

- Every code file starts with two `// ABOUTME:` comment lines.
- No user-facing literal strings in app code: every string is a catalog key in all 13 `web/src/i18n/app.<locale>.json` files (`en cs de es fr it ja ko pl pt ru vi zh`) and listed in `web/test/appCatalog.test.ts`'s `REQUIRED` array.
- Comments are evergreen: no dates, ticket ids, "for now", "currently", or history of what was tried.
- No emojis, em dashes, or hyperbole in docs.
- The worker holds no game knowledge and never fetches a caller-named host: the grimtools URLs are compile-time constants (spec, Decision 1 and Part 1).
- Never use `--no-verify`. The pre-commit hook runs `just check` (format, tests, lint, types); a commit that fails it is not done.
- Run everything from the worktree root with `just` recipes: `just test <file>` runs one bun test file, `just test` runs all, `just check` runs the full gate, `just fmt` formats, `just typecheck` runs tsc.
- Use the Write/Edit tools for file changes; the worktree guard rejects heredocs and `eval` in Bash.
- Commit after each task with the message given; the branch is `worktree-grimtools-export-spike`.

---

### Task 1: Core export helpers in `core/grimtools.ts`

**Files:**
- Modify: `web/src/core/grimtools.ts`
- Test: `web/test/grimtools.test.ts`, `web/test/grimtoolsTable.test.ts`

**Interfaces:**
- Consumes: existing `SLUG_RE`, `StarTable`, `IMPORT_CONTRACT_VERSION` in `web/src/core/grimtools.ts`.
- Produces (all exported from `web/src/core/grimtools.ts`):
  - `EXPORT_CONTRACT_VERSION: number` (1)
  - `isSlug(s: string): boolean`
  - `invertStarTable(table: StarTable): Record<string, string>` (star id to `sk` id; throws on a collision)
  - `toGrimtoolsSkills(selected: Iterable<string>, inverse: Record<string, string>): string[] | null` (sorted by star id; null if any star is unmapped)
  - `GRIMTOOLS_DEVOTION_POINTS = 55`
  - `savePayload(skills: string[]): SavePayload` and the `SavePayload` type

- [ ] **Step 1: Write the failing tests**

Append to `web/test/grimtools.test.ts` (extend the existing import line to include the new names):

```ts
import {
  parseSlug,
  extractBuildInfo,
  extractBuildTitle,
  buildIsMissing,
  mapStars,
  isSlug,
  invertStarTable,
  toGrimtoolsSkills,
  savePayload,
  EXPORT_CONTRACT_VERSION,
} from "../src/core/grimtools";
```

and these tests at the end of the file:

```ts
test("isSlug accepts the slug charset and nothing else", () => {
  expect(isSlug("2ga0aJyZ")).toBe(true);
  expect(isSlug("a-b_c")).toBe(true);
  expect(isSlug("")).toBe(false);
  expect(isSlug("a".repeat(25))).toBe(false);
  expect(isSlug("../x")).toBe(false);
  expect(isSlug("has space")).toBe(false);
});

test("invertStarTable turns the committed table into a star-to-sk bijection", () => {
  const stars = (realTable as { stars: Record<string, string> }).stars;
  const inverse = invertStarTable(stars);
  expect(Object.keys(inverse).length).toBe(Object.keys(stars).length);
  for (const [sk, star] of Object.entries(stars)) expect(inverse[star]).toBe(sk);
});

test("invertStarTable refuses a table where two skill ids share one star", () => {
  expect(() => invertStarTable({ sk1: "bat:0", sk2: "bat:0" })).toThrow(/bat:0/);
});

test("the crossroads star the investigation saved round-trips: crossroads_primordial:0 is sk739", () => {
  const stars = (realTable as { stars: Record<string, string> }).stars;
  expect(invertStarTable(stars)["crossroads_primordial:0"]).toBe("sk739");
});

test("toGrimtoolsSkills maps a selection in star-id order, whatever order it was given in", () => {
  const inverse = { "b:1": "sk20", "a:0": "sk10" };
  expect(toGrimtoolsSkills(new Set(["b:1", "a:0"]), inverse)).toEqual(["sk10", "sk20"]);
  expect(toGrimtoolsSkills(["a:0", "b:1"], inverse)).toEqual(["sk10", "sk20"]);
});

test("toGrimtoolsSkills returns null, never a partial list, when a star is unmapped", () => {
  expect(toGrimtoolsSkills(["a:0", "zzz:9"], { "a:0": "sk10" })).toBeNull();
});

test("toGrimtoolsSkills of nothing is an empty list", () => {
  expect(toGrimtoolsSkills([], {})).toEqual([]);
});

test("savePayload is the body grimtools' own Share button posts, minus the fields we never set", () => {
  // Captured from the live calculator on 2026-08-16 (spec, "What the investigation established"):
  // a level-100 character with one crossroads star. Quickbars and mouse slots are left empty; the
  // stripped shape saved and rendered identically to the calculator's own.
  expect(savePayload(["sk739"])).toEqual({
    bio: {
      level: 100,
      attributePoints: 109,
      skillPoints: 250,
      devotionPoints: 54,
      physique: 50,
      cunning: 50,
      spirit: 50,
    },
    equipment: {},
    potions: {},
    skills: [{ name: "sk739", level: 1 }],
    itemSkills: [],
    transformSkills: [],
    quickbar: {
      mouse1: { left: null, right: null },
      mouse2: { left: null, right: null },
      quickbar1: [],
      quickbar2: [],
    },
    devotionsProgression: [],
    skillsProgression: [],
  });
});

test("savePayload counts devotionPoints down from grimtools' 55", () => {
  const full = Array.from({ length: 55 }, (_, i) => `sk${i}`);
  expect(savePayload(full).bio.devotionPoints).toBe(0);
  expect(savePayload(full).skills.length).toBe(55);
});

test("the export contract version is a positive integer", () => {
  expect(Number.isInteger(EXPORT_CONTRACT_VERSION) && EXPORT_CONTRACT_VERSION >= 1).toBe(true);
});
```

Append to `web/test/grimtoolsTable.test.ts` (import `invertStarTable` from `../src/core/grimtools`):

```ts
test("the committed table inverts cleanly, so every star has exactly one grimtools id to export", () => {
  // The ordering test above forbids two stars sharing an sk id; this is the same guard from the
  // export side, on the exact artifact the planner ships.
  const inverse = invertStarTable(stars);
  expect(Object.keys(inverse).length).toBe(559);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `just test test/grimtools.test.ts test/grimtoolsTable.test.ts`
Expected: FAIL, the new imports are undefined (`isSlug is not a function` or similar).

- [ ] **Step 3: Implement**

In `web/src/core/grimtools.ts`, right after `IMPORT_CONTRACT_VERSION`'s declaration, add:

```ts
/**
 * Version of the worker's export contract (`POST /export` with `{ skills }` -> `{ slug }`).
 * Export responses are never cached, so this only exists to keep the two routes symmetrical:
 * the app sends it as `?v=` and the response-shape guard in `web/test/worker.test.ts` pins the
 * field set against it. Bump on a rename or removal, not on an additive field.
 */
export const EXPORT_CONTRACT_VERSION = 1;
```

Right after `SLUG_RE`, add:

```ts
/** True when `s` is a grimtools slug. The worker uses it on the id grimtools returns and the
 * gateway adapter uses it again before that id becomes an href. */
export function isSlug(s: string): boolean {
  return SLUG_RE.test(s);
}
```

At the end of the file, after `mapStars`, add:

```ts
/**
 * The export direction of the committed table: our star id to grimtools' `sk<id>`.
 *
 * Throws if two skill ids map to one star. The table's generation gates and
 * `web/test/grimtoolsTable.test.ts` already forbid that, so the throw is a last guard against a
 * hand-edited table producing a plausible-but-wrong export rather than a visible failure.
 */
export function invertStarTable(table: StarTable): Record<string, string> {
  const inverse: Record<string, string> = {};
  for (const [sk, star] of Object.entries(table)) {
    const prior = inverse[star];
    if (prior !== undefined) throw new Error(`grimtools table maps ${prior} and ${sk} to the same star ${star}`);
    inverse[star] = sk;
  }
  return inverse;
}

/**
 * Turn a selection into the grimtools skill ids that represent it, sorted by star id so one
 * selection always produces one request body. Returns null (never a partial list) if any star is
 * absent from `inverse`: the table covers every star, so a miss is a bug worth surfacing, not a
 * star worth dropping.
 */
export function toGrimtoolsSkills(selected: Iterable<string>, inverse: Record<string, string>): string[] | null {
  const skills: string[] = [];
  for (const star of [...selected].sort()) {
    const sk = inverse[star];
    if (sk === undefined) return null;
    skills.push(sk);
  }
  return skills;
}

/** grimtools' devotion budget; `bio.devotionPoints` counts down from it. */
export const GRIMTOOLS_DEVOTION_POINTS = 55;

/** The body `save_build.php` accepts, in the shape the calculator's own Share button posts. */
export interface SavePayload {
  bio: {
    level: number;
    attributePoints: number;
    skillPoints: number;
    devotionPoints: number;
    physique: number;
    cunning: number;
    spirit: number;
  };
  equipment: Record<string, never>;
  potions: Record<string, never>;
  skills: { name: string; level: number }[];
  itemSkills: never[];
  transformSkills: never[];
  quickbar: {
    mouse1: { left: null; right: null };
    mouse2: { left: null; right: null };
    quickbar1: never[];
    quickbar2: never[];
  };
  devotionsProgression: never[];
  skillsProgression: never[];
}

/**
 * The build grimtools' Share button would post for a fresh level-100 character holding exactly
 * these devotion stars: no masteries, gear, or quickbar, and empty progressions (grimtools stores
 * `devotionsProgression` but nothing in its UI records or renders it). The `bio` numbers are the
 * calculator's own defaults for a fresh level-100 character; grimtools stamps the game version
 * server-side, so it is not sent.
 */
export function savePayload(skills: string[]): SavePayload {
  return {
    bio: {
      level: 100,
      attributePoints: 109,
      skillPoints: 250,
      devotionPoints: GRIMTOOLS_DEVOTION_POINTS - skills.length,
      physique: 50,
      cunning: 50,
      spirit: 50,
    },
    equipment: {},
    potions: {},
    skills: skills.map((name) => ({ name, level: 1 })),
    itemSkills: [],
    transformSkills: [],
    quickbar: {
      mouse1: { left: null, right: null },
      mouse2: { left: null, right: null },
      quickbar1: [],
      quickbar2: [],
    },
    devotionsProgression: [],
    skillsProgression: [],
  };
}
```

Update the file's second ABOUTME line to mention the export direction, e.g.
`// ABOUTME: a slug with no build, mapStars, and the export direction (invertStarTable, savePayload). Shared by the planner and the Cloudflare worker.`
(keep it to two ABOUTME lines; reflow the first line as needed).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `just test test/grimtools.test.ts test/grimtoolsTable.test.ts`
Expected: PASS.

- [ ] **Step 5: Format and commit**

```bash
just fmt
git add web/src/core/grimtools.ts web/test/grimtools.test.ts web/test/grimtoolsTable.test.ts
git commit -m "feat(grimtools): export-side helpers: inverse table, skill mapping, save payload"
```

---

### Task 2: `legal` on `ReachView` and `SelectionView`

**Files:**
- Modify: `web/src/core/reachability.ts` (`ReachView` at ~line 1268, `reachabilityForSelection` ~1280-1353, `SelectionView` ~1357, `selectionView` ~1376-1415)
- Modify: `web/src/app/main.ts` (`permissiveReach`, ~line 308-330)
- Modify: `web/test/rules-toggle.test.ts:39`, `web/test/rules-constellation.test.ts:29`, `web/test/svgRenderer.test.ts:98` (object literals typed as `ReachView` gain `legal: true`)
- Test: `web/test/selection-legal.test.ts` (create)

**Interfaces:**
- Produces: `ReachView.legal: boolean` and `SelectionView.legal: boolean`, true when the selection is a legal build on its own: **valid** (every started constellation's requirement is met by the completed constellations' affinity: `st.target[i] <= st.supplyUncapped[i]` for every color) **and constructible** (the selection classifies "reachable" at the sweep budget, which `reachabilityForSelection` already computes as `selfReachable`). The empty selection is legal.

Why both (spec, Part 2): the engine's "reachable" for a selection means "can be held within the budget with scaffolding still standing", so the forum link's build (Scales of Ulcama short 2 Order) is reachable at 54 yet is not a build the game lets you finish on. Measured on the committed data: forum build `{valid: false, self: reachable}`; with Lion completed `{valid: true, self: reachable}`; with Dryad completed (55 stars) `{valid: true, self: dim}`. Only the middle one is legal. Neither check adds engine work: `selfReachable` exists, and validity is five integer comparisons on the summary the function already holds.

- [ ] **Step 1: Write the failing test**

Create `web/test/selection-legal.test.ts`:

```ts
// ABOUTME: A selection is "legal" when it classifies reachable within the game's 55 points; export
// ABOUTME: gates on it. Pinned on the Lion/Dryad forum link: deficit, completed, and over-budget cases.
import { test, expect } from "bun:test";
import doc from "../../data/devotions.json";
import { buildModel } from "../src/core/model";
import { canonicalStarIds, decodeHash } from "../src/core/urlState";
import { buildCoverTable, buildReachCons, reachabilityForSelection, selectionView } from "../src/core/reachability";

const model = buildModel(doc as any);
const cons = buildReachCons(model);
const table = buildCoverTable(cons);
const canon = canonicalStarIds(model);

// 50 points at cap 55 with Scales of Ulcama short 2 Order (see dim-reasons.test.ts for the full story).
const HASH = "#p=55&s=AAAAgAQAAMADwAMAAAAAAMADAAAAAAAAAIA_AAAAwA8A4AcAAAAAAPADAAA_AD4";
const build50 = decodeHash(HASH, canon)!.selected;
const withCon = (sel: Set<string>, conId: string): Set<string> => {
  const out = new Set(sel);
  for (const sid of model.constellations.get(conId)!.starIds) out.add(sid);
  return out;
};

test("a selection with an affinity deficit is not a legal build, even though it is reachable with scaffolding held", () => {
  // Scales of Ulcama needs Order 8; the completed constellations supply 6. The engine can hold this
  // selection within 54 points with a scaffold standing, so it classifies reachable, but the game
  // would not let you end on it: refunding the scaffold would strand Scales.
  expect(selectionView(model, cons, table, build50, 55).legal).toBe(false);
  expect(reachabilityForSelection(model, cons, table, build50, 55).legal).toBe(false);
  expect(reachabilityForSelection(model, cons, table, build50, 55).completable.has("lion")).toBe(true); // reachability itself is unchanged
});

test("completing Lion supplies the missing Order and makes the selection legal", () => {
  expect(selectionView(model, cons, table, withCon(build50, "lion"), 55).legal).toBe(true);
});

test("Dryad's five stars make a valid 55-star selection that needs 56 points to construct, so it is not legal", () => {
  expect(selectionView(model, cons, table, withCon(build50, "dryad"), 55).legal).toBe(false);
});

test("legal is about the game's 55, not the slider: a lower cap does not make a legal build illegal", () => {
  // selectionView raises the sweep budget to the validity floor, so cap 30 still reports legal.
  expect(selectionView(model, cons, table, withCon(build50, "lion"), 30).legal).toBe(true);
});

test("the empty selection is trivially legal (export gates on emptiness separately)", () => {
  expect(selectionView(model, cons, table, new Set(), 55).legal).toBe(true);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `just test test/selection-legal.test.ts`
Expected: FAIL (`legal` is undefined, so `toBe(false)`/`toBe(true)` fail) and `just typecheck` reports `legal` does not exist on the type.

- [ ] **Step 3: Implement**

In `web/src/core/reachability.ts`, `ReachView` gains a field (add after `needSource`):

```ts
  /** The selection is a legal build on its own: valid (every started constellation's requirement is
   *  met by the completed ones' affinity, docs/devotion-system.md) and constructible (it classifies
   *  reachable at the sweep budget, which is never below the validity floor nor above 55, so that
   *  verdict is the verdict at 55). "Reachable" alone is weaker: it means the selection can be held
   *  within the budget with scaffolding standing, which the game would not let you finish on. */
  legal: boolean;
```

In `reachabilityForSelection`, right after `const selfReachable = ...`, add:

```ts
  // Rule 5 in docs/devotion-system.md, checked on the summary: no started constellation may need more
  // of a color than the completed ones supply. Same comparison the affinity panel shows as have/need.
  const selfValid = st.target.every((need, i) => need <= st.supplyUncapped[i]!);
```

and the return statement becomes:

```ts
  return {
    completable,
    reachableStars,
    have: st.supplyUncapped,
    need: st.target,
    needSource,
    legal: selfReachable && selfValid,
  };
```

(`st.target` and `st.supplyUncapped` are the `Vec` fields already returned as `need` and `have`; check `ReachState`'s type for their exact names if the compiler disagrees.)

`SelectionView` gains:

```ts
  legal: boolean; // reach.legal: the selection is a legal build within 55 (export gates on it)
```

and both `return` statements in `selectionView` add `legal: reach.legal,`.

In `web/src/app/main.ts`, `permissiveReach`'s return adds `legal: false` (uncapped or no cover table: legality is unknown, and export is disabled on that path anyway):

```ts
    return { completable, reachableStars, have: s.supplyUncapped, need: s.target, needSource, legal: false };
```

In the three test files that build a `ReachView` literal (`web/test/rules-toggle.test.ts` around line 39, `web/test/rules-constellation.test.ts` around line 29, `web/test/svgRenderer.test.ts` around line 98), add `legal: true,` next to `reachableStars`. Run `just typecheck` to find any other literal the compiler flags.

- [ ] **Step 4: Run the tests and types to verify they pass**

Run: `just test test/selection-legal.test.ts test/rules-toggle.test.ts test/rules-constellation.test.ts test/svgRenderer.test.ts && just typecheck`
Expected: PASS, no type errors.

- [ ] **Step 5: Format and commit**

```bash
just fmt
git add web/src/core/reachability.ts web/src/app/main.ts web/test/selection-legal.test.ts web/test/rules-toggle.test.ts web/test/rules-constellation.test.ts web/test/svgRenderer.test.ts
git commit -m "feat(reach): surface whether the selection is a legal build within 55 (ReachView.legal)"
```

---

### Task 3: Worker `POST /export` route

**Files:**
- Modify: `worker/src/index.ts`
- Modify: `worker/wrangler.toml`
- Test: `web/test/worker.test.ts`

**Interfaces:**
- Consumes: `savePayload`, `isSlug` from `web/src/core/grimtools.ts` (Task 1).
- Produces: `POST /export` with JSON body `{ skills: string[] }`, responses `201 { slug }`, `400 { error: "bad_request" }`, `403 { error: "forbidden" }`, `405 { error: "method_not_allowed" }`, `404 { error: "not_found" }`, `429 { error: "rate_limited" }`, `502 { error: "upstream" | "unparseable" }`. `Env` gains optional `EXPORT_LIMITER_IP` and `EXPORT_LIMITER_GLOBAL` of type `RateLimiter` (`{ limit(opts: { key: string }): Promise<{ success: boolean }> }`), exported from the worker module.

- [ ] **Step 1: Write the failing tests**

Append to `web/test/worker.test.ts`:

```ts
// --- POST /export -------------------------------------------------------------------------------

const EXPORT_URL = "https://w/export";
const SAVE_URL = "https://www.grimtools.com/save_build.php";
type Limiter = { limit(opts: { key: string }): Promise<{ success: boolean }> };

/** A limiter that allows the first `allow` calls for each key and refuses the rest, recording keys. */
function fakeLimiter(allow: number): Limiter & { keys: string[] } {
  const counts = new Map<string, number>();
  const keys: string[] = [];
  return {
    keys,
    async limit({ key }) {
      keys.push(key);
      const n = (counts.get(key) ?? 0) + 1;
      counts.set(key, n);
      return { success: n <= allow };
    },
  };
}

function exportEnv(fetchImpl: typeof fetch, extra: Record<string, unknown> = {}) {
  return { ALLOWED_ORIGIN: ORIGIN, fetchImpl, ...extra } as never;
}

function exportRequest(body: unknown, init: { origin?: string | null; ip?: string; raw?: string } = {}) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (init.origin !== null) headers.set("Origin", init.origin ?? ORIGIN);
  if (init.ip) headers.set("CF-Connecting-IP", init.ip);
  return new Request(EXPORT_URL, { method: "POST", headers, body: init.raw ?? JSON.stringify(body) });
}

const saved = (async () => new Response('{"id":"2ga0aJyZ"}', { status: 200 })) as never;

test("export: a valid body is posted to grimtools as its Share button would post it, and the slug comes back", async () => {
  let seen: { url: string; init: RequestInit } | null = null;
  const spy = (async (url: string, init: RequestInit) => {
    seen = { url: String(url), init };
    return new Response('{"id":"2ga0aJyZ"}', { status: 200 });
  }) as never;
  const res = await handleRequest(exportRequest({ skills: ["sk739"] }), exportEnv(spy));
  expect(res.status).toBe(201);
  expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
  expect(res.headers.get("Cache-Control")).toBe("no-store");
  expect(await res.json()).toEqual({ slug: "2ga0aJyZ" });

  const { url, init } = seen!;
  expect(url).toBe(SAVE_URL);
  expect(init.method).toBe("POST");
  expect(init.redirect).toBe("manual");
  const h = new Headers(init.headers);
  expect(h.get("Content-Type")).toBe("application/x-www-form-urlencoded; charset=UTF-8");
  expect(h.get("X-Requested-With")).toBe("XMLHttpRequest");
  expect(h.get("Referer")).toBe("https://www.grimtools.com/calc/");
  expect(h.get("User-Agent")).toContain("grimdawn-devotions");
  const form = new URLSearchParams(String(init.body));
  expect(form.get("mod")).toBe("");
  expect(JSON.parse(form.get("data")!)).toEqual(savePayload(["sk739"]));
});

test("export: the success response has exactly the contracted field names", async () => {
  const res = await handleRequest(exportRequest({ skills: ["sk739"] }), exportEnv(saved));
  expect(Object.keys(await res.json()).sort()).toEqual(["slug"]);
});

test("export: refuses a request from any other origin, or none, before doing anything", async () => {
  let called = false;
  const spy = (async () => {
    called = true;
    return new Response("");
  }) as never;
  expect((await handleRequest(exportRequest({ skills: ["sk1"] }, { origin: "https://evil.example" }), exportEnv(spy))).status).toBe(403);
  expect((await handleRequest(exportRequest({ skills: ["sk1"] }, { origin: null }), exportEnv(spy))).status).toBe(403);
  expect(called).toBe(false);
});

test("export: rejects every malformed body with 400 and never reaches grimtools", async () => {
  let called = false;
  const spy = (async () => {
    called = true;
    return new Response("");
  }) as never;
  const bad: unknown[] = [
    {},
    { skills: [] },
    { skills: "sk1" },
    { skills: [1] },
    { skills: ["sk1", "sk1"] },
    { skills: ["../x"] },
    { skills: ["sk1 "] },
    { skills: Array.from({ length: 56 }, (_, i) => `sk${i}`) },
    null,
    [],
  ];
  for (const b of bad) {
    const res = await handleRequest(exportRequest(b), exportEnv(spy));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad_request" });
  }
  expect((await handleRequest(exportRequest(null, { raw: "not json" }), exportEnv(spy))).status).toBe(400);
  expect(called).toBe(false);
});

test("export: a body over 4 KB is refused as bad_request without being parsed", async () => {
  let called = false;
  const spy = (async () => {
    called = true;
    return new Response("");
  }) as never;
  const raw = JSON.stringify({ skills: ["sk1"], pad: "x".repeat(5000) });
  const res = await handleRequest(exportRequest(null, { raw }), exportEnv(spy));
  expect(res.status).toBe(400);
  expect(called).toBe(false);
});

test("export: accepts 55 distinct skills", async () => {
  const res = await handleRequest(
    exportRequest({ skills: Array.from({ length: 55 }, (_, i) => `sk${i + 1}`) }),
    exportEnv(saved),
  );
  expect(res.status).toBe(201);
});

test("export: the per-IP limiter is keyed on CF-Connecting-IP and refuses with 429 once spent", async () => {
  const ip = fakeLimiter(1);
  const env = exportEnv(saved, { EXPORT_LIMITER_IP: ip });
  expect((await handleRequest(exportRequest({ skills: ["sk1"] }, { ip: "203.0.113.9" }), env)).status).toBe(201);
  const second = await handleRequest(exportRequest({ skills: ["sk1"] }, { ip: "203.0.113.9" }), env);
  expect(second.status).toBe(429);
  expect(await second.json()).toEqual({ error: "rate_limited" });
  expect(ip.keys).toEqual(["ip:203.0.113.9", "ip:203.0.113.9"]);
  // A different address has its own budget.
  expect((await handleRequest(exportRequest({ skills: ["sk1"] }, { ip: "203.0.113.10" }), env)).status).toBe(201);
});

test("export: the global limiter caps everyone together, and a refusal never reaches grimtools", async () => {
  let calls = 0;
  const spy = (async () => {
    calls++;
    return new Response('{"id":"2ga0aJyZ"}', { status: 200 });
  }) as never;
  const global = fakeLimiter(1);
  const env = exportEnv(spy, { EXPORT_LIMITER_GLOBAL: global });
  expect((await handleRequest(exportRequest({ skills: ["sk1"] }, { ip: "203.0.113.1" }), env)).status).toBe(201);
  expect((await handleRequest(exportRequest({ skills: ["sk1"] }, { ip: "203.0.113.2" }), env)).status).toBe(429);
  expect(global.keys).toEqual(["global", "global"]);
  expect(calls).toBe(1);
});

test("export: with no limiter bindings (tests, local runtimes without them) nothing is limited", async () => {
  for (let i = 0; i < 3; i++) {
    expect((await handleRequest(exportRequest({ skills: ["sk1"] }), exportEnv(saved))).status).toBe(201);
  }
});

test("export: an upstream failure, a redirect, or a thrown fetch is 502 upstream", async () => {
  const cases: (typeof fetch)[] = [
    (async () => new Response("nope", { status: 500 })) as never,
    (async () => new Response("", { status: 302, headers: { Location: "https://evil.example/" } })) as never,
    (async () => {
      throw new Error("boom");
    }) as never,
  ];
  for (const f of cases) {
    const res = await handleRequest(exportRequest({ skills: ["sk1"] }), exportEnv(f));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("upstream");
  }
});

test("export: a 2xx from grimtools without a valid slug id is 502 unparseable, and nothing upstream is relayed", async () => {
  const cases = ['{"error":"nope"}', "not json", '{"id":"../../etc"}', '{"id":""}', '{"id":42}', '{"id":"<b>x</b>"}'];
  for (const body of cases) {
    const f = (async () => new Response(body, { status: 200 })) as never;
    const res = await handleRequest(exportRequest({ skills: ["sk1"] }), exportEnv(f));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "unparseable" });
  }
});

test("export: only POST is accepted on /export, and unknown paths are 404", async () => {
  expect((await handleRequest(new Request(EXPORT_URL, { method: "GET", headers: { Origin: ORIGIN } }), exportEnv(saved))).status).toBe(405);
  expect((await handleRequest(new Request("https://w/other", { headers: { Origin: ORIGIN } }), exportEnv(saved))).status).toBe(404);
});

test("preflight advertises POST and the Content-Type header for the export route", async () => {
  const res = await handleRequest(new Request(EXPORT_URL, { method: "OPTIONS" }), exportEnv(saved));
  expect(res.status).toBe(204);
  expect(res.headers.get("Access-Control-Allow-Methods")).toBe("GET, POST, OPTIONS");
  expect(res.headers.get("Access-Control-Allow-Headers")).toBe("Content-Type");
  expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
});

test("export: the default export's caching wrapper passes POST straight through, uncached", async () => {
  installFakeCache();
  let calls = 0;
  const spy = (async () => {
    calls++;
    return new Response('{"id":"2ga0aJyZ"}', { status: 200 });
  }) as never;
  const env = exportEnv(spy);
  await worker.fetch(exportRequest({ skills: ["sk1"] }), env);
  await worker.fetch(exportRequest({ skills: ["sk1"] }), env);
  expect(calls).toBe(2);
});
```

Add `savePayload` to the test file's imports: `import { savePayload } from "../src/core/grimtools";`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `just test test/worker.test.ts`
Expected: the new tests FAIL (405s and 404s where 201/403/400 are expected); the existing tests still pass.

- [ ] **Step 3: Implement the route**

In `worker/src/index.ts`:

1. Extend the import from `../../web/src/core/grimtools` with `savePayload` and `isSlug`.
2. Add constants after `TIMEOUT_MS`:

```ts
const SAVE_URL = "https://www.grimtools.com/save_build.php";
const CALC_REFERER = "https://www.grimtools.com/calc/";
const MAX_EXPORT_BODY = 4096; // 55 ids at ~10 bytes each is well under 1 KB; this bounds a hostile body
const MAX_EXPORT_SKILLS = 55; // the game's devotion budget
const SKILL_ID_RE = /^sk\d+$/;
```

3. Replace the `Env` interface:

```ts
/** The surface of a Workers rate-limit binding (`[[ratelimits]]` in wrangler.toml); tests pass a fake. */
export interface RateLimiter {
  limit(opts: { key: string }): Promise<{ success: boolean }>;
}

export interface Env {
  ALLOWED_ORIGIN: string;
  /** Export brakes: per client address and for everyone together. Absent means unlimited (tests, or
   * a runtime without the bindings); the two are separate bindings because a binding carries one
   * limit configuration. */
  EXPORT_LIMITER_IP?: RateLimiter;
  EXPORT_LIMITER_GLOBAL?: RateLimiter;
  /** Injected in tests only; production uses global fetch. */
  fetchImpl?: typeof fetch;
}
```

4. Add these helpers after `boundedText`:

```ts
/** Read at most `max` bytes of a request body as text; null when it runs over, enforced while
 * reading so an oversized body is never fully buffered or parsed. */
async function boundedBody(req: Request, max: number): Promise<string | null> {
  const reader = req.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let text = "";
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      text += decoder.decode();
      return text;
    }
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      return null;
    }
    text += decoder.decode(value, { stream: true });
  }
}

/** The export body: 1..MAX_EXPORT_SKILLS distinct `sk<digits>` strings under `skills`, nothing else
 * accepted. The worker cannot tell a devotion star from a mastery skill (same as import); this bound
 * plus the rate limit is the protection. */
function parseExportBody(text: string): string[] | null {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) return null;
  const skills = (doc as { skills?: unknown }).skills;
  if (!Array.isArray(skills) || skills.length === 0 || skills.length > MAX_EXPORT_SKILLS) return null;
  if (!skills.every((s) => typeof s === "string" && SKILL_ID_RE.test(s))) return null;
  if (new Set(skills).size !== skills.length) return null;
  return skills as string[];
}

async function allowed(limiter: RateLimiter | undefined, key: string): Promise<boolean> {
  if (!limiter) return true;
  return (await limiter.limit({ key })).success;
}

/**
 * Save a devotion selection as a fresh anonymous grimtools build and return its slug. One POST to a
 * constant URL, in the exact shape the calculator's own Share button sends (see savePayload); the
 * only caller-controlled bytes are the validated skill ids inside the JSON `data` field.
 */
async function handleExport(request: Request, env: Env): Promise<Response> {
  const origin = env.ALLOWED_ORIGIN;
  const doFetch = env.fetchImpl ?? fetch;
  // Browsers set Origin and cannot forge it; for anything else this is friction, not security, and
  // it keeps the CORS response identical to the import route's.
  if (request.headers.get("Origin") !== origin) return json({ error: "forbidden" }, 403, origin);
  const text = await boundedBody(request, MAX_EXPORT_BODY);
  const skills = text === null ? null : parseExportBody(text);
  if (!skills) return json({ error: "bad_request" }, 400, origin);
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  if (!(await allowed(env.EXPORT_LIMITER_IP, `ip:${ip}`)) || !(await allowed(env.EXPORT_LIMITER_GLOBAL, "global")))
    return json({ error: "rate_limited" }, 429, origin);

  const form = new URLSearchParams({ data: JSON.stringify(savePayload(skills)), mod: "" });
  let res: Response;
  try {
    res = await doFetch(SAVE_URL, {
      method: "POST",
      headers: {
        "User-Agent": UA,
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
        Referer: CALC_REFERER,
      },
      body: form.toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: "manual", // a redirect (status 3xx, not ok) is an upstream failure, never followed
    });
  } catch {
    return json({ error: "upstream" }, 502, origin);
  }
  if (!res.ok) return json({ error: "upstream", status: res.status }, 502, origin);
  // Re-validate rather than trust: the only upstream byte sequence that ever leaves here is an id
  // in our own slug charset.
  let id: unknown;
  try {
    id = (JSON.parse(await boundedText(res)) as { id?: unknown } | null)?.id;
  } catch {
    return json({ error: "unparseable" }, 502, origin);
  }
  if (typeof id !== "string" || !isSlug(id)) return json({ error: "unparseable" }, 502, origin);
  return json({ slug: id }, 201, origin);
}
```

5. Rework the top of `handleRequest` (everything before `// The only caller-controlled value...`):

```ts
export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const origin = env.ALLOWED_ORIGIN;
  const doFetch = env.fetchImpl ?? fetch;
  if (request.method === "OPTIONS")
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type", // a JSON POST is preflighted for this
      },
    });
  const path = new URL(request.url).pathname;
  if (path === "/export") {
    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405, origin);
    return handleExport(request, env);
  }
  if (path !== "/") return json({ error: "not_found" }, 404, origin);
  if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405, origin);
```

(the rest of the import handling is unchanged.)

6. `json()`'s `Cache-Control` already gives every non-200 `no-store`, so the 201 needs no change; update its comment to say "Only the import route's 200 is a build that will never change, so only that is storable; every export response (201 included) is a write and stays no-store."

7. Update the file's ABOUTME lines:
```ts
// ABOUTME: Cloudflare Worker between the planner and grimtools: reads a build's devotion star ids by
// ABOUTME: slug (GET /) and saves a selection as a fresh build (POST /export). Never fetches a caller-named host.
```

8. `worker/wrangler.toml`: append

```toml
# Export brakes (POST /export). Two bindings because each carries one limit: per client address, and
# for everyone together so a crowd cannot turn the route into a firehose at grimtools. Per Cloudflare
# location and eventually consistent, which is fine for a brake. `wrangler dev --local` simulates them.
[[ratelimits]]
name = "EXPORT_LIMITER_IP"
namespace_id = "1001"
simple = { limit = 5, period = 60 }

[[ratelimits]]
name = "EXPORT_LIMITER_GLOBAL"
namespace_id = "1002"
simple = { limit = 60, period = 60 }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `just test test/worker.test.ts && just typecheck`
Expected: PASS (all previous worker tests still green, including "rejects non-GET methods", which posts to `/` and still gets 405).

- [ ] **Step 5: Smoke the route on the local runtime**

Run in the background: `just worker-dev` (needs `worker/.dev.vars` with `ALLOWED_ORIGIN=http://localhost:5173`; see `worker/README.md`). Confirm the startup banner lists `env.EXPORT_LIMITER_IP (5 requests/60s)` and `env.EXPORT_LIMITER_GLOBAL (60 requests/60s)`. Then a request with a bad origin must be refused without any upstream call:

```bash
curl -s -i -X POST http://localhost:8787/export -H 'Origin: https://evil.example' -H 'Content-Type: application/json' -d '{"skills":["sk739"]}' | head -1
```
Expected: `HTTP/1.1 403 Forbidden`. Do not run a real export from curl here (each one creates a build on grimtools); the end-to-end check is Task 6. Stop the dev server.

- [ ] **Step 6: Format and commit**

```bash
just fmt
git add worker/src/index.ts worker/wrangler.toml web/test/worker.test.ts
git commit -m "feat(worker): POST /export saves a selection as a fresh grimtools build, rate limited"
```

---

### Task 4: `GrimtoolsGateway` port and worker adapter; import goes through it

**Files:**
- Create: `web/src/ports/GrimtoolsGateway.ts`
- Create: `web/src/adapters/grimtoolsWorkerGateway.ts`
- Modify: `web/src/app/main.ts` (`runImport`, ~lines 908-967; the `importApi` constant at line 70)
- Test: `web/test/grimtoolsWorkerGateway.test.ts` (create)

**Interfaces:**
- Consumes: `IMPORT_CONTRACT_VERSION`, `EXPORT_CONTRACT_VERSION`, `isSlug` from `core/grimtools.ts`.
- Produces:
  ```ts
  type FetchBuildResult =
    | { kind: "ok"; skills: string[]; dataVersion: string | null; title: string | null }
    | { kind: "notFound" } | { kind: "network" };
  type SaveBuildResult =
    | { kind: "ok"; slug: string } | { kind: "rateLimited" } | { kind: "upstream" } | { kind: "network" };
  interface GrimtoolsGateway { fetchBuild(slug: string): Promise<FetchBuildResult>; saveBuild(skills: string[]): Promise<SaveBuildResult>; }
  makeWorkerGateway(baseUrl: string, fetchImpl?: typeof fetch): GrimtoolsGateway
  ```

- [ ] **Step 1: Write the failing test**

Create `web/test/grimtoolsWorkerGateway.test.ts`:

```ts
// ABOUTME: Tests the worker gateway adapter: request shapes for both routes and the mapping of every
// ABOUTME: HTTP outcome to the port's result unions. No network: fetch is a recording fake.
import { test, expect } from "bun:test";
import { makeWorkerGateway } from "../src/adapters/grimtoolsWorkerGateway";
import { EXPORT_CONTRACT_VERSION, IMPORT_CONTRACT_VERSION } from "../src/core/grimtools";

const BASE = "https://api.example";

function fakeFetch(respond: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return respond(String(url), init);
  }) as typeof fetch;
  return { f, calls };
}
const jsonRes = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

test("fetchBuild GETs the import route with the slug and the import contract version", async () => {
  const { f, calls } = fakeFetch(() => jsonRes({ slug: "qNYgbjeV", skills: ["sk688"], dataVersion: "1a80", title: "Warder" }));
  const r = await makeWorkerGateway(BASE, f).fetchBuild("qNYgbjeV");
  expect(calls[0]!.url).toBe(`${BASE}/?slug=qNYgbjeV&v=${IMPORT_CONTRACT_VERSION}`);
  expect(r).toEqual({ kind: "ok", skills: ["sk688"], dataVersion: "1a80", title: "Warder" });
});

test("fetchBuild encodes the slug and tolerates a response with no title and no dataVersion", async () => {
  const { f, calls } = fakeFetch(() => jsonRes({ slug: "x", skills: ["sk1"] }));
  const r = await makeWorkerGateway(BASE, f).fetchBuild("a b");
  expect(calls[0]!.url).toContain("slug=a%20b");
  expect(r).toEqual({ kind: "ok", skills: ["sk1"], dataVersion: null, title: null });
});

test("fetchBuild maps 404 to notFound and everything else that is not ok to network", async () => {
  expect(await makeWorkerGateway(BASE, fakeFetch(() => jsonRes({ error: "not_found" }, 404)).f).fetchBuild("x")).toEqual({ kind: "notFound" });
  expect(await makeWorkerGateway(BASE, fakeFetch(() => jsonRes({ error: "upstream" }, 502)).f).fetchBuild("x")).toEqual({ kind: "network" });
  expect(await makeWorkerGateway(BASE, fakeFetch(() => new Response("<html>", { status: 200 })).f).fetchBuild("x")).toEqual({ kind: "network" });
  const thrower = (async () => {
    throw new TypeError("offline");
  }) as typeof fetch;
  expect(await makeWorkerGateway(BASE, thrower).fetchBuild("x")).toEqual({ kind: "network" });
});

test("saveBuild POSTs JSON to the export route with the export contract version", async () => {
  const { f, calls } = fakeFetch(() => jsonRes({ slug: "2ga0aJyZ" }, 201));
  const r = await makeWorkerGateway(BASE, f).saveBuild(["sk739", "sk740"]);
  expect(r).toEqual({ kind: "ok", slug: "2ga0aJyZ" });
  const { url, init } = calls[0]!;
  expect(url).toBe(`${BASE}/export?v=${EXPORT_CONTRACT_VERSION}`);
  expect(init?.method).toBe("POST");
  expect(new Headers(init?.headers).get("Content-Type")).toBe("application/json");
  expect(JSON.parse(String(init?.body))).toEqual({ skills: ["sk739", "sk740"] });
});

test("saveBuild maps 429 to rateLimited, 502 to upstream, and other failures to network", async () => {
  const gw = (status: number, body: unknown = { error: "x" }) => makeWorkerGateway(BASE, fakeFetch(() => jsonRes(body, status)).f);
  expect(await gw(429).saveBuild(["sk1"])).toEqual({ kind: "rateLimited" });
  expect(await gw(502).saveBuild(["sk1"])).toEqual({ kind: "upstream" });
  expect(await gw(400).saveBuild(["sk1"])).toEqual({ kind: "network" });
  expect(await gw(403).saveBuild(["sk1"])).toEqual({ kind: "network" });
  expect(await gw(200, { slug: "abc" }).saveBuild(["sk1"])).toEqual({ kind: "network" }); // the contract is 201
  const thrower = (async () => {
    throw new TypeError("offline");
  }) as typeof fetch;
  expect(await makeWorkerGateway(BASE, thrower).saveBuild(["sk1"])).toEqual({ kind: "network" });
});

test("saveBuild re-checks the slug charset before it can become an href", async () => {
  const gw = (body: unknown) => makeWorkerGateway(BASE, fakeFetch(() => jsonRes(body, 201)).f);
  expect(await gw({ slug: "../evil" }).saveBuild(["sk1"])).toEqual({ kind: "network" });
  expect(await gw({ slug: 7 }).saveBuild(["sk1"])).toEqual({ kind: "network" });
  expect(await gw({}).saveBuild(["sk1"])).toEqual({ kind: "network" });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `just test test/grimtoolsWorkerGateway.test.ts`
Expected: FAIL, module `../src/adapters/grimtoolsWorkerGateway` not found.

- [ ] **Step 3: Create the port and adapter**

`web/src/ports/GrimtoolsGateway.ts`:

```ts
// ABOUTME: Port for the planner's two conversations with grimtools, both relayed through our worker:
// ABOUTME: read a build's skill ids by slug, and save a devotion selection as a fresh build.

/** Outcome of reading a build. `skills` mixes mastery skills and devotion stars: the caller splits
 * them with the mapping table (see mapStars). `dataVersion` null means the worker could not check
 * grimtools' devotion data version; `title` null means the build has no usable display name. */
export type FetchBuildResult =
  | { kind: "ok"; skills: string[]; dataVersion: string | null; title: string | null }
  | { kind: "notFound" }
  | { kind: "network" };

/** Outcome of saving a build. `upstream` is grimtools refusing or garbling the save; `network` is
 * everything between the planner and a well-formed worker answer (offline, a worker error, an
 * unexpected shape). */
export type SaveBuildResult =
  | { kind: "ok"; slug: string }
  | { kind: "rateLimited" }
  | { kind: "upstream" }
  | { kind: "network" };

export interface GrimtoolsGateway {
  fetchBuild(slug: string): Promise<FetchBuildResult>;
  /** `skills` are grimtools `sk` ids (see toGrimtoolsSkills), never our star ids. */
  saveBuild(skills: string[]): Promise<SaveBuildResult>;
}
```

`web/src/adapters/grimtoolsWorkerGateway.ts`:

```ts
// ABOUTME: GrimtoolsGateway over our Cloudflare Worker: the only code that knows its URL, routes,
// ABOUTME: contract-version query params and JSON shapes. Maps every HTTP outcome to the port's unions.
import { EXPORT_CONTRACT_VERSION, IMPORT_CONTRACT_VERSION, isSlug } from "../core/grimtools";
import type { FetchBuildResult, GrimtoolsGateway, SaveBuildResult } from "../ports/GrimtoolsGateway";

/**
 * `baseUrl` is the worker's origin with no trailing slash. `fetchImpl` is for tests; the default
 * wraps the global so the call keeps its window binding.
 */
export function makeWorkerGateway(
  baseUrl: string,
  fetchImpl: typeof fetch = (input, init) => fetch(input, init),
): GrimtoolsGateway {
  return {
    async fetchBuild(slug: string): Promise<FetchBuildResult> {
      // `v=${IMPORT_CONTRACT_VERSION}` busts only the *browser's* cache for this URL, and only when
      // the worker's response contract actually changes (unlike buildId, which changes on every
      // deploy - see grimtools.ts for why a shared constant is used instead). The worker
      // deliberately ignores this param when building its own edge-cache key, using the same
      // constant on its own side instead - a caller-supplied value there would let anyone inflate
      // the worker's keyspace.
      let res: Response;
      try {
        res = await fetchImpl(`${baseUrl}/?slug=${encodeURIComponent(slug)}&v=${IMPORT_CONTRACT_VERSION}`);
      } catch {
        return { kind: "network" };
      }
      if (res.status === 404) return { kind: "notFound" };
      if (!res.ok) return { kind: "network" };
      let body: { skills?: unknown; dataVersion?: unknown; title?: unknown };
      try {
        body = (await res.json()) as typeof body;
      } catch {
        return { kind: "network" };
      }
      // Tolerant on purpose: a response served from the worker's 24h edge cache can predate a
      // field entirely, and a bundle can be talking to a worker one deploy ahead of it.
      const skills = Array.isArray(body.skills) ? body.skills.filter((s): s is string => typeof s === "string") : [];
      const dataVersion = typeof body.dataVersion === "string" ? body.dataVersion : null;
      const title = typeof body.title === "string" ? body.title : null;
      return { kind: "ok", skills, dataVersion, title };
    },

    async saveBuild(skills: string[]): Promise<SaveBuildResult> {
      let res: Response;
      try {
        res = await fetchImpl(`${baseUrl}/export?v=${EXPORT_CONTRACT_VERSION}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ skills }),
        });
      } catch {
        return { kind: "network" };
      }
      if (res.status === 429) return { kind: "rateLimited" };
      if (res.status === 502) return { kind: "upstream" };
      if (res.status !== 201) return { kind: "network" };
      let slug: unknown;
      try {
        slug = ((await res.json()) as { slug?: unknown }).slug;
      } catch {
        return { kind: "network" };
      }
      // The worker already validated it; check again here because this string becomes an href.
      if (typeof slug !== "string" || !isSlug(slug)) return { kind: "network" };
      return { kind: "ok", slug };
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `just test test/grimtoolsWorkerGateway.test.ts`
Expected: PASS.

- [ ] **Step 5: Route the existing import through the gateway (behaviour unchanged)**

In `web/src/app/main.ts`:

- Add imports: `import { makeWorkerGateway } from "../adapters/grimtoolsWorkerGateway";` and drop `IMPORT_CONTRACT_VERSION` from the `../core/grimtools` import (the adapter owns it now; keep `mapStars` and `StarTable`).
- Directly after `const importApi = ...` (line 70) add:
  ```ts
  // The one object that talks to the worker, both directions (see ports/GrimtoolsGateway).
  const gateway = makeWorkerGateway(importApi);
  ```
- In `runImport`, replace the block from `let body: {...}` through the closing `catch { return importPanel.setState({ kind: "error", code: "network" }); }` with:
  ```ts
    const result = await gateway.fetchBuild(slug);
    if (result.kind === "notFound") return importPanel.setState({ kind: "error", code: "notFound" });
    if (result.kind === "network") return importPanel.setState({ kind: "error", code: "network" });
    const body = result;
  ```
  The lines that follow (`if (body.dataVersion && body.dataVersion !== tableDataVersion) ...`, `mapStars(body.skills, ...)`, `title: body.title`) keep working unchanged. Delete the now-unused comment about `v=` there (it moved into the adapter). If a `let body: {...}` type comment about an optional `title` remains, delete it too; the port's `title` is `string | null`.

- [ ] **Step 6: Run the gate**

Run: `just typecheck && just test test/importPanel.test.ts test/grimtoolsWorkerGateway.test.ts`
Expected: PASS, and `bunx biome lint` (via `just lint`) reports no unused import.

- [ ] **Step 7: Format and commit**

```bash
just fmt
git add web/src/ports/GrimtoolsGateway.ts web/src/adapters/grimtoolsWorkerGateway.ts web/test/grimtoolsWorkerGateway.test.ts web/src/app/main.ts
git commit -m "refactor(import): GrimtoolsGateway port and worker adapter; import fetch moves behind it"
```

---

### Task 5: Panel: Export button, states, hints, catalog keys, CSS

**Files:**
- Modify: `web/src/adapters/importPanel.ts`
- Modify: `web/src/i18n/app.en.json` and the 12 other `web/src/i18n/app.<locale>.json`
- Modify: `web/test/appCatalog.test.ts` (`REQUIRED` array, after `"ui.import.pruned"`)
- Modify: `web/src/styles.css` (import panel block, ~lines 649-712)
- Test: `web/test/importPanel.test.ts`

**Interfaces:**
- Produces (exported from `importPanel.ts`):
  ```ts
  type ExportDisabledReason = "empty" | "uncapped" | "incomplete";
  type ExportErrorCode = "rateLimited" | "network" | "upstream";
  type ExportState =
    | { kind: "hidden" } | { kind: "disabled"; reason: ExportDisabledReason } | { kind: "ready" }
    | { kind: "exporting" } | { kind: "error"; code: ExportErrorCode };
  interface ImportPanelHandle { setState(s: ImportState): void; setExportState(e: ExportState): void; relocalize(loc: Localization): void; }
  mountImportPanel(el, loc, opts: { onSubmit(slug: string): void; onExport(): void })
  ```
- Catalog keys (en values): `ui.grimtools.label` "grimtools"; `ui.export.submit` "Export to grimtools"; `ui.export.hint.empty` "Select stars to export."; `ui.export.hint.uncapped` "Restore the 55-point limit to export."; `ui.export.hint.incomplete` "Only a complete build can be exported."; `ui.export.exporting` "Exporting..."; `ui.export.err.rateLimited` "Too many exports. Try again in a minute."; `ui.export.err.network` "Could not reach the export service."; `ui.export.err.upstream` "grimtools did not accept the build."; and `ui.import.source` changes to the neutral "grimtools build" (the link is shown after an export too, and after a reload nobody knows which direction produced it).

- [ ] **Step 1: Write the failing tests**

In `web/test/importPanel.test.ts`, extend `mount()`: add `"#export-row": new FakeElement()`, `"#export-go": new FakeElement()`, `"#export-msg": new FakeElement()` to `kids`, add `const exports: number[] = [];` and pass `{ onSubmit: (s) => calls.push(s), onExport: () => exports.push(1) }`, and return `exports` too. Then append:

```ts
test("the heading is the neutral grimtools label, and the import box keeps its own aria-label", () => {
  const { kids } = mount();
  expect(kids["#import-h"].textContent).toBe(enLoc.translate("ui.grimtools.label"));
  expect(kids["#import-input"].getAttribute("aria-label")).toBe(enLoc.translate("ui.import.label"));
});

test("the export button carries the catalog label and starts hidden until a state is given", () => {
  const { kids } = mount();
  expect(kids["#export-go"].textContent).toBe(enLoc.translate("ui.export.submit"));
  expect(kids["#export-row"].hidden).toBe(true);
});

test("each disabled reason disables the button and shows its hint", () => {
  const { handle, kids } = mount();
  for (const reason of ["empty", "uncapped", "incomplete"] as const) {
    handle.setExportState({ kind: "disabled", reason });
    expect(kids["#export-row"].hidden).toBe(false);
    expect(kids["#export-go"].disabled).toBe(true);
    expect(kids["#export-msg"].innerHTML).toBe(enLoc.translate(`ui.export.hint.${reason}`));
  }
});

test("ready enables the button with no hint; clicking it reports an export", () => {
  const { handle, kids, exports } = mount();
  handle.setExportState({ kind: "ready" });
  expect(kids["#export-go"].disabled).toBe(false);
  expect(kids["#export-msg"].innerHTML).toBe("");
  kids["#export-go"].fire("click");
  expect(exports.length).toBe(1);
});

test("exporting disables the button and says so", () => {
  const { handle, kids } = mount();
  handle.setExportState({ kind: "exporting" });
  expect(kids["#export-go"].disabled).toBe(true);
  expect(kids["#export-msg"].innerHTML).toBe(enLoc.translate("ui.export.exporting"));
});

test("each error code keeps the button enabled for a retry and shows its message", () => {
  const { handle, kids } = mount();
  for (const code of ["rateLimited", "network", "upstream"] as const) {
    handle.setExportState({ kind: "error", code });
    expect(kids["#export-go"].disabled).toBe(false);
    expect(kids["#export-msg"].innerHTML).toBe(enLoc.translate(`ui.export.err.${code}`));
  }
});

test("hidden removes the whole export row and clears its message", () => {
  const { handle, kids } = mount();
  handle.setExportState({ kind: "error", code: "network" });
  handle.setExportState({ kind: "hidden" });
  expect(kids["#export-row"].hidden).toBe(true);
  expect(kids["#export-msg"].innerHTML).toBe("");
});

test("the export row is independent of the import state: it can show in both State A and State B", () => {
  const { handle, kids } = mount();
  handle.setExportState({ kind: "ready" });
  handle.setState({ kind: "done", slug: "qNYgbjeV" });
  expect(kids["#export-row"].hidden).toBe(false);
  handle.setState({ kind: "idle" });
  expect(kids["#export-row"].hidden).toBe(false);
});

test("relocalize re-renders the export label and a hint that is currently showing", () => {
  const { handle, kids } = mount();
  handle.setExportState({ kind: "disabled", reason: "incomplete" });
  handle.relocalize({ ...enLoc, translate: (k: string) => `FR:${k}` } as never);
  expect(kids["#export-go"].textContent).toBe("FR:ui.export.submit");
  expect(kids["#export-msg"].innerHTML).toBe("FR:ui.export.hint.incomplete");
});
```

(Check how the existing relocalize test at the end of the file builds its fake localization and mirror it exactly.)

In `web/test/appCatalog.test.ts`, add to `REQUIRED` after `"ui.import.pruned",`:

```ts
  "ui.grimtools.label",
  "ui.export.submit",
  "ui.export.hint.empty",
  "ui.export.hint.uncapped",
  "ui.export.hint.incomplete",
  "ui.export.exporting",
  "ui.export.err.rateLimited",
  "ui.export.err.network",
  "ui.export.err.upstream",
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `just test test/importPanel.test.ts test/appCatalog.test.ts`
Expected: FAIL (`setExportState` is not a function; required keys missing).

- [ ] **Step 3: Add the catalog keys to all 13 locales**

Write a throwaway script outside the repo (your scratchpad directory), for example `add_export_keys.py` with the `uv` shebang, that loads each `web/src/i18n/app.<locale>.json`, sets the keys below, and writes it back with `json.dump(cat, f, ensure_ascii=False, indent=2)` followed by a trailing newline. Run it once, then `just fmt` (Biome owns JSON formatting under `web/src`). Do not commit the script.

Values per locale (`ui.grimtools.label` is `"grimtools"` in every locale):

| key | en | cs | de |
| --- | --- | --- | --- |
| ui.export.submit | Export to grimtools | Exportovat do grimtools | Nach grimtools exportieren |
| ui.export.hint.empty | Select stars to export. | Vyberte hvězdy k exportu. | Wähle Sterne zum Exportieren aus. |
| ui.export.hint.uncapped | Restore the 55-point limit to export. | Pro export obnovte limit 55 bodů. | Stelle das 55-Punkte-Limit wieder her, um zu exportieren. |
| ui.export.hint.incomplete | Only a complete build can be exported. | Exportovat lze jen úplný build. | Nur ein vollständiger Build kann exportiert werden. |
| ui.export.exporting | Exporting... | Exportování... | Wird exportiert... |
| ui.export.err.rateLimited | Too many exports. Try again in a minute. | Příliš mnoho exportů. Zkuste to znovu za minutu. | Zu viele Exporte. Versuche es in einer Minute erneut. |
| ui.export.err.network | Could not reach the export service. | Nepodařilo se spojit se s exportní službou. | Der Export-Dienst konnte nicht erreicht werden. |
| ui.export.err.upstream | grimtools did not accept the build. | grimtools build nepřijal. | grimtools hat den Build nicht angenommen. |
| ui.import.source | grimtools build | Build z grimtools | grimtools-Build |

| key | es | fr | it |
| --- | --- | --- | --- |
| ui.export.submit | Exportar a grimtools | Exporter vers grimtools | Esporta su grimtools |
| ui.export.hint.empty | Selecciona estrellas para exportar. | Sélectionnez des étoiles à exporter. | Seleziona delle stelle da esportare. |
| ui.export.hint.uncapped | Restaura el límite de 55 puntos para exportar. | Rétablissez la limite de 55 points pour exporter. | Ripristina il limite di 55 punti per esportare. |
| ui.export.hint.incomplete | Solo se puede exportar un build completo. | Seul un build complet peut être exporté. | Solo una build completa può essere esportata. |
| ui.export.exporting | Exportando... | Export en cours... | Esportazione in corso... |
| ui.export.err.rateLimited | Demasiadas exportaciones. Inténtalo de nuevo en un minuto. | Trop d'exports. Réessayez dans une minute. | Troppe esportazioni. Riprova tra un minuto. |
| ui.export.err.network | No se pudo contactar con el servicio de exportación. | Impossible de contacter le service d'export. | Impossibile raggiungere il servizio di esportazione. |
| ui.export.err.upstream | grimtools no aceptó el build. | grimtools n'a pas accepté le build. | grimtools non ha accettato la build. |
| ui.import.source | Build de grimtools | Build grimtools | Build grimtools |

| key | ja | ko | pl |
| --- | --- | --- | --- |
| ui.export.submit | grimtoolsにエクスポート | grimtools로 내보내기 | Eksportuj do grimtools |
| ui.export.hint.empty | エクスポートする星を選択してください。 | 내보낼 별을 선택하세요. | Wybierz gwiazdy do eksportu. |
| ui.export.hint.uncapped | エクスポートするには55ポイント上限を復元してください。 | 내보내려면 55포인트 제한을 복원하세요. | Przywróć limit 55 punktów, aby eksportować. |
| ui.export.hint.incomplete | エクスポートできるのは完成したビルドのみです。 | 완성된 빌드만 내보낼 수 있습니다. | Eksportować można tylko kompletny build. |
| ui.export.exporting | エクスポート中... | 내보내는 중... | Eksportowanie... |
| ui.export.err.rateLimited | エクスポートが多すぎます。1分後にもう一度お試しください。 | 내보내기가 너무 많습니다. 1분 후에 다시 시도하세요. | Zbyt wiele eksportów. Spróbuj ponownie za minutę. |
| ui.export.err.network | エクスポートサービスに接続できませんでした。 | 내보내기 서비스에 연결할 수 없습니다. | Nie udało się połączyć z usługą eksportu. |
| ui.export.err.upstream | grimtoolsがビルドを受け付けませんでした。 | grimtools가 빌드를 받아들이지 않았습니다. | grimtools nie przyjął builda. |
| ui.import.source | grimtoolsのビルド | grimtools 빌드 | Build z grimtools |

| key | pt | ru | vi | zh |
| --- | --- | --- | --- | --- |
| ui.export.submit | Exportar para o grimtools | Экспортировать в grimtools | Xuất sang grimtools | 导出到grimtools |
| ui.export.hint.empty | Selecione estrelas para exportar. | Выберите звёзды для экспорта. | Chọn các ngôi sao để xuất. | 选择要导出的星星。 |
| ui.export.hint.uncapped | Restaure o limite de 55 pontos para exportar. | Восстановите лимит в 55 очков, чтобы экспортировать. | Khôi phục giới hạn 55 điểm để xuất. | 恢复55点上限后才能导出。 |
| ui.export.hint.incomplete | Só uma build completa pode ser exportada. | Экспортировать можно только завершённый билд. | Chỉ có thể xuất bản dựng hoàn chỉnh. | 只能导出完整的构筑。 |
| ui.export.exporting | Exportando... | Экспорт... | Đang xuất... | 正在导出... |
| ui.export.err.rateLimited | Exportações demais. Tente novamente em um minuto. | Слишком много экспортов. Попробуйте снова через минуту. | Xuất quá nhiều lần. Hãy thử lại sau một phút. | 导出次数过多。请一分钟后重试。 |
| ui.export.err.network | Não foi possível acessar o serviço de exportação. | Не удалось подключиться к сервису экспорта. | Không thể kết nối với dịch vụ xuất. | 无法连接导出服务。 |
| ui.export.err.upstream | O grimtools não aceitou a build. | grimtools не принял билд. | grimtools không chấp nhận bản dựng. | grimtools未接受该构筑。 |
| ui.import.source | Build do grimtools | Билд grimtools | Bản dựng grimtools | grimtools构筑 |

- [ ] **Step 4: Implement the panel**

In `web/src/adapters/importPanel.ts`:

1. Types, after `ImportState`:

```ts
export type ExportDisabledReason = "empty" | "uncapped" | "incomplete";
export type ExportErrorCode = "rateLimited" | "network" | "upstream";

/** The Export button, independent of the import state (see the spec's panel table). `hidden` is
 * "the link already is the export": the current selection matches the associated build. */
export type ExportState =
  | { kind: "hidden" }
  | { kind: "disabled"; reason: ExportDisabledReason }
  | { kind: "ready" }
  | { kind: "exporting" }
  | { kind: "error"; code: ExportErrorCode };
```

2. `ImportPanelHandle` gains `setExportState(e: ExportState): void;`. `mountImportPanel`'s `opts` becomes `{ onSubmit(slug: string): void; onExport(): void }`.

3. State: add `let exportState: ExportState = { kind: "hidden" };` beside `state`.

4. Markup: the `el.innerHTML` string gains, after the import row's closing `</div>` and its `#import-msg` div:

```ts
    `<div class="import-row" id="export-row" hidden>` +
    `<button id="export-go" type="button"></button>` +
    `</div><div id="export-msg" aria-live="polite"></div>`;
```

and three more lookups: `exportRow` (`#export-row`), `exportGo` (`#export-go` as `HTMLButtonElement`), `exportMsg` (`#export-msg`).

5. `applyChrome()`: heading becomes `localization.translate("ui.grimtools.label")` (the input's placeholder and aria-label keep `ui.import.*`), plus `exportGo.textContent = localization.translate("ui.export.submit");`.

6. Add `paintExport()` and call it from `setExportState`, `relocalize`, and once after `paint()` at mount:

```ts
  // The export row is its own state machine: it shows in State A and State B alike, and only
  // `hidden` removes it (the associated link already is the export). Messages go through
  // innerHTML for the same reason #import-msg does.
  function paintExport() {
    const hidden = exportState.kind === "hidden";
    exportRow.hidden = hidden;
    if (hidden) {
      exportMsg.innerHTML = "";
      return;
    }
    exportGo.disabled = exportState.kind === "disabled" || exportState.kind === "exporting";
    if (exportState.kind === "disabled") exportMsg.innerHTML = localization.translate(`ui.export.hint.${exportState.reason}`);
    else if (exportState.kind === "exporting") exportMsg.innerHTML = localization.translate("ui.export.exporting");
    else if (exportState.kind === "error") exportMsg.innerHTML = localization.translate(`ui.export.err.${exportState.code}`);
    else exportMsg.innerHTML = "";
  }
```

7. Wire the click: `exportGo.addEventListener("click", () => opts.onExport());`.

8. The returned handle gains:

```ts
    setExportState(e) {
      exportState = e;
      paintExport();
    },
```

and `relocalize` calls `paintExport()` after `paint()`.

9. Update the ABOUTME lines:
```ts
// ABOUTME: DOM adapter for the grimtools panel: the import box with its status line and source link,
// ABOUTME: and the Export button with its own state and hint. Mounted once, mirroring searchPanel.ts.
```

10. `web/src/styles.css`, in the import panel block: add `#export-go` to the two selector lists that style `#import-go, #import-clear` (base and `:hover`), add `#export-go` to the `#import-go:disabled` rule, and append:

```css
#export-row {
  margin-top: 0.35rem;
}
#export-go {
  flex: 1;
}
#export-msg {
  margin-top: 0.35rem;
  color: #9aa4b2;
  font-size: 0.75rem;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `just test test/importPanel.test.ts test/appCatalog.test.ts test/i18nCharacterization.test.ts && just typecheck`
Expected: PASS. (`main.ts` does not compile until it passes `onExport`; if `just typecheck` complains there, add a temporary `onExport: () => {}` to the `mountImportPanel` call in `main.ts`, which Task 6 replaces.)

- [ ] **Step 6: Format and commit**

```bash
just fmt
git add web/src/adapters/importPanel.ts web/src/i18n/*.json web/test/appCatalog.test.ts web/test/importPanel.test.ts web/src/styles.css web/src/app/main.ts
git commit -m "feat(panel): Export to grimtools button with disabled/exporting/error states, in 13 locales"
```

---

### Task 6: Controller: session memo, export flow, refresh integration, end-to-end check

**Files:**
- Modify: `web/src/app/main.ts` (imports; the memo and export flow next to `runImport`, ~lines 908-978; `refresh` at ~789; `syncImportPanel` at ~974)

**Interfaces:**
- Consumes: `gateway.saveBuild` (Task 4), `invertStarTable`, `toGrimtoolsSkills` (Task 1), `reach.legal` (Task 2), `importPanel.setExportState` and `ExportState`/`ExportErrorCode` (Task 5).
- Produces: the shipped behaviour; no new exports.

- [ ] **Step 1: Add the memo and export state next to the import wiring**

In `web/src/app/main.ts` add to the imports: `invertStarTable, toGrimtoolsSkills` from `../core/grimtools`, and `type ExportErrorCode, type ExportState` from `../adapters/importPanel`.

Above `runImport`, add:

```ts
  // Star sets behind builds this session imported cleanly or exported, keyed by selectionKey, so an
  // unchanged selection shows its existing link instead of minting a duplicate grimtools build.
  // Session-only on purpose: a restored gt= carries no star set to compare against, and there is no
  // way to ask grimtools whether a build matches. Clear (the panel's ✕) leaves this intact, so
  // returning to that exact selection re-associates it.
  const knownBuilds = new Map<string, string>();
  function selectionKey(sel: Set<string>): string {
    return [...sel].sort().join(",");
  }
  // The selection key at the last refresh: the memo is consulted only when the key changes, so a
  // cleared association stays cleared until the selection actually moves.
  let lastSelectionKey: string | null = null;
  // In-flight and failed exports, pinned to the selection they were made from: a change of selection
  // supersedes both, and a result that arrives after such a change never re-associates the wrong set.
  let exportingKey: string | null = null;
  let exportError: { key: string; code: ExportErrorCode } | null = null;
  // The inverse mapping table, built once from the same file the import loads.
  let inverseTable: Record<string, string> | null = null;

  // The Export button's state for the current selection, in the spec's precedence: hidden (the link
  // already is the export), then the three disabled reasons, then in-flight and error, then ready.
  function exportStateFor(): ExportState {
    const key = selectionKey(state.selected);
    if (source && knownBuilds.get(key) === source) return { kind: "hidden" };
    if (state.selected.size === 0) return { kind: "disabled", reason: "empty" };
    if (!Number.isFinite(state.pointCap)) return { kind: "disabled", reason: "uncapped" };
    if (!reach.legal) return { kind: "disabled", reason: "incomplete" };
    if (exportingKey === key) return { kind: "exporting" };
    if (exportError && exportError.key === key) return { kind: "error", code: exportError.code };
    return { kind: "ready" };
  }
```

- [ ] **Step 2: Memoize clean imports**

In `runImport`, right after `source = slug;` and before `importPanel.setState({ kind: "done", ... })`, add:

```ts
    // A pruned import is a build the planner does not show as grimtools does, so it is not memoized;
    // Export stays offered for it.
    if (pruned === 0) knownBuilds.set(selectionKey(state.selected), slug);
```

- [ ] **Step 3: Add the export flow**

After `runImport`, add:

```ts
  async function runExport(): Promise<void> {
    const key = selectionKey(state.selected);
    const starIdTable = await loadStarTable();
    if (!starIdTable) {
      // loadStarTable already warned with the real cause; "network" is the same stand-in import uses.
      exportError = { key, code: "network" };
      return syncImportPanel();
    }
    try {
      inverseTable ??= invertStarTable(starIdTable);
    } catch (e) {
      console.warn("export unavailable: grimtools-stars.json does not invert cleanly", e);
      exportError = { key, code: "network" };
      return syncImportPanel();
    }
    const skills = toGrimtoolsSkills(state.selected, inverseTable);
    if (!skills) {
      // Cannot happen with a table that passed its generation gates; a bug report, not a user state.
      const missing = [...state.selected].filter((s) => inverseTable![s] === undefined);
      console.warn(`export: selected star(s) missing from grimtools-stars.json: ${missing.join(", ")}`);
      exportError = { key, code: "network" };
      return syncImportPanel();
    }
    exportingKey = key;
    exportError = null;
    syncImportPanel();
    const result = await gateway.saveBuild(skills);
    exportingKey = null;
    if (result.kind !== "ok") {
      exportError = { key, code: result.kind };
      return syncImportPanel();
    }
    knownBuilds.set(key, result.slug);
    // The selection may have moved on while the request was in flight: only the selection the build
    // was made from becomes associated with it (a later return to that set re-associates via the memo).
    if (selectionKey(state.selected) === key) {
      source = result.slug;
      writeHash("push"); // like import: Back returns to the un-associated state
    }
    syncImportPanel();
  }
```

- [ ] **Step 4: Wire the panel and the refresh**

- The `mountImportPanel(...)` call gets `onExport: () => void runExport(),` beside `onSubmit` (replacing any temporary stub from Task 5).
- `syncImportPanel` becomes:

```ts
  // Reflects `source` and the export state into the panel: at mount, on every hashchange, on every
  // refresh (the export state depends on legality and the memo), and around an export request.
  function syncImportPanel(): void {
    importPanel.setState(source ? { kind: "done", slug: source } : { kind: "idle" });
    importPanel.setExportState(exportStateFor());
  }
```

- In `refresh`, right after the `if (table && Number.isFinite(state.pointCap)) { ... } else { ... }` block that sets `reach` (before `document.body.classList.toggle("comparing", ...)`), add:

```ts
    // The memo is consulted only when the selection actually changes (see lastSelectionKey): a
    // returning selection re-associates its build, and a stale export error is dropped.
    const key = selectionKey(state.selected);
    if (key !== lastSelectionKey) {
      lastSelectionKey = key;
      const known = knownBuilds.get(key);
      if (known !== undefined) source = known;
      if (exportError && exportError.key !== key) exportError = null;
    }
    syncImportPanel();
```

`syncImportPanel` and `importPanel` are declared later in `boot()` than `refresh`, but `refresh` is first invoked after both exist (the boot render at the end of `boot()`), so this is safe; the existing `hashchange` handler already relies on the same ordering.

- [ ] **Step 5: Type-check, run the whole suite**

Run: `just typecheck && just test`
Expected: PASS.

- [ ] **Step 6: End-to-end check against the real worker and grimtools**

1. `worker/.dev.vars` must contain `ALLOWED_ORIGIN=http://localhost:5173`. Start `just worker-dev` in the background, then `just serve` (port 5173) in the background.
2. Open `http://localhost:5173/#p=55&s=AAAAgAQAAMADwAMAAAAAAMADAAAAAAAAAIA_AAAAwA8A4AcAAAAAAPADAAA_AD4` (the Lion/Dryad forum build: 50 points, Order short by 2). Expected: the export row shows a disabled button with "Only a complete build can be exported."
3. Complete Lion (click its three stars). Expected: the button enables with no hint. Toggle the cap to ∞ and back: the hint "Restore the 55-point limit to export." appears and clears. Clear the selection: "Select stars to export."
4. Rebuild the Lion-completed selection and press Export. Expected: "Exporting..." then the panel switches to the link state ("grimtools build" + ✕) with `gt=<slug>` in the hash and the export row hidden. Copy the link.
5. Open the grimtools link in a browser (playwright-cli is fine), open the devotion window (skills HUD icon, then the Devotion tab) and confirm the same constellations are lit: 53 points spent, Points Available 2.
6. Toggle one star off: the export row reappears (button enabled). Toggle it back on: the row hides again and the same slug is shown (memo). Press ✕: link gone, export button shown; change a star and change it back: the link comes back.
7. Press Back: the association drops (no `gt=`), the selection is unchanged. Forward: it returns.
8. Do not exercise the rate limit by hand: every export creates a real build on grimtools. The limiter logic is covered by the fake-limiter unit tests, and the bindings' presence by the `just worker-dev` banner (`env.EXPORT_LIMITER_IP (5 requests/60s)`, `env.EXPORT_LIMITER_GLOBAL (60 requests/60s)`).
9. Stop both servers. Report the slug(s) created (throwaway anonymous builds; expect one or two).

- [ ] **Step 7: Format and commit**

```bash
just fmt
git add web/src/app/main.ts
git commit -m "feat(export): one-click export of the selection to a fresh grimtools build, with session memo"
```

---

### Task 7: Docs, README, onboarding, backlog

**Files:**
- Modify: `docs/grimtools-import.md`
- Modify: `worker/README.md`
- Modify: `ONBOARDING.md` (the three `just` lines mentioning "Grimtools import worker", ~lines 42-44, and the line 13 mention)
- Modify: `BACKLOG.md` (the "Grimtools import: deferred follow-ups" section near line 8)

- [ ] **Step 1: Extend `docs/grimtools-import.md`**

Change the title to `# Importing and exporting devotions with grimtools`, keep everything that is there, and add these sections after "## The planner" (before "## Running it locally"):

```markdown
## Exporting a selection to a fresh grimtools build

The reverse direction: one button saves the current selection as a new anonymous
grimtools build and makes it the associated build (the link-plus-clear state, and
`gt=<slug>` in the hash). The design record is
[docs/superpowers/specs/2026-08-16-grimtools-export-design.md](superpowers/specs/2026-08-16-grimtools-export-design.md).

**Grimtools saves a build in one POST.** Its calculator is entirely client-side;
Share serializes the whole build and posts it to `save_build.php`, which returns the
slug. No login or token is involved and a non-browser client is accepted, so the
worker relays it. Builds are immutable: every save mints a new slug.

**The planner maps, the worker relays.** The planner inverts the same
`data/grimtools-stars.json` it uses for import (`invertStarTable`,
`toGrimtoolsSkills` in `web/src/core/grimtools.ts`) and posts `{ skills: ["sk739",
...] }` to `POST /export`. The worker validates shape (1 to 55 distinct `sk<digits>`
ids, a 4 KB body cap, our origin), rate-limits (5 per minute per address and 60 per
minute overall, via Workers rate-limit bindings), builds the payload with the shared
`savePayload` (the exact shape the calculator's Share button posts, at level 100 with
`devotionPoints` counting down from 55), posts it to the constant
`https://www.grimtools.com/save_build.php`, and returns the re-validated slug as
`{ slug }` with status 201. Errors: 400 `bad_request`, 403 `forbidden`, 429
`rate_limited`, 502 `upstream` or `unparseable`. Nothing is cached.

**Only a complete build can be exported.** Export is disabled, with a one-line hint,
for an empty selection, for the uncapped point mode, and for any selection the engine
does not classify as a legal build within 55 points (`ReachView.legal`); grimtools
models what the game allows and would render stars the game cannot grant.

**An unchanged selection is not exported twice, within a session.** The planner keeps
a memo of the star sets behind builds it imported cleanly (nothing pruned) or
exported; when the current selection matches one, the panel shows that build's link
and hides Export, and returning to a memoized set re-associates it. A reloaded link
restores `gt=` but not the memo, so Export is offered again there.

Both directions go through the `GrimtoolsGateway` port
(`web/src/ports/GrimtoolsGateway.ts`); `web/src/adapters/grimtoolsWorkerGateway.ts` is
the only code that knows the worker's URL, routes and JSON shapes.
```

Also, in "## The three pieces", change the worker sentence to "**A Cloudflare Worker** (`worker/`) that fetches a build by slug and returns its skill ids, and that saves a list of skill ids as a fresh build. It holds no game knowledge." In "## Changing things", after the response-shape paragraph, add: "The export route has its own `EXPORT_CONTRACT_VERSION` beside it, pinned by the same test file." In "## Known limits", add "- Export covers devotions only: the saved build is a fresh level-100 character with no masteries or gear." and "- Duplicate-export detection is per session; a reloaded link offers Export again."

- [ ] **Step 2: Update `worker/README.md`**

Change the first heading's paragraph to mention both directions, and add after the import contract paragraph:

```markdown
Export contract: `POST /export?v=<contract version>` with JSON body
`{ skills: ["sk739", ...] }` (1 to 55 distinct `sk<digits>` ids, at most 4 KB, `Origin`
equal to `ALLOWED_ORIGIN`) returns `201 { slug }`. The worker posts the build to
grimtools' `save_build.php` in the shape the calculator's own Share button uses (see
`savePayload` in `web/src/core/grimtools.ts`) and hands back the re-validated slug.
Errors: `400 bad_request`, `403 forbidden`, `429 rate_limited`, `502 upstream` (grimtools
failed, redirected, or timed out) or `502 unparseable` (grimtools answered without a valid
id). Never cached. Rate limits are the two `[[ratelimits]]` bindings in `wrangler.toml`
(per address and global); `wrangler dev --local` simulates them, and the handler treats
an absent binding as unlimited so tests need no runtime.
```

In "## Slug, never a URL", add one sentence: "The export route is the same: the save URL is a constant and the only caller-controlled bytes are validated skill ids inside the JSON `data` field."

- [ ] **Step 3: Update `ONBOARDING.md`**

Where it says "Grimtools import worker" in the `just` lines (local dev, deploy, token setup) and in the line-13 description of the worker's role, say "grimtools import/export worker" and "fetch a grimtools build past its CORS header, and save one, for the devotion planner's import and export". Keep each edit to the phrase; do not restructure the file.

- [ ] **Step 4: Update `BACKLOG.md`**

Under "## Grimtools import: deferred follow-ups", rename the heading to "## Grimtools import/export: deferred follow-ups" and add:

```markdown
- Export: cross-session duplicate detection is impossible without a way to read a
  build's stars back and compare; if it ever matters, the worker's `GET /` already
  returns them, so "compare on demand when a `gt=` link is restored" is one fetch
  (`web/src/app/main.ts` `knownBuilds`).
- Export: the payload is a fresh level-100 character. If grimtools changes its
  Share defaults (`bio` numbers), update `savePayload`'s fixture test from a fresh
  capture (spec 2026-08-16, "What the investigation established").
- Export: the rate limits (5/min per address, 60/min global) are guesses; revisit
  from worker analytics if real users hit them.
```

- [ ] **Step 5: Run the gate and commit**

Run: `just check`
Expected: PASS.

```bash
git add docs/grimtools-import.md worker/README.md ONBOARDING.md BACKLOG.md
git commit -m "docs: grimtools export: how it works, worker contract, onboarding and backlog"
```

---

## Deploy notes (for the merge, not a task)

Merging to `main` triggers `deploy-worker.yml` (paths `worker/**`, `web/src/core/grimtools.ts`) and the Pages deploy. The worker deploy creates the two rate-limit bindings; confirm the deploy log lists them. After both deploys, repeat Task 6 step 4-5 once against the live site and report the slug.
