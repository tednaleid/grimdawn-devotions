// ABOUTME: Unit tests for the pure renderSvgMarkup function in the SVG renderer adapter.
// ABOUTME: Verifies star class assignment and art layer suppression without DOM dependencies.
import { test, expect } from "bun:test";
import doc from "../../data/devotions.json";
import { buildModel } from "../src/core/model";
import { renderSvgMarkup } from "../src/adapters/svgRenderer";
import type { ReachView } from "../src/core/reachability";
import { AFFINITIES } from "../src/core/types";
import { glowColor, presentAffinities } from "../src/adapters/affinityColors";
import { QUERY_HAND_COLOR, QUERY_HAND_SLOT, QUERY_HAND_STYLE, handStyle } from "../src/adapters/handPalette";

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

// Hand marks as main.ts builds them: the palette style for a slot plus the star's weight for the search.
const mark = (slot: number, weight = 0) => ({ style: handStyle(slot), weight, slot });
const noSel = { selected: new Set<string>(), pointCap: 55 };
// A star's rendered centre, read back from its hit target.
function centerOf(markup: string, star: string): { cx: number; cy: number } {
  const m = markup.match(new RegExp(`data-star-id="${star}"[^>]*cx="(-?[\\d.]+)" cy="(-?[\\d.]+)"`))!;
  return { cx: Number(m[1]), cy: Number(m[2]) };
}
// The one star's hands layer: the track circle plus one <g class="search-hand"> per segment.
const handsOf = (markup: string) => markup.match(/<g class="search-hands">.*?<\/g><\/g>/)![0];
const handLines = (hands: string) => hands.match(/<line class="hand" [^>]*\/>/g) ?? [];

test("an affinity filter mutes non-matching constellations; search hands in a matching con stay un-muted", () => {
  // crossroads_eldritch GRANTS eldritch, so under an eldritch filter its constellation matches: the
  // marked star is identity (not muted) and its hands layer is NOT mute-wrapped.
  const matchStar = "crossroads_eldritch:0";
  const markup = renderSvgMarkup(model, noSel, {
    manifest: null,
    affinityFilter: { grants: new Set(["eldritch"]), requires: new Set() },
    hands: new Map([[matchStar, [mark(0)]]]),
  });
  expect(markup).toContain('class="star selectable"'); // the matched star's dot is identity (not muted)
  expect(markup).toContain('<g class="search-hands">'); // hand emphasis is a separate layer
  expect(markup).not.toContain('<g filter="url(#mute-wide)"'); // a matching con's hands are never mute-wrapped
  expect(markup).toContain(' mute"'); // non-matching stars get mute
  expect(markup).toContain('class="link mute"'); // links get mute
});

test("search hands in an off-affinity constellation: muted dot AND mute-wrapped hands", () => {
  // A constellation that does NOT grant the filtered affinity, so it fails the filter (non-matching).
  const offCon = [...model.constellations.values()].find((c) => (c.affinityBonus.chaos ?? 0) === 0)!;
  const markStar = offCon.starIds[0]!;
  const markup = renderSvgMarkup(model, noSel, {
    manifest: null,
    affinityFilter: { grants: new Set(["chaos"]), requires: new Set() },
    hands: new Map([[markStar, [mark(0)]]]),
  });
  // Two independent channels both fire: the dot desaturates (mute) AND the hands are wrapped in
  // #mute-wide so the whole emphasis greys, reading as "search match, off the affinity filter".
  expect(markup).toContain('<g filter="url(#mute-wide)"><g class="search-hands">');
  expect(markup).toMatch(/class="star [^"]*mute[^"]*"/); // the dot itself carries mute too
});

