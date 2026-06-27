// ABOUTME: Reachability core in Rust, compiled to raw wasm32. Ports the memoized branch-and-bound
// ABOUTME: exact resolver (reachableExactFrom) that the TS engine validated as verdict-equivalent to
// ABOUTME: its own exact search, so the per-click sweep can offload the expensive gap candidates here.
// ABOUTME: Statics are set once via init_cover/init_cons; reachable_exact decides one candidate state.
// ABOUTME: Single-threaded wasm, so static mut access is sound; no allocator games beyond Vec.
#![allow(static_mut_refs)]

use std::collections::HashMap;
use std::hash::{BuildHasherDefault, Hasher};

// Fast FxHash-style hasher for the i64 memo keys (the default SipHash dominates the search otherwise).
#[derive(Default)]
struct FxHasher(u64);
impl Hasher for FxHasher {
    #[inline]
    fn finish(&self) -> u64 {
        self.0
    }
    #[inline]
    fn write(&mut self, bytes: &[u8]) {
        for &b in bytes {
            self.0 = (self.0.rotate_left(5) ^ (b as u64)).wrapping_mul(0x51_7c_c1_b7_27_22_0a_95);
        }
    }
    #[inline]
    fn write_i64(&mut self, i: i64) {
        self.0 = (self.0.rotate_left(5) ^ (i as u64)).wrapping_mul(0x51_7c_c1_b7_27_22_0a_95);
    }
}
type FxMap = HashMap<i64, i32, BuildHasherDefault<FxHasher>>;

const CAP_MAX: [i32; 5] = [20, 8, 20, 10, 20];
const SEED: [i32; 5] = [1, 1, 1, 1, 1];
const NOCOST: u16 = 65535;
const BIG: i32 = 1_000_000_000;
// Lattice strides for caps [20,8,20,10,20] -> sizes [21,9,21,11,21]; max index < LATTICE.
const LSTRIDE: [i64; 5] = [9 * 21 * 11 * 21, 21 * 11 * 21, 11 * 21, 21, 1];
const LATTICE: i64 = 917_000;

static mut COVER: Vec<u16> = Vec::new();
static mut CCAPS: [i32; 5] = [0; 5];
static mut CSTRIDES: [i32; 5] = [0; 5];
static mut CON_REQ: Vec<i32> = Vec::new();
static mut CON_GRANT: Vec<i32> = Vec::new();
static mut CON_SIZE: Vec<i32> = Vec::new();
static mut NCON: usize = 0;

// --- linear-memory marshalling helpers --------------------------------------
/// Returns an 8-byte-aligned buffer (so the host may write u16/i32 views into it).
#[no_mangle]
pub extern "C" fn alloc(n: usize) -> *mut u8 {
    let mut v: Vec<u64> = Vec::with_capacity((n + 7) / 8);
    let p = v.as_mut_ptr() as *mut u8;
    std::mem::forget(v);
    p
}

#[no_mangle]
pub extern "C" fn dealloc(p: *mut u8, n: usize) {
    unsafe {
        let _ = Vec::from_raw_parts(p, 0, n);
    }
}

/// Smoke export: validates that the host can load and call the module.
#[no_mangle]
pub extern "C" fn add(a: i32, b: i32) -> i32 {
    a + b
}

#[no_mangle]
pub extern "C" fn init_cover(ptr: *const u16, len: usize, c0: i32, c1: i32, c2: i32, c3: i32, c4: i32, s0: i32, s1: i32, s2: i32, s3: i32, s4: i32) {
    unsafe {
        COVER = std::slice::from_raw_parts(ptr, len).to_vec();
        CCAPS = [c0, c1, c2, c3, c4];
        CSTRIDES = [s0, s1, s2, s3, s4];
    }
}

#[no_mangle]
pub extern "C" fn init_cons(req: *const i32, grant: *const i32, size: *const i32, ncon: usize) {
    unsafe {
        CON_REQ = std::slice::from_raw_parts(req, ncon * 5).to_vec();
        CON_GRANT = std::slice::from_raw_parts(grant, ncon * 5).to_vec();
        CON_SIZE = std::slice::from_raw_parts(size, ncon).to_vec();
        NCON = ncon;
    }
}

