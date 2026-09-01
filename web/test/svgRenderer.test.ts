// ABOUTME: Unit tests for the pure renderSvgMarkup function in the SVG renderer adapter.
// ABOUTME: Verifies star class assignment and art layer suppression without DOM dependencies.
import { test, expect } from "bun:test";
import doc from "../../data/devotions.json";
import { buildModel } from "../src/core/model";
import { renderSvgMarkup } from "../src/adapters/svgRenderer";
import type { ReachView } from "../src/core/reachability";
import { AFFINITIES } from "../src/core/types";
import { glowColor, presentAffinities } from "../src/adapters/affinityColors";
import { markStyle } from "../src/adapters/markPalette";

const model = buildModel(doc as any);
// Shared manifest covering every constellation's art, for the search-halo tests below (they need
// more than one constellation's art present at once to tell a matched one from an unmatched one).
const manifest = {
  images: Object.fromEntries(
    [...model.constellations.values()]
      .filter((c) => c.background?.image)
      .map((c) => [c.background!.image!.split("/").pop()!, { url: "art.webp", w: 64, h: 64 }]),
  ),
};

test("marks selected and selectable stars with classes and ids", () => {
  const markup = renderSvgMarkup(
    model,
    { selected: new Set(["crossroads_eldritch:0"]), pointCap: 55 },
    { manifest: null },
  );
  // The large hit target carries the id + state; the visible dot carries the matching star class.
  expect(markup).toContain('data-star-id="crossroads_eldritch:0" class="hit selected"');
  expect(markup).toContain('class="star selected"');
  // bat:0 becomes selectable once eldritch is satisfied
  expect(markup).toContain('data-star-id="bat:0" class="hit selectable"');
});

test("omits the art layer when no manifest", () => {
  const markup = renderSvgMarkup(model, { selected: new Set(), pointCap: 55 }, { manifest: null });
  expect(markup).not.toContain("<image");
});

test("no longer emits per-constellation hit rects (hover is resolved in JS)", () => {
  const markup = renderSvgMarkup(model, { selected: new Set(), pointCap: 55 }, { manifest: null });
  expect(markup).not.toContain("con-hit");
});

test("defines a per-constellation gradient and stars reference it", () => {
  const markup = renderSvgMarkup(model, { selected: new Set(), pointCap: 55 }, { manifest: null });
  // gradient def exists even without a manifest, and stars paint with it
  expect(markup).toContain('<linearGradient id="grad-falcon"');
  expect(markup).toContain("--grad:url(#grad-falcon)");
  // assassin's blade requires order but GRANTS ascendant + order -> its gradient is the
  // granted colors (purple -> gold), not the order-only requirement color.
  expect(markup).toContain(
    '<linearGradient id="grad-assassin_s_blade" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#b06fd6"/><stop offset="100%" stop-color="#e6c34d"/>',
  );
});

test("renders the art <image> at the manifest's native width/height", () => {
  // The image must be drawn at native texture size so art aligns with the star
  // coordinate space regardless of how much the file itself was downscaled.
  const c = [...model.constellations.values()].find((c) => c.background?.image && c.background.x != null)!;
  const name = c.background!.image!.split("/").pop()!;
  const manifest = { images: { [name]: { url: "art.webp", w: 640, h: 480 } } };
  const markup = renderSvgMarkup(model, { selected: new Set(), pointCap: 55 }, { manifest });
  expect(markup).toContain('<image href="art.webp"');
  expect(markup).toContain('width="640" height="480"');
  expect(markup).toContain(`x="${c.background!.x}" y="${c.background!.y}"`);
});

test("renders celestial-power stars as diamonds (polygon)", () => {
  const markup = renderSvgMarkup(model, { selected: new Set(), pointCap: 55 }, { manifest: null });
  // bat:4 is the "Twin Fangs" celestial power star; non-power stars stay circles.
  expect(markup).toContain('<polygon class="star');
});

