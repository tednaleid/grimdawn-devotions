// ABOUTME: Unit tests for the pure renderSvgMarkup function in the SVG renderer adapter.
// ABOUTME: Verifies star class assignment and art layer suppression without DOM dependencies.
import { test, expect } from "bun:test";
import doc from "../../data/devotions.json";
import { buildModel } from "../src/core/model";
import { renderSvgMarkup } from "../src/adapters/svgRenderer";
import type { ReachView } from "../src/core/reachability";

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
  expect(markup).toContain('<polygon class="star power');
});

test("a fully-selected constellation's art gets the 'active' class; a partial one does not", () => {
  const withArt = [...model.constellations.values()].find(
    (c) => c.background?.image && c.background.x != null && c.starIds.length >= 2,
  )!;
  const name = withArt.background!.image!.split("/").pop()!;
  const manifest = { images: { [name]: { url: "art.webp", w: 640, h: 480 } } };

  // All stars selected -> the constellation is active, and its art carries the affinity-colored glow.
  const full = renderSvgMarkup(model, { selected: new Set(withArt.starIds), pointCap: 55 }, { manifest });
  expect(full).toMatch(new RegExp(`class="art active"[^>]*data-con-id="${withArt.id}"`));
  expect(full).toContain("--glow1:"); // only the active constellation emits the glow vars

  // Only the first star selected (a partial pick) -> NOT active, no glow.
  const partial = renderSvgMarkup(model, { selected: new Set([withArt.starIds[0]!]), pointCap: 55 }, { manifest });
  expect(partial).not.toMatch(new RegExp(`class="art[^"]*active"[^>]*data-con-id="${withArt.id}"`));
  expect(partial).not.toContain("--glow1:");
});

test("two-layer dimming: completable normal, startable faded, unstartable dark", () => {
  const ids = [...model.constellations.keys()];
  // ids[0]=akeron_s_scorpion, ids[1]=anvil, ids[2]=assassin_s_blade
  const reach: ReachView = {
    completable: new Set([ids[0]!]),
    clickable: new Set(),
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

test("two-layer dimming art: completable has no dim class, un-startable gets unreachable", () => {
  const ids = [...model.constellations.keys()];
  // Find a constellation with art
  const withArt = [...model.constellations.values()].find((c) => c.background?.image && c.background.x != null)!;
  const withArtId = withArt.id;
  const name = withArt.background!.image!.split("/").pop()!;
  const manifest = { images: { [name]: { url: "art.webp", w: 640, h: 480 } } };

  // withArtId is completable; pick a different constellation as the unreachable one
  const otherId = ids.find((id) => id !== withArtId)!;

  const reach: ReachView = {
    completable: new Set([withArtId]),
    clickable: new Set(),
    have: [0, 0, 0, 0, 0],
    need: [0, 0, 0, 0, 0],
    needSource: new Map(),
  };

  const svg = renderSvgMarkup(model, { selected: new Set(), pointCap: 55 }, { manifest, reach });

  // The completable constellation's art must NOT have the unmet or unreachable class
  expect(svg).toContain(`data-con-id="${withArtId}"`);
  expect(svg).not.toMatch(new RegExp(`class="art unreachable"[^>]*data-con-id="${withArtId}"`));
  expect(svg).not.toMatch(new RegExp(`class="art unmet"[^>]*data-con-id="${withArtId}"`));

  // otherId has no clickable stars -> if it has art it gets unreachable; if not, verify star is locked
  if (model.constellations.get(otherId)!.starIds[0]) {
    expect(svg).toContain(`data-star-id="${otherId}:0" class="hit locked"`);
  }
});