// --- engine helpers ---------------------------------------------------------
#[inline]
fn covers(g: &[i32; 5], d: &[i32; 5]) -> bool {
    g[0] >= d[0] && g[1] >= d[1] && g[2] >= d[2] && g[3] >= d[3] && g[4] >= d[4]
}
#[inline]
fn add_cap(g: &[i32; 5], x: &[i32; 5]) -> [i32; 5] {
    [(g[0] + x[0]).min(CAP_MAX[0]), (g[1] + x[1]).min(CAP_MAX[1]), (g[2] + x[2]).min(CAP_MAX[2]), (g[3] + x[3]).min(CAP_MAX[3]), (g[4] + x[4]).min(CAP_MAX[4])]
}
#[inline]
fn max_v(a: &[i32; 5], b: &[i32; 5]) -> [i32; 5] {
    [a[0].max(b[0]), a[1].max(b[1]), a[2].max(b[2]), a[3].max(b[3]), a[4].max(b[4])]
}
#[inline]
fn lidx(v: &[i32; 5]) -> i64 {
    v[0] as i64 * LSTRIDE[0] + v[1] as i64 * LSTRIDE[1] + v[2] as i64 * LSTRIDE[2] + v[3] as i64 * LSTRIDE[3] + v[4] as i64
}
fn cover_cost(deficit: &[i32; 5]) -> i32 {
    unsafe {
        let mut k = 0i32;
        for i in 0..5 {
            k += deficit[i].max(0).min(CCAPS[i]) * CSTRIDES[i];
        }
        let v = COVER[k as usize];
        if v == NOCOST {
            BIG
        } else {
            v as i32
        }
    }
}
// Members are (req, grant, size). constructible() ignores size (it only needs the seed fixpoint).
fn constructible(members: &[([i32; 5], [i32; 5], i32)]) -> bool {
    let mut gain = SEED;
    let mut done = vec![false; members.len()];
    let mut placed = 0usize;
    let mut changed = true;
    while changed {
        changed = false;
        for i in 0..members.len() {
            if done[i] || !covers(&gain, &members[i].0) {
                continue;
            }
            done[i] = true;
            placed += 1;
            gain = add_cap(&gain, &members[i].1);
            changed = true;
        }
    }
    placed == members.len()
}

// Cheap SOUND reachable proof, mirroring the TS peakGateReachable. Affinity persists, so a self-covering,
// unit-seed-constructible build holds at most one refundable crossroads per required color: a no-refund
// schedule peaks at size + distinct_required_colors. If that fits the budget a genuine construction order
// exists. Sound (never accepts an unbuildable build); the tight band falls through to the peak witness.
// constructible alone is NOT sufficient - it ignores the transient crossroads peak (the false-reach bug).
fn peak_gate_reachable(members: &[([i32; 5], [i32; 5], i32)], budget: i32) -> bool {
    let mut size = 0i32;
    let mut grant = [0i32; 5];
    let mut req = [0i32; 5];
    for m in members {
        size += m.2;
        grant = add_cap(&grant, &m.1);
        req = max_v(&req, &m.0);
    }
    if !covers(&grant, &req) {
        return false; // not self-covering: needs permanent support, this gate cannot decide it
    }
    let mut colors = 0i32;
    for i in 0..5 {
        if req[i] > 0 {
            colors += 1;
        }
    }
    if size + colors > budget {
        return false; // peak may exceed budget; defer to the witness
    }
    constructible(members)
}

// --- peak witness (scaffold-then-refund construction), the TS minPeakSampled with GATE_WITNESS_TRIES=0 ---
// Sound peak-bounded construction check: it can only flip a false-dim to reachable, never a false-reach.
// Verdict-identical to the TS gate witness (deterministic heuristic order, no RNG).
#[inline]
fn con_req(i: usize) -> [i32; 5] {
    unsafe { [CON_REQ[i * 5], CON_REQ[i * 5 + 1], CON_REQ[i * 5 + 2], CON_REQ[i * 5 + 3], CON_REQ[i * 5 + 4]] }
}
#[inline]
fn con_grant(i: usize) -> [i32; 5] {
    unsafe { [CON_GRANT[i * 5], CON_GRANT[i * 5 + 1], CON_GRANT[i * 5 + 2], CON_GRANT[i * 5 + 3], CON_GRANT[i * 5 + 4]] }
}
#[inline]
fn grants_v(g: &[i32; 5]) -> bool {
    g[0] | g[1] | g[2] | g[3] | g[4] != 0
}