test("a fully-selected constellation's art gets the 'active' class; a partial one does not", () => {
  const withArt = [...model.constellations.values()].find(
    (c) => c.background?.image && c.background.x != null && c.starIds.length >= 2,
  )!;
  const name = withArt.background!.image!.split("/").pop()!;
  const manifest = { images: { [name]: { url: "art.webp", w: 640, h: 480 } } };

  // All stars selected -> the constellation is active; its art glows via the #self-glow-art SVG filter,
  // applied by the .art.active CSS rule (which references this def).
  const full = renderSvgMarkup(model, { selected: new Set(withArt.starIds), pointCap: 55 }, { manifest });
  expect(full).toMatch(new RegExp(`class="art active"[^>]*data-con-id="${withArt.id}"`));
  expect(full).toContain('<filter id="self-glow-art"'); // the active-art glow filter is defined

  // Only the first star selected (a partial pick) -> NOT active (no glow class).
  const partial = renderSvgMarkup(model, { selected: new Set([withArt.starIds[0]!]), pointCap: 55 }, { manifest });
  expect(partial).not.toMatch(new RegExp(`class="art[^"]*active"[^>]*data-con-id="${withArt.id}"`));
});

test("immediacy state: a clickable star is selectable, an unreachable one is locked", () => {
  const ids = [...model.constellations.keys()];
  // ids[0]=akeron_s_scorpion, ids[1]=anvil, ids[2]=assassin_s_blade
  const reach: ReachView = {
    completable: new Set([ids[0]!]),
    reachableStars: new Set<string>(),
    legal: true,
    have: [0, 0, 0, 0, 0],
    need: [0, 0, 0, 0, 0],
    needSource: new Map(),
  };
  // Make the first star of ids[1] clickable so it is "startable but not completable"
  const firstStar = model.constellations.get(ids[1]!)!.starIds[0]!;
  reach.reachableStars.add(firstStar);

  const svg = renderSvgMarkup(model, { selected: new Set(), pointCap: 55 }, { manifest: null, reach });

  // The clickable star renders with class "selectable"
  expect(svg).toMatch(/class="(star|hit) [^"]*selectable/);

  // ids[2] is not completable and has no reachable stars -> its data-con-id should appear (it is rendered),
  // and when a manifest is present its art gets "unreachable". Without a manifest we verify the star
  // is "locked" (not selectable) since no star of ids[2] is in reach.reachableStars.
  expect(svg).toContain(`data-star-id="${ids[2]!}:0" class="hit locked"`);

  // ids[0] is completable -> its first star is also locked (no predecessors met), but the
  // constellation itself is not unreachable; let's verify ids[1]'s firstStar is "selectable".
  expect(svg).toContain(`data-star-id="${firstStar}" class="hit selectable"`);
});

test("brightness as opacity on art: a completable constellation is at the attainable opacity", () => {
  const ids = [...model.constellations.keys()];
  // Find a constellation with art
  const withArt = [...model.constellations.values()].find((c) => c.background?.image && c.background.x != null)!;
  const withArtId = withArt.id;
  const name = withArt.background!.image!.split("/").pop()!;
  const manifest = { images: { [name]: { url: "art.webp", w: 640, h: 480 } } };

  // withArtId is completable; pick a different constellation as the unattainable one
  const otherId = ids.find((id) => id !== withArtId)!;

  const reach: ReachView = {
    completable: new Set([withArtId]),
    reachableStars: new Set<string>(),
    legal: true,
    have: [0, 0, 0, 0, 0],
    need: [0, 0, 0, 0, 0],
    needSource: new Map(),
  };

  const svg = renderSvgMarkup(model, { selected: new Set(), pointCap: 55 }, { manifest, reach });

  // A completable (attainable) constellation's art renders at the attainable opacity, not the dimmer
  // unattainable one - brightness is the inline opacity attribute, no dim class.
  expect(svg).toMatch(new RegExp(`class="art" opacity="0\\.5" data-con-id="${withArtId}"`));

  // otherId has no reachable stars -> unattainable; its first star is locked.
  if (model.constellations.get(otherId)!.starIds[0]) {
    expect(svg).toContain(`data-star-id="${otherId}:0" class="hit locked"`);
  }
});

