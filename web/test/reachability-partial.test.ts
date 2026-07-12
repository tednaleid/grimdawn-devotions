// ABOUTME: Tests for partial-constellation reachability: pathToStar and the reachableStars signal
// ABOUTME: (deep-star attainability inside constellations that cannot be fully completed).
import { test, expect } from "bun:test";
import doc from "../../data/devotions.json";
import { buildModel } from "../src/core/model";
import { pathToStar } from "../src/core/reachability";

const realModel = buildModel(doc as any);

test("pathToStar walks unselected predecessors within the constellation", () => {
  // korvaak_the_eldritch_sun: chain 0-1-2, then 2 branches to 3, 4, 5. Star 4 is Eye of Korvaak.
  const eye = "korvaak_the_eldritch_sun:4";
  const fromEmpty = pathToStar(realModel, new Set(), eye);
  expect([...fromEmpty].sort()).toEqual([
    "korvaak_the_eldritch_sun:0",
    "korvaak_the_eldritch_sun:1",
    "korvaak_the_eldritch_sun:2",
    "korvaak_the_eldritch_sun:4",
  ]);
  // Already-selected predecessors are excluded: only the unselected remainder is the path.
  const partial = pathToStar(realModel, new Set(["korvaak_the_eldritch_sun:0", "korvaak_the_eldritch_sun:1"]), eye);
  expect([...partial].sort()).toEqual(["korvaak_the_eldritch_sun:2", "korvaak_the_eldritch_sun:4"]);
  // A selected star has an empty path (nothing to add).
  expect(pathToStar(realModel, new Set([eye, "korvaak_the_eldritch_sun:0"]), eye).size).toBe(0);
});
