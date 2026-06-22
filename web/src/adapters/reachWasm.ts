// ABOUTME: Loads the Rust/WASM reachability core (data/reach.wasm) and adapts it to the engine's
// ABOUTME: ExactResolver signature, so classifyForSelection offloads the expensive gap candidates.
// ABOUTME: Marshals the cover table + constellations into linear memory once; reuses a scratch buffer
// ABOUTME: per call. Returns null on any failure so the caller cleanly falls back to the TS resolver.
import type { CoverTable, ExactResolver, ReachCon, ReachState } from "../core/reachability";

interface ReachExports {
  memory: WebAssembly.Memory;
  alloc(n: number): number;
  init_cover(ptr: number, len: number, c0: number, c1: number, c2: number, c3: number, c4: number, s0: number, s1: number, s2: number, s3: number, s4: number): void;
  init_cons(req: number, grant: number, size: number, ncon: number): void;
  reachable_exact(ptr: number, len: number, budget: number): number;
  add(a: number, b: number): number;
}

/**
 * Instantiate reach.wasm and return an ExactResolver backed by it, or null if the module is missing,
 * fails to load, or fails a self-check against the TS-shaped contract. The returned resolver ignores
 * the cons/table arguments (it captured them at load) and decides one ReachState.
 */
export async function loadWasmResolver(bytes: ArrayBuffer | Uint8Array, cons: ReachCon[], table: CoverTable): Promise<ExactResolver | null> {
  try {
    const ab = (bytes instanceof Uint8Array ? bytes.slice().buffer : bytes) as ArrayBuffer;
    const instance = await WebAssembly.instantiate(await WebAssembly.compile(ab), {});
    const ex = instance.exports as unknown as ReachExports;
    if (typeof ex.reachable_exact !== "function" || ex.add(2, 3) !== 5) return null;
    const memU16 = () => new Uint16Array(ex.memory.buffer);
    const memI32 = () => new Int32Array(ex.memory.buffer);
    const writeU16 = (a: Uint16Array): number => { const p = ex.alloc(a.length * 2); memU16().set(a, p >>> 1); return p; };
    const writeI32 = (a: Int32Array): number => { const p = ex.alloc(a.length * 4); memI32().set(a, p >>> 2); return p; };

    ex.init_cover(writeU16(table.cost), table.cost.length, table.caps[0], table.caps[1], table.caps[2], table.caps[3], table.caps[4], table.strides[0], table.strides[1], table.strides[2], table.strides[3], table.strides[4]);

    const n = cons.length;
    const req = new Int32Array(n * 5), grant = new Int32Array(n * 5), size = new Int32Array(n);
    const idToIdx = new Map<string, number>();
    cons.forEach((c, i) => { idToIdx.set(c.id, i); for (let k = 0; k < 5; k++) { req[i * 5 + k] = c.req[k]!; grant[i * 5 + k] = c.grant[k]!; } size[i] = c.size; });
    ex.init_cons(writeI32(req), writeI32(grant), writeI32(size), n);

    // One reusable scratch buffer for per-call state (no per-candidate allocation after this).
    const scratch = ex.alloc(8192);
    const scratchInts = 8192 >> 2;
    const buf: number[] = [];
    const builtIndex = new Map<string, number>();

    return (_cons: ReachCon[], _table: CoverTable, st: ReachState, budget: number): boolean => {
      buf.length = 0;
      buf.push(st.own, st.supply[0], st.supply[1], st.supply[2], st.supply[3], st.supply[4], st.target[0], st.target[1], st.target[2], st.target[3], st.target[4]);
      let nstarted = 0;
      const startedAt = buf.push(0) - 1; // placeholder for count
      for (const id of st.startedIds) { const idx = idToIdx.get(id); if (idx !== undefined) { buf.push(idx); nstarted++; } }
      buf[startedAt] = nstarted;
      builtIndex.clear();
      buf.push(st.built.length);
      st.built.forEach((m, i) => { builtIndex.set(m.id, i); buf.push(m.req[0], m.req[1], m.req[2], m.req[3], m.req[4], m.grant[0], m.grant[1], m.grant[2], m.grant[3], m.grant[4], m.size); });
      buf.push(st.partialFinish.length);
      for (const p of st.partialFinish) buf.push(builtIndex.get(p.id) ?? 0, p.grant[0], p.grant[1], p.grant[2], p.grant[3], p.grant[4], p.remaining);
      if (buf.length > scratchInts) return false; // pathologically large state; let caller treat as dim (never happens within budget)
      memI32().set(buf, scratch >> 2);
      return ex.reachable_exact(scratch, buf.length, budget) === 1;
    };
  } catch (e) {
    console.warn("reach.wasm load failed; using the TS resolver", e);
    return null;
  }
}