test("a link between two selected stars gets the 'taken' class (the rest stay plain)", () => {
  const child = [...model.stars.values()].find((s) => s.predecessors.length > 0)!;
  const parent = child.predecessors[0]!;
  const both = renderSvgMarkup(model, { selected: new Set([child.id, parent]), pointCap: 55 }, { manifest: null });
  expect(both).toContain('class="link taken"');
  // With only one endpoint selected the connecting link stays plain.
  const one = renderSvgMarkup(model, { selected: new Set([parent]), pointCap: 55 }, { manifest: null });
  expect(one).not.toContain('class="link taken"');
});

test("stars and links in an unattainable constellation carry the unattainable opacity", () => {
  const dimCon = [...model.constellations.values()].find((c) =>
    c.starIds.some((id) => (model.stars.get(id)?.predecessors.length ?? 0) > 0),
  )!;
  const reach: ReachView = {
    completable: new Set([...model.constellations.keys()].filter((id) => id !== dimCon.id)),
    reachableStars: new Set<string>(),
    legal: true,
    have: [0, 0, 0, 0, 0],
    need: [0, 0, 0, 0, 0],
    needSource: new Map(),
  };
  const svg = renderSvgMarkup(model, { selected: new Set(), pointCap: 55 }, { manifest: null, reach });
  expect(svg).toMatch(/class="link"[^>]*opacity="0.3"/);
});

test("compare diff marks added stars cmp-add and removed stars cmp-rm", () => {
  const added = "crossroads_eldritch:0";
  const removed = "bat:0";
  const markup = renderSvgMarkup(
    model,
    { selected: new Set([added]), pointCap: 55 },
    { manifest: null, diff: { added: new Set([added]), removed: new Set([removed]) } },
  );
  // the added star is selected -> selected marker + cmp-add; the removed star is unselected + cmp-rm
  expect(markup).toContain("cmp-add");
  expect(markup).toContain("cmp-rm");
});

test("no affinity filter leaves no mute", () => {
  const markup = renderSvgMarkup(model, { selected: new Set(), pointCap: 55 }, { manifest: null });
  expect(markup).not.toContain("mute");
});

// Star marks as main.ts builds them: the palette style for a slot plus the star's weight for the search.
const mark = (slot: number, weight = 0) => ({ style: markStyle(slot), weight, slot });
const noSel = { selected: new Set<string>(), pointCap: 55 };
// A star's rendered centre, read back from its hit target.
function centerOf(markup: string, star: string): { cx: number; cy: number } {
  const m = markup.match(new RegExp(`data-star-id="${star}"[^>]*cx="(-?[\\d.]+)" cy="(-?[\\d.]+)"`))!;
  return { cx: Number(m[1]), cy: Number(m[2]) };
}
// The one star's marks layer: the track circle plus one <g class="search-arc"> per search.
const arcsOf = (markup: string) => markup.match(/<g class="search-arcs">.*?<\/g><\/g>/)![0];
// Each arc group's slot and angular extent (degrees clockwise from up), in markup order.
const arcSpans = (arcs: string) =>
  [...arcs.matchAll(/<g class="search-arc" data-slot="(-?\d+)" data-from="(-?[\d.]+)" data-to="(-?[\d.]+)">/g)].map(
    (m) => ({ slot: Number(m[1]), from: Number(m[2]), to: Number(m[3]) }),
  );
const arcOf = (arcs: string, slot: number) =>
  arcs.match(new RegExp(`<g class="search-arc" data-slot="${slot}"[^>]*>.*?</g>`))![0];

test("an affinity filter mutes non-matching constellations; search arcs in a matching con stay un-muted", () => {
  // crossroads_eldritch GRANTS eldritch, so under an eldritch filter its constellation matches: the
  // marked star is identity (not muted) and its arcs layer is NOT mute-wrapped.
  const matchStar = "crossroads_eldritch:0";
  const markup = renderSvgMarkup(model, noSel, {
    manifest: null,
    affinityFilter: { grants: new Set(["eldritch"]), requires: new Set() },
    marks: new Map([[matchStar, [mark(0)]]]),
  });
  expect(markup).toContain('class="star selectable"'); // the matched star's dot is identity (not muted)
  expect(markup).toContain('<g class="search-arcs">'); // arc emphasis is a separate layer
  expect(markup).not.toContain('<g filter="url(#mute-wide)"'); // a matching con's arcs are never mute-wrapped
  expect(markup).toContain(' mute"'); // non-matching stars get mute
  expect(markup).toContain('class="link mute"'); // links get mute
});