test("a single-search match draws a track and one hand at that search's angle, in its color", () => {
  const star = "crossroads_eldritch:0";
  const markup = renderSvgMarkup(model, noSel, { manifest: null, hands: new Map([[star, [mark(1)]]]) });
  const { cx, cy } = centerOf(markup, star);
  const hands = handsOf(markup);
  expect(hands).toContain(`<circle class="hand-track" cx="${cx}" cy="${cy}" r="18"/>`); // STAR_RADIUS 12 + 6
  const lines = handLines(hands);
  expect(lines.length).toBe(1);
  // Slot 1 points at 270 degrees (9 o'clock): from the star's centre to 40 units out at weight 0
  // (the dot's radius 12 plus the 28-unit minimum showing beyond it).
  expect(lines[0]).toContain(`x1="${cx}" y1="${cy}" x2="${cx - 40}" y2="${cy}"`);
  expect(lines[0]).toContain(`stroke="${handStyle(1).color}"`);
  expect(hands).toContain('<g class="search-hand" data-slot="1">');
});

test("a star's hands are painted under its dot, so the dot's state and color stay visible over the hub", () => {
  const star = "crossroads_eldritch:0";
  const markup = renderSvgMarkup(model, noSel, { manifest: null, hands: new Map([[star, [mark(0)]]]) });
  const { cx, cy } = centerOf(markup, star);
  const hit = markup.indexOf(`data-star-id="${star}"`);
  const hands = markup.indexOf('<g class="search-hands">');
  const dot = markup.indexOf(`<circle class="star selectable" opacity="1" cx="${cx}" cy="${cy}"`);
  expect(hit).toBeGreaterThan(-1);
  expect(dot).toBeGreaterThan(-1);
  expect(hands).toBeGreaterThan(hit);
  expect(dot).toBeGreaterThan(hands);
});

test("each matching search adds its own hand at its own fixed angle, over a dark outline", () => {
  const star = "crossroads_eldritch:0";
  const markup = renderSvgMarkup(model, noSel, { manifest: null, hands: new Map([[star, [mark(0), mark(1)]]]) });
  const { cx, cy } = centerOf(markup, star);
  const hands = handsOf(markup);
  const right = `x1="${cx}" y1="${cy}" x2="${cx + 40}" y2="${cy}"`; // slot 0: 3 o'clock
  const left = `x1="${cx}" y1="${cy}" x2="${cx - 40}" y2="${cy}"`; // slot 1: 9 o'clock
  expect(hands).toContain(
    `<g class="search-hand" data-slot="0"><line class="hand-outline" ${right}/><line class="hand" ${right} stroke="${handStyle(0).color}"/></g>`,
  );
  expect(hands).toContain(`<line class="hand" ${left} stroke="${handStyle(1).color}"/>`);
  expect(hands.match(/<circle class="hand-track"/g)!.length).toBe(1); // one track per star, not per hand
});

test("hand length grows with magnitude weight from the centre: 40 at weight 0, 80 at weight 1", () => {
  const star = "crossroads_eldritch:0";
  const at = (weight: number) => {
    const markup = renderSvgMarkup(model, noSel, { manifest: null, hands: new Map([[star, [mark(0, weight)]]]) });
    const { cx, cy } = centerOf(markup, star);
    return { line: handLines(handsOf(markup))[0]!, cx, cy };
  };
  const max = at(1);
  expect(max.line).toContain(`x1="${max.cx}" y1="${max.cy}" x2="${max.cx + 80}" y2="${max.cy}"`);
  const half = at(0.5);
  expect(half.line).toContain(`x2="${half.cx + 60}"`);
  // Width is constant (a CSS rule), so magnitude reads as length alone.
  expect(max.line).not.toContain("stroke-width");
});

