// ABOUTME: Unit tests for the pure renderSvgMarkup function in the SVG renderer adapter.
// ABOUTME: Verifies star class assignment and art layer suppression without DOM dependencies.
import { test, expect } from "bun:test";
import doc from "../../data/devotions.json";
import { buildModel } from "../src/core/model";
import { renderSvgMarkup } from "../src/adapters/svgRenderer";

const model = buildModel(doc as any);

test("marks selected and selectable stars with classes and ids", () => {
  const markup = renderSvgMarkup(model, { selected: new Set(["crossroads_eldritch:0"]), pointCap: 55 }, { manifest: null });
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

test("renders a per-constellation hover/click region", () => {
  const markup = renderSvgMarkup(model, { selected: new Set(), pointCap: 55 }, { manifest: null });
  expect(markup).toContain('class="con-hit" data-con-id="falcon"');
});

test("defines a per-constellation gradient and stars reference it", () => {
  const markup = renderSvgMarkup(model, { selected: new Set(), pointCap: 55 }, { manifest: null });
  // gradient def exists even without a manifest, and stars paint with it
  expect(markup).toContain('<linearGradient id="grad-falcon"');
  expect(markup).toContain("--grad:url(#grad-falcon)");
  // assassin's blade requires order (gold) only -> its gradient is the order color, not bonus purple
  expect(markup).toContain('<linearGradient id="grad-assassin_s_blade" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#e6c34d"/>');
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