test("search arcs in an off-affinity constellation: muted dot AND mute-wrapped arcs", () => {
  // A constellation that does NOT grant the filtered affinity, so it fails the filter (non-matching).
  const offCon = [...model.constellations.values()].find((c) => (c.affinityBonus.chaos ?? 0) === 0)!;
  const markStar = offCon.starIds[0]!;
  const markup = renderSvgMarkup(model, noSel, {
    manifest: null,
    affinityFilter: { grants: new Set(["chaos"]), requires: new Set() },
    marks: new Map([[markStar, [mark(0)]]]),
  });
  // Two independent channels both fire: the dot desaturates (mute) AND the arcs are wrapped in
  // #mute-wide so the whole emphasis greys, reading as "search match, off the affinity filter".
  expect(markup).toContain('<g filter="url(#mute-wide)"><g class="search-arcs">');
  expect(markup).toMatch(/class="star [^"]*mute[^"]*"/); // the dot itself carries mute too
});

test("a single-search match draws a track and a half ring centred on that search's angle, in its color", () => {
  const star = "crossroads_eldritch:0";
  const markup = renderSvgMarkup(model, noSel, { manifest: null, marks: new Map([[star, [mark(1)]]]) });
  const { cx, cy } = centerOf(markup, star);
  const arcs = arcsOf(markup);
  expect(arcs).toContain(`<circle class="arc-track" cx="${cx}" cy="${cy}" r="23"/>`); // STAR_RADIUS 12 + 11
  // Slot 1 is east (90 degrees): alone, its half ring runs the whole right side, 0 to 180.
  expect(arcSpans(arcs)).toEqual([{ slot: 1, from: 0, to: 180 }]);
  const arc = arcOf(arcs, 1);
  // A dark outline path under the colored arc, both on the base ring radius at base width.
  expect(arc).toMatch(
    /<path class="arc-outline" d="M [^"]*A 23 23 0 0 1 [^"]*" stroke-width="12"\/><path class="arc" d="M [^"]*A 23 23 0 0 1 [^"]*" stroke="#3ee6d8" stroke-width="8"\/>/,
  );
  expect(markStyle(1).color).toBe("#3ee6d8");
});

test("a star's arcs are painted under its dot, so a neighbouring dot stays on top of a wide arc", () => {
  const star = "crossroads_eldritch:0";
  const markup = renderSvgMarkup(model, noSel, { manifest: null, marks: new Map([[star, [mark(0)]]]) });
  const { cx, cy } = centerOf(markup, star);
  const hit = markup.indexOf(`data-star-id="${star}"`);
  const arcs = markup.indexOf('<g class="search-arcs">');
  const dot = markup.indexOf(`<circle class="star selectable" opacity="1" cx="${cx}" cy="${cy}"`);
  expect(hit).toBeGreaterThan(-1);
  expect(dot).toBeGreaterThan(-1);
  expect(arcs).toBeGreaterThan(hit);
  expect(dot).toBeGreaterThan(arcs);
});

test("two opposite searches each keep their half, parted by a seam of 3 degrees a side", () => {
  const star = "crossroads_eldritch:0";
  // Slots 1 and 2 are east and west.
  const markup = renderSvgMarkup(model, noSel, { manifest: null, marks: new Map([[star, [mark(2), mark(1)]]]) });
  const arcs = arcsOf(markup);
  expect(arcs.match(/<circle class="arc-track"/g)!.length).toBe(1); // one track per star, not per arc
  expect(arcSpans(arcs)).toEqual([
    { slot: 1, from: 3, to: 177 },
    { slot: 2, from: 183, to: 357 },
  ]);
});