test("two searches sharing an angle stack end to end along the ray, lower slot at the root", () => {
  const star = "crossroads_eldritch:0";
  // Slots 0 and 8 share the 3 o'clock angle (8 mod 8) but not a color (8 mod 5); listed out of
  // slot order on purpose.
  const markup = renderSvgMarkup(model, noSel, { manifest: null, hands: new Map([[star, [mark(8), mark(0)]]]) });
  const { cx, cy } = centerOf(markup, star);
  const lines = handLines(handsOf(markup));
  expect(lines.length).toBe(2);
  expect(handStyle(8).angle).toBe(handStyle(0).angle);
  expect(handStyle(8).color).not.toBe(handStyle(0).color);
  expect(lines[0]).toContain(`x1="${cx}" y1="${cy}" x2="${cx + 40}" y2="${cy}" stroke="${handStyle(0).color}"`);
  // The next segment starts a 6-unit gap beyond the previous tip and runs the 28-unit minimum.
  expect(lines[1]).toContain(`x1="${cx + 46}" y1="${cy}" x2="${cx + 74}" y2="${cy}" stroke="${handStyle(8).color}"`);
});

test("a stack's tip is clamped at the maximum single reach plus one minimum segment", () => {
  const star = "crossroads_eldritch:0";
  const markup = renderSvgMarkup(model, noSel, {
    manifest: null,
    hands: new Map([[star, [mark(0, 1), mark(8, 1)]]]),
  });
  const { cx, cy } = centerOf(markup, star);
  const lines = handLines(handsOf(markup));
  expect(lines[0]).toContain(`x2="${cx + 80}"`);
  // 80 + gap 6 = 86 start; a full 68 would reach 154, clamped to 12 + 28 + 40 + 6 + 28 = 114.
  expect(lines[1]).toContain(`x1="${cx + 86}" y1="${cy}" x2="${cx + 114}"`);
});

test("the query's hand roots a stack it shares with the eighth benefit slot, both pointing straight up", () => {
  const star = "crossroads_eldritch:0";
  const query = { style: QUERY_HAND_STYLE, weight: 0, slot: QUERY_HAND_SLOT };
  expect(handStyle(7).angle).toBe(QUERY_HAND_STYLE.angle);
  const markup = renderSvgMarkup(model, noSel, { manifest: null, hands: new Map([[star, [mark(7), query]]]) });
  const { cx, cy } = centerOf(markup, star);
  const lines = handLines(handsOf(markup));
  expect(lines[0]).toContain(`x1="${cx}" y1="${cy}" x2="${cx}" y2="${cy - 40}" stroke="${QUERY_HAND_COLOR}"`);
  expect(lines[1]).toContain(`x1="${cx}" y1="${cy - 46}" x2="${cx}" y2="${cy - 74}" stroke="${handStyle(7).color}"`);
});

test("a power star's hands clear its larger diamond", () => {
  const power = [...model.stars.values()].find((s) => s.celestialPower)!;
  const markup = renderSvgMarkup(model, noSel, { manifest: null, hands: new Map([[power.id, [mark(0)]]]) });
  const { cx, cy } = centerOf(markup, power.id);
  const hands = handsOf(markup);
  expect(hands).toContain(`<circle class="hand-track" cx="${cx}" cy="${cy}" r="25"/>`); // POWER_RADIUS 19 + 6
  // The minimum 28 units show beyond the diamond's 19-unit reach, so a power hand tips at 47.
  expect(handLines(hands)[0]).toContain(`x1="${cx}" y1="${cy}" x2="${cx + 47}"`);
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

test("the constellation search halo floods in the query hand color", () => {
  // The text query is the only search that matches whole constellations, so its halo carries the
  // query's reserved hand color - the same color its star-level hand hits use.
  const withArt = [...model.constellations.values()].find((c) => c.background?.image)!;
  const markup = renderSvgMarkup(
    model,
    { selected: new Set(), pointCap: 55 },
    { manifest, conHighlight: new Set([withArt.id]) },
  );
  expect(markup).toMatch(new RegExp(`<rect class="search-glow"[^>]*fill="${QUERY_HAND_COLOR}"`));
  // The halo filter floods only the query color; the old neutral blue survives elsewhere (the
  // #match-glow hover treatment) but must be gone from the search halo def.
  const searchGlowDef = markup.match(/<filter id="search-glow".*?<\/filter>/)![0];
  expect(searchGlowDef).toContain(`flood-color="${QUERY_HAND_COLOR}"`);
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