// Smallest transient scaffold (held then refunded) whose grants cover `need`, given `base` already held.
// DFS over distinct scaffolds (`scaf` = pool con indices, ratio-sorted), cover-table pruned. Mirrors the
// TS peakToReach exactly, including the node-cap accounting (count only when not already pruned by `best`).
struct PeakCtx<'a> {
    scaf: &'a [usize],
    need: [i32; 5],
    base: [i32; 5],
    used: Vec<bool>,
    best: i32,
    nodes: i32,
    node_cap: i32,
}
impl<'a> PeakCtx<'a> {
    fn dfs(&mut self, a: [i32; 5], size: i32) {
        if size >= self.best {
            return;
        }
        let old = self.nodes;
        self.nodes += 1;
        if old > self.node_cap {
            return;
        }
        let rem = [
            (self.need[0] - a[0]).max(0),
            (self.need[1] - a[1]).max(0),
            (self.need[2] - a[2]).max(0),
            (self.need[3] - a[3]).max(0),
            (self.need[4] - a[4]).max(0),
        ];
        if rem == [0, 0, 0, 0, 0] {
            self.best = size;
            return;
        }
        if size + cover_cost(&rem) >= self.best {
            return;
        }
        let avail = add_cap(&self.base, &a);
        for i in 0..self.scaf.len() {
            if self.used[i] {
                continue;
            }
            let ci = self.scaf[i];
            let ssize = unsafe { CON_SIZE[ci] };
            if size + ssize >= self.best || !covers(&avail, &con_req(ci)) {
                continue;
            }
            self.used[i] = true;
            self.dfs(add_cap(&a, &con_grant(ci)), size + ssize);
            self.used[i] = false;
        }
    }
}
fn peak_to_reach(scaf: &[usize], deficit: &[i32; 5], base: &[i32; 5], node_cap: i32) -> i32 {
    let need = [deficit[0].max(0), deficit[1].max(0), deficit[2].max(0), deficit[3].max(0), deficit[4].max(0)];
    if need == [0, 0, 0, 0, 0] {
        return 0;
    }
    let mut ctx = PeakCtx { scaf, need, base: *base, used: vec![false; scaf.len()], best: BIG, nodes: 0, node_cap };
    ctx.dfs([0, 0, 0, 0, 0], 0);
    ctx.best
}

// Peak of the deterministic heuristic construction order for self-covering build `members` (the TS
// minPeakSampled with tries=0). `gsorted` is every granting con index ratio-sorted; `in_b` masks B's own
// constellations out of the scaffold pool. Returns BIG (= not within budget) if not self-covering, if the
// build itself overflows budget, or if some step's deficit cannot be scaffolded.
fn min_peak(members: &[([i32; 5], [i32; 5], i32)], gsorted: &[usize], in_b: &[bool], budget: i32, node_cap: i32) -> i32 {
    let mut tot = [0; 5];
    let mut mreq = [0; 5];
    let mut total_size = 0;
    for m in members {
        tot = add_cap(&tot, &m.1);
        mreq = max_v(&mreq, &m.0);
        total_size += m.2;
    }
    if !covers(&tot, &mreq) || total_size > budget {
        return BIG;
    }
    let mut g: Vec<&([i32; 5], [i32; 5], i32)> = members.iter().filter(|m| grants_v(&m.1)).collect();
    if g.is_empty() {
        return total_size;
    }
    let reqsum = |r: &[i32; 5]| r[0] + r[1] + r[2] + r[3] + r[4];
    let ratio = |gr: &[i32; 5], sz: i32| (gr[0] + gr[1] + gr[2] + gr[3] + gr[4]) as f64 / sz as f64;
    g.sort_by(|a, b| {
        let (ra, rb) = (reqsum(&a.0), reqsum(&b.0));
        if ra != rb {
            return ra.cmp(&rb);
        }
        ratio(&b.1, b.2).partial_cmp(&ratio(&a.1, a.2)).unwrap_or(std::cmp::Ordering::Equal)
    });
    let pool: Vec<usize> = gsorted.iter().cloned().filter(|&i| !in_b[i]).collect();
    let mut grant = [0; 5];
    let mut mr = [0; 5];
    let mut size = 0;
    let mut peak = total_size;
    for m in &g {
        mr = max_v(&mr, &m.0);
        size += m.2;
        let def = [
            (mr[0] - grant[0]).max(0),
            (mr[1] - grant[1]).max(0),
            (mr[2] - grant[2]).max(0),
            (mr[3] - grant[3]).max(0),
            (mr[4] - grant[4]).max(0),
        ];
        let sc = peak_to_reach(&pool, &def, &grant, node_cap);
        if sc >= BIG {
            return BIG;
        }
        if size + sc > peak {
            peak = size + sc;
        }
        grant = add_cap(&grant, &m.1);
    }
    peak
}

const PEAK_NODE_CAP: i32 = 3000;