test("two searches 45 degrees apart split their overlap at the bisector, each keeping its far side", () => {
  const star = "crossroads_eldritch:0";
  // Slot 2 is west (270), slot 4 southwest (225): the bisector is 247.5, minus the seam each side.
  const markup = renderSvgMarkup(model, noSel, { manifest: null, marks: new Map([[star, [mark(2), mark(4)]]]) });
  const spans = arcSpans(arcsOf(markup));
  expect(spans).toEqual([
    { slot: 4, from: 135, to: 244.5 },
    { slot: 2, from: 250.5, to: 360 },
  ]);
});

test("three searches partition every overlap at its own bisector", () => {
  const star = "crossroads_eldritch:0";
  // East (slot 1), southwest (slot 4), west (slot 2): east and west touch at the top and bottom
  // (parted only by the seam), and southwest cuts into both.
  const markup = renderSvgMarkup(model, noSel, {
    manifest: null,
    marks: new Map([[star, [mark(1), mark(4), mark(2)]]]),
  });
  expect(arcSpans(arcsOf(markup))).toEqual([
    { slot: 1, from: 3, to: 154.5 },
    { slot: 4, from: 160.5, to: 244.5 },
    { slot: 2, from: 250.5, to: 357 },
  ]);
});

test("arc width grows outward with magnitude weight: base 8 at 0, quadruple at 1, inner edge fixed", () => {
  const star = "crossroads_eldritch:0";
  const at = (weight: number) => {
    const markup = renderSvgMarkup(model, noSel, { manifest: null, marks: new Map([[star, [mark(1, weight)]]]) });
    return arcOf(arcsOf(markup), 1);
  };
  // Inner edge 19 (base radius 23 less half the base width); r = 19 + w/2.
  expect(at(1)).toMatch(/<path class="arc" d="M [^"]*A 35 35 [^"]*" stroke="#3ee6d8" stroke-width="32"\/>/);
  expect(at(1)).toMatch(/<path class="arc-outline" d="M [^"]*A 35 35 [^"]*" stroke-width="36"\/>/);
  expect(at(0.5)).toMatch(/<path class="arc" d="M [^"]*A 29 29 [^"]*" stroke="#3ee6d8" stroke-width="20"\/>/);
});

test("searches sharing an angle stack outward, lower slot inside, each at its own width", () => {
  const star = "crossroads_eldritch:0";
  // Slots 0 and 8 both point north (8 mod 8) but differ in color (8 mod 5); listed out of slot order.
  const markup = renderSvgMarkup(model, noSel, { manifest: null, marks: new Map([[star, [mark(8), mark(0)]]]) });
  const arcs = arcsOf(markup);
  expect(markStyle(8).angle).toBe(markStyle(0).angle);
  expect(markStyle(8).color).not.toBe(markStyle(0).color);
  expect(arcSpans(arcs)).toEqual([
    { slot: 0, from: -90, to: 90 },
    { slot: 8, from: -90, to: 90 },
  ]);
  expect(arcOf(arcs, 0)).toMatch(/<path class="arc" d="M [^"]*A 23 23 [^"]*" stroke="#f0f4ff" stroke-width="8"\/>/);
  // The outer arc starts a 2-unit gap beyond the inner one's outer edge (27): r = 29 + 8/2.
  expect(arcOf(arcs, 8)).toMatch(/<path class="arc" d="M [^"]*A 33 33 [^"]*" stroke="#ff5e8a" stroke-width="8"\/>/);
});

test("a power star's ring sits outside its larger diamond", () => {
  const power = [...model.stars.values()].find((s) => s.celestialPower)!;
  const markup = renderSvgMarkup(model, noSel, { manifest: null, marks: new Map([[power.id, [mark(1)]]]) });
  const { cx, cy } = centerOf(markup, power.id);
  const arcs = arcsOf(markup);
  expect(arcs).toContain(`<circle class="arc-track" cx="${cx}" cy="${cy}" r="29"/>`); // POWER_RADIUS 19 + 10
  expect(arcOf(arcs, 1)).toMatch(/<path class="arc" d="M [^"]*A 29 29 [^"]*"/);
});

