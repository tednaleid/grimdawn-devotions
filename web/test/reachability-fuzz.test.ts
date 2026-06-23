// ABOUTME: CI guard for the reachability correctness fuzzer. Seeded, known-valid builds (constructed
// ABOUTME: forward by the ground-truth rule, independent of the engine) are replayed in claim-anywhere
// ABOUTME: order; the engine must never dim a constellation genuinely part of the valid build. Uses the
// ABOUTME: fast WASM resolver when data/reach.wasm is built (run `just wasm`), else a small TS fallback.
import { test, expect, beforeAll, afterAll } from "bun:test";
import { resolve } from "node:path";
import { fuzzSeed, cons, table } from "../scripts/reachability-fuzz";
import { setExactResolver } from "../src/core/reachability";
import { loadWasmResolver } from "../src/adapters/reachWasm";

let N = 4; // TS is ~30x slower than wasm, so only a few seeds when the wasm artifact is absent (e.g. CI without Rust)
beforeAll(async () => {
  const f = Bun.file(resolve(import.meta.dir, "..", "..", "data", "reach.wasm"));
  if (await f.exists()) {
    const wasm = await loadWasmResolver(await f.arrayBuffer(), cons, table);
    if (wasm) {
      setExactResolver(wasm);
      N = 20;
    }
  }
});
afterAll(() => setExactResolver(null)); // restore the default TS resolver for any later tests

test("reachability never dims a member of a known-valid build (claim-anywhere fuzz)", () => {
  for (let seed = 1; seed <= N; seed++) {
    const { violations, genValid, stars } = fuzzSeed(seed);
    expect(genValid).toBe(true); // the forward generator must produce a genuinely valid build
    expect(stars).toBeGreaterThan(20); // ...and a non-trivial one
    if (violations.length)
      throw new Error(`seed ${seed}: ${violations.length} false dim(s), first: ${JSON.stringify(violations[0])}`);
  }
  expect(N).toBeGreaterThanOrEqual(4);
});