struct Ctx<'a> {
    fr: &'a [[i32; 5]],
    fg: &'a [[i32; 5]],
    fs: &'a [i32],
    nf: usize,
    budget: i32,
    target: [i32; 5],
    chosen: Vec<usize>,
    bcons: &'a [([i32; 5], [i32; 5], i32)],
    started: &'a [bool], // B's own constellations (started), masked out of the scaffold pool
    filler: &'a [usize], // filler index -> constellation index, to mask chosen filler too
    gsorted: &'a [usize], // every granting constellation, ratio-sorted: the scaffold pool source
    seen: FxMap,
    found: bool,
}
impl<'a> Ctx<'a> {
    fn rec(&mut self, i: usize, build: [i32; 5], cost: i32, maxreq: [i32; 5]) {
        if self.found {
            return;
        }
        if covers(&build, &maxreq) {
            // A covering node is self-covering, so every remaining filler is optional and refundable. The
            // peak witness already models using such affinity as a transient refundable scaffold (never worse
            // for the peak than keeping it permanent), so the gate-then-witness verdict HERE is FINAL: more
            // filler cannot lower the peak. Decide and RETURN, pruning the post-covering superset subtree (the
            // dominant cost). Every covering node is witnessed (no call cap), keeping the verdict order-
            // independent so this stays verdict-equivalent to the TS reachableExactFrom.
            let mut members: Vec<([i32; 5], [i32; 5], i32)> = self.bcons.to_vec();
            for &c in &self.chosen {
                members.push((self.fr[c], self.fg[c], self.fs[c]));
            }
            if peak_gate_reachable(&members, self.budget) {
                self.found = true;
                return;
            }
            let mut in_b = self.started.to_vec();
            for &c in &self.chosen {
                in_b[self.filler[c]] = true;
            }
            if min_peak(&members, self.gsorted, &in_b, self.budget, PEAK_NODE_CAP) <= self.budget {
                self.found = true;
            }
            return;
        }
        if i >= self.nf {
            return;
        }
        let target = max_v(&maxreq, &self.target);
        let deficit = [(target[0] - build[0]).max(0), (target[1] - build[1]).max(0), (target[2] - build[2]).max(0), (target[3] - build[3]).max(0), (target[4] - build[4]).max(0)];
        if cost + cover_cost(&deficit) > self.budget {
            return;
        }
        let key = (i as i64) * LATTICE * LATTICE + lidx(&build) * LATTICE + lidx(&maxreq);
        if let Some(&pc) = self.seen.get(&key) {
            if pc <= cost {
                return;
            }
        }
        if cost + self.fs[i] <= self.budget {
            self.chosen.push(i);
            let nb = add_cap(&build, &self.fg[i]);
            let nm = max_v(&maxreq, &self.fr[i]);
            self.rec(i + 1, nb, cost + self.fs[i], nm);
            self.chosen.pop();
        }
        if !self.found {
            self.rec(i + 1, build, cost, maxreq);
        }
        if !self.found {
            let e = self.seen.entry(key).or_insert(i32::MAX);
            if cost < *e {
                *e = cost;
            }
        }
    }
}