test("an unattainable, non-matching constellation carries both mute class and unattainable opacity", () => {
  const dimCon = [...model.constellations.values()].find((c) =>
    c.starIds.some((id) => (model.stars.get(id)?.predecessors.length ?? 0) > 0),
  )!;
  const notGranted = AFFINITIES.find((a) => (dimCon.affinityBonus[a] ?? 0) === 0)!;
  const reach: ReachView = {
    completable: new Set([...model.constellations.keys()].filter((id) => id !== dimCon.id)),
    reachableStars: new Set<string>(),
    legal: true,
    have: [0, 0, 0, 0, 0],
    need: [0, 0, 0, 0, 0],
    needSource: new Map(),
  };
  const svg = renderSvgMarkup(
    model,
    { selected: new Set(), pointCap: 55 },
    { manifest: null, reach, affinityFilter: { grants: new Set([notGranted]), requires: new Set() } },
  );
  // Color (mute) and brightness (opacity) are independent channels - both apply simultaneously on a star.
  expect(svg).toMatch(/class="star [^"]*mute[^"]*"[^>]*opacity="0\.3"/);
});

test("a non-matching constellation's art gets aff-dim", () => {
  const c = [...model.constellations.values()].find((c) => c.background?.image && c.background.x != null)!;
  const notGranted = AFFINITIES.find((a) => (c.affinityBonus[a] ?? 0) === 0)!; // an affinity c does not grant
  const name = c.background!.image!.split("/").pop()!;
  const manifest = { images: { [name]: { url: "art.webp", w: 64, h: 64 } } };
  const markup = renderSvgMarkup(
    model,
    { selected: new Set(), pointCap: 55 },
    {
      manifest,
      affinityFilter: { grants: new Set([notGranted]), requires: new Set() },
    },
  );
  expect(markup).toContain(' class="art mute"');
});

test("a matching constellation emits a colored glow with its matched-color gradient", () => {
  const c = [...model.constellations.values()].find(
    (c) => c.background?.image && c.background.x != null && presentAffinities(c.affinityBonus).length > 0,
  )!;
  const a = presentAffinities(c.affinityBonus)[0]!; // an affinity c grants
  const name = c.background!.image!.split("/").pop()!;
  const manifest = { images: { [name]: { url: "art.webp", w: 64, h: 64 } } };
  const markup = renderSvgMarkup(
    model,
    { selected: new Set(), pointCap: 55 },
    {
      manifest,
      affinityFilter: { grants: new Set([a]), requires: new Set() },
    },
  );
  expect(markup).toContain(`<linearGradient id="aff-grad-${c.id}"`);
  expect(markup).toContain('class="aff-glow"');
  expect(markup).toContain(`mask="url(#mask-${c.id})"`);
  expect(markup).toContain('filter="url(#aff-glow)"');
  expect(markup).toContain(glowColor(a)); // halo uses the deeper glow color (the affinity color axis)
  // The halo is drawn ON TOP of the art so its color reads through the bright line-art without washing
  // to pastel: the aff-glow rect must appear after this constellation's art <image> in document order.
  expect(markup.indexOf('class="aff-glow"')).toBeGreaterThan(markup.indexOf(`data-con-id="${c.id}"`));
});

test("no glow without an affinity filter", () => {
  const markup = renderSvgMarkup(model, { selected: new Set(), pointCap: 55 }, { manifest: null });
  expect(markup).not.toContain("aff-glow");
});

test("no search-glow layer when no query is active", () => {
  const markup = renderSvgMarkup(model, { selected: new Set(), pointCap: 55 }, { manifest });
  expect(markup).not.toContain("search-glow");
});

