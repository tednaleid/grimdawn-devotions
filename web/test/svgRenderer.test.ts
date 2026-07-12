// ABOUTME: Unit tests for the pure renderSvgMarkup function in the SVG renderer adapter.
// ABOUTME: Verifies star class assignment and art layer suppression without DOM dependencies.
import { test, expect } from "bun:test";
import doc from "../../data/devotions.json";
import { buildModel } from "../src/core/model";
import { renderSvgMarkup } from "../src/adapters/svgRenderer";
import type { ReachView } from "../src/core/reachability";
import { AFFINITIES } from "../src/core/types";
import { glowColor, presentAffinities } from "../src/adapters/affinityColors";

const model = buildModel(doc as any);

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
    clickable: new Set(),
    reachableStars: new Set<string>(),
    have: [0, 0, 0, 0, 0],
    need: [0, 0, 0, 0, 0],
    needSource: new Map(),
  };
  // Make the first star of ids[1] clickable so it is "startable but not completable"
  const firstStar = model.constellations.get(ids[1]!)!.starIds[0]!;
  reach.clickable.add(firstStar);

  const svg = renderSvgMarkup(model, { selected: new Set(), pointCap: 55 }, { manifest: null, reach });

  // The clickable star renders with class "selectable"
  expect(svg).toMatch(/class="(star|hit) [^"]*selectable/);

  // ids[2] is not completable and has no clickable stars -> its data-con-id should appear (it is rendered),
  // and when a manifest is present its art gets "unreachable". Without a manifest we verify the star
  // is "locked" (not selectable) since no star of ids[2] is in reach.clickable.
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
    clickable: new Set(),
    reachableStars: new Set<string>(),
    have: [0, 0, 0, 0, 0],
    need: [0, 0, 0, 0, 0],
    needSource: new Map(),
  };

  const svg = renderSvgMarkup(model, { selected: new Set(), pointCap: 55 }, { manifest, reach });

  // A completable (attainable) constellation's art renders at the attainable opacity, not the dimmer
  // unattainable one - brightness is the inline opacity attribute, no dim class.
  expect(svg).toMatch(new RegExp(`class="art" opacity="0\\.5" data-con-id="${withArtId}"`));

  // otherId has no clickable stars -> unattainable; its first star is locked.
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
    clickable: new Set(),
    reachableStars: new Set<string>(),
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

test("an affinity filter mutes non-matching constellations; a benefit match in a matching con stays un-muted", () => {
  // crossroads_eldritch GRANTS eldritch, so under an eldritch filter its constellation matches: the
  // highlighted star is identity (not muted) and its benefit-glow layer is NOT mute-wrapped.
  const matchStar = "crossroads_eldritch:0";
  const markup = renderSvgMarkup(
    model,
    { selected: new Set(), pointCap: 55 },
    {
      manifest: null,
      affinityFilter: { grants: new Set(["eldritch"]), requires: new Set() },
      highlight: new Set([matchStar]),
    },
  );
  expect(markup).toContain('class="star selectable"'); // the matched star's dot is identity (not muted)
  expect(markup).toContain('<circle class="benefit-glow"'); // benefit emphasis is a separate glow layer
  expect(markup).not.toContain('<g filter="url(#mute-wide)"'); // a matching con's glow is never mute-wrapped
  expect(markup).toContain(' mute"'); // non-matching stars get mute
  expect(markup).toContain('class="link mute"'); // links get mute
});

test("a benefit match in an off-affinity constellation: muted dot AND a mute-wrapped benefit glow", () => {
  // A constellation that does NOT grant the filtered affinity, so it fails the filter (non-matching).
  const offCon = [...model.constellations.values()].find((c) => (c.affinityBonus.chaos ?? 0) === 0)!;
  const markStar = offCon.starIds[0]!;
  const markup = renderSvgMarkup(
    model,
    { selected: new Set(), pointCap: 55 },
    {
      manifest: null,
      affinityFilter: { grants: new Set(["chaos"]), requires: new Set() },
      highlight: new Set([markStar]),
    },
  );
  // Two independent channels both fire: the dot desaturates (mute) AND the benefit glow is wrapped in
  // #mute-wide so the whole emphasis greys, reading as "benefit match, off the affinity filter".
  expect(markup).toMatch(/<g filter="url\(#mute-wide\)"><(circle|polygon) class="benefit-glow"/);
  expect(markup).toMatch(/class="star [^"]*mute[^"]*"/); // the dot itself carries mute too
});

test("an unattainable, non-matching constellation carries both mute class and unattainable opacity", () => {
  const dimCon = [...model.constellations.values()].find((c) =>
    c.starIds.some((id) => (model.stars.get(id)?.predecessors.length ?? 0) > 0),
  )!;
  const notGranted = AFFINITIES.find((a) => (dimCon.affinityBonus[a] ?? 0) === 0)!;
  const reach: ReachView = {
    completable: new Set([...model.constellations.keys()].filter((id) => id !== dimCon.id)),
    clickable: new Set(),
    reachableStars: new Set<string>(),
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