/// Decide one candidate state. Layout of the i32 buffer at `ptr`:
///   own, supply[5], target[5], nstarted, started[nstarted],
///   nbuilt, (req[5], grant[5], size) * nbuilt,
///   npf,   (builtIndex, grant[5], remaining) * npf
/// Returns 1 if a valid build <= budget exists that includes all started, else 0.
#[no_mangle]
pub extern "C" fn reachable_exact(ptr: *const i32, _len: usize, budget: i32) -> i32 {
    unsafe {
        let mut o = 0isize;
        macro_rules! rd {
            () => {{
                let x = *ptr.offset(o);
                o += 1;
                x
            }};
        }
        let own = rd!();
        let supply = [rd!(), rd!(), rd!(), rd!(), rd!()];
        let target = [rd!(), rd!(), rd!(), rd!(), rd!()];
        let nstarted = rd!() as usize;
        let mut started = vec![false; NCON];
        for _ in 0..nstarted {
            let idx = rd!() as usize;
            if idx < NCON {
                started[idx] = true;
            }
        }
        let nbuilt = rd!() as usize;
        let mut built: Vec<([i32; 5], [i32; 5], i32)> = Vec::with_capacity(nbuilt);
        for _ in 0..nbuilt {
            let req = [rd!(), rd!(), rd!(), rd!(), rd!()];
            let grant = [rd!(), rd!(), rd!(), rd!(), rd!()];
            let size = rd!();
            built.push((req, grant, size));
        }
        let npf = rd!() as usize;
        let mut pf: Vec<(usize, [i32; 5], i32)> = Vec::with_capacity(npf);
        for _ in 0..npf {
            let bi = rd!() as usize;
            let grant = [rd!(), rd!(), rd!(), rd!(), rd!()];
            let rem = rd!();
            pf.push((bi, grant, rem));
        }

        // wholeFiller: unstarted granting constellations, best grant-per-star first.
        let mut filler: Vec<usize> = Vec::new();
        for i in 0..NCON {
            if started[i] {
                continue;
            }
            let b = i * 5;
            if CON_GRANT[b] | CON_GRANT[b + 1] | CON_GRANT[b + 2] | CON_GRANT[b + 3] | CON_GRANT[b + 4] == 0 {
                continue;
            }
            filler.push(i);
        }
        filler.sort_by(|&a, &b| {
            let ra = (CON_GRANT[a * 5] + CON_GRANT[a * 5 + 1] + CON_GRANT[a * 5 + 2] + CON_GRANT[a * 5 + 3] + CON_GRANT[a * 5 + 4]) as f64 / CON_SIZE[a] as f64;
            let rb = (CON_GRANT[b * 5] + CON_GRANT[b * 5 + 1] + CON_GRANT[b * 5 + 2] + CON_GRANT[b * 5 + 3] + CON_GRANT[b * 5 + 4]) as f64 / CON_SIZE[b] as f64;
            rb.partial_cmp(&ra).unwrap_or(std::cmp::Ordering::Equal)
        });
        let fg: Vec<[i32; 5]> = filler.iter().map(|&i| [CON_GRANT[i * 5], CON_GRANT[i * 5 + 1], CON_GRANT[i * 5 + 2], CON_GRANT[i * 5 + 3], CON_GRANT[i * 5 + 4]]).collect();
        let fr: Vec<[i32; 5]> = filler.iter().map(|&i| [CON_REQ[i * 5], CON_REQ[i * 5 + 1], CON_REQ[i * 5 + 2], CON_REQ[i * 5 + 3], CON_REQ[i * 5 + 4]]).collect();
        let fs: Vec<i32> = filler.iter().map(|&i| CON_SIZE[i]).collect();
        let nf = filler.len();

        // Every granting constellation, ratio-sorted: the witness's scaffold pool (B is masked out per call).
        let mut gsorted: Vec<usize> = (0..NCON)
            .filter(|&i| CON_GRANT[i * 5] | CON_GRANT[i * 5 + 1] | CON_GRANT[i * 5 + 2] | CON_GRANT[i * 5 + 3] | CON_GRANT[i * 5 + 4] != 0)
            .collect();
        gsorted.sort_by(|&a, &b| {
            let ra = (CON_GRANT[a * 5] + CON_GRANT[a * 5 + 1] + CON_GRANT[a * 5 + 2] + CON_GRANT[a * 5 + 3] + CON_GRANT[a * 5 + 4]) as f64 / CON_SIZE[a] as f64;
            let rb = (CON_GRANT[b * 5] + CON_GRANT[b * 5 + 1] + CON_GRANT[b * 5 + 2] + CON_GRANT[b * 5 + 3] + CON_GRANT[b * 5 + 4]) as f64 / CON_SIZE[b] as f64;
            rb.partial_cmp(&ra).unwrap_or(std::cmp::Ordering::Equal)
        });

        let mut found = false;
        for mask in 0u32..(1u32 << pf.len()) {
            if found {
                break;
            }
            let mut build0 = supply;
            let mut cost0 = own;
            let mut bcons: Vec<([i32; 5], [i32; 5], i32)> = built.clone();
            for j in 0..pf.len() {
                if mask & (1 << j) != 0 {
                    build0 = add_cap(&build0, &pf[j].1);
                    cost0 += pf[j].2;
                    // A finished partial carries its full grant AND full size (selected + remaining): the
                    // witness peak math reads member size, so undercounting it would falsely pass an
                    // over-budget build (a false-reach). The resolver's own cost uses cost0 above.
                    bcons[pf[j].0].1 = pf[j].1;
                    bcons[pf[j].0].2 += pf[j].2;
                }
            }
            if cost0 > budget {
                continue;
            }
            let mut ctx = Ctx {
                fr: &fr,
                fg: &fg,
                fs: &fs,
                nf,
                budget,
                target,
                chosen: Vec::new(),
                bcons: &bcons,
                started: &started,
                filler: &filler,
                gsorted: &gsorted,
                seen: FxMap::default(),
                found: false,
            };
            ctx.rec(0, build0, cost0, target);
            found = ctx.found;
        }
        if found {
            1
        } else {
            0
        }
    }
}