test("a matched constellation with art gets a search-glow halo", () => {
  const withArt = [...model.constellations.values()].find((c) => c.background?.image)!;
  const markup = renderSvgMarkup(
    model,
    { selected: new Set(), pointCap: 55 },
    { manifest, conHighlight: new Set([withArt.id]) },
  );
  expect(markup).toContain('filter id="search-glow"');
  // The mask must sit on the rect and the filter on a wrapping <g>. Both on one element makes SVG
  // clip the blur back to the art silhouette (filter runs before masking), so no aura escapes the
  // shape and the halo is invisible. This assertion is what keeps that regression out.
  expect(markup).toMatch(
    new RegExp(
      `<g filter="url\\(#search-glow\\)"><rect class="search-glow"[^>]*mask="url\\(#mask-${withArt.id}\\)"[^>]*/></g>`,
    ),
  );
  expect(markup).not.toMatch(/<rect class="search-glow"[^>]*filter="url\(#search-glow\)"/);
});

test("the constellation search halo floods in the query's mark color", () => {
  const queryColor = "#3ee6d8";
  // The text query is the only search that matches whole constellations, so its halo carries the
  // query's mark color for this render - the same color its star-level arcs use.
  const withArt = [...model.constellations.values()].find((c) => c.background?.image)!;
  const markup = renderSvgMarkup(
    model,
    { selected: new Set(), pointCap: 55 },
    { manifest, conHighlight: new Set([withArt.id]), queryColor },
  );
  expect(markup).toMatch(new RegExp(`<rect class="search-glow"[^>]*fill="${queryColor}"`));
  // The halo filter floods only the query color; the old neutral blue survives elsewhere (the
  // #match-glow hover treatment) but must be gone from the search halo def.
  const searchGlowDef = markup.match(/<filter id="search-glow".*?<\/filter>/)![0];
  expect(searchGlowDef).toContain(`flood-color="${queryColor}"`);
  expect(searchGlowDef).not.toContain('flood-color="#6cb6ff"');
});

test("the search halo paints under the art, not over it", () => {
  // A surrounding glow drawn on top of thin line art washes it out; the affinity halo wants the
  // opposite (it flushes after the art so its colour reads through), so the two orderings differ.
  const withArt = [...model.constellations.values()].find((c) => c.background?.image)!;
  const markup = renderSvgMarkup(
    model,
    { selected: new Set(), pointCap: 55 },
    { manifest, conHighlight: new Set([withArt.id]) },
  );
  expect(markup.indexOf('class="search-glow"')).toBeLessThan(markup.indexOf('class="art'));
});

test("an unmatched constellation gets no halo", () => {
  const cons = [...model.constellations.values()].filter((c) => c.background?.image);
  const markup = renderSvgMarkup(
    model,
    { selected: new Set(), pointCap: 55 },
    { manifest, conHighlight: new Set([cons[0]!.id]) },
  );
  // cons[1] (like almost every non-crossroads constellation) has an affinity requirement, so its
  // mask is legitimately referenced by the unrelated art-tint rect (Layer 1) even when unmatched -
  // a bare "mask=...(#mask-<id>)" substring check would false-fail on that. Assert specifically
  // that no search-glow rect references it (this is what an over-broad emphasis loop would add).
  expect(markup).not.toMatch(new RegExp(`<rect class="search-glow"[^>]*mask="url\\(#mask-${cons[1]!.id}\\)"`));
});

test("a matched constellation muted by an affinity filter still gets its halo, wrapped in mute-wide", () => {
  // A constellation that does NOT grant the filtered affinity, so it fails the filter (mutes),
  // but it is still a search match: the search halo must still draw, desaturated via #mute-wide.
  const offCon = [...model.constellations.values()].find(
    (c) => c.background?.image && (c.affinityBonus.chaos ?? 0) === 0,
  )!;
  const markup = renderSvgMarkup(
    model,
    { selected: new Set(), pointCap: 55 },
    {
      manifest,
      affinityFilter: { grants: new Set(["chaos"]), requires: new Set() },
      conHighlight: new Set([offCon.id]),
    },
  );
  expect(markup).toMatch(
    new RegExp(
      `<g filter="url\\(#mute-wide\\)"><g filter="url\\(#search-glow\\)"><rect class="search-glow"[^>]*mask="url\\(#mask-${offCon.id}\\)"`,
    ),
  );
});
