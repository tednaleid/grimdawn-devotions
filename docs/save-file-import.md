# Save-file import

The planner can read a Grim Dawn character save (`player.gdc`) and load its devotion
selection and point budget. The whole parse runs in the page: the file is read through a
file input, decoded in `web/src/core/gdSave.ts`, and never leaves the browser. Unlike the
grimtools import, this path needs no worker, no network call, and no third-party service.

## What the user gets

Choosing a character file sets the planner's selection to that character's devotion stars
and its point cap to the devotion points the character has earned. The panel reports the
character name and level, and how many of the earned points are spent. The result lands in
the URL hash like any other planner state, so the loaded build is shareable; the character's
name and level are session feedback only and are deliberately not part of the hash.

Saves live under `Steam/userdata/<id>/219990/remote/save/main/<character>/player.gdc` for
Steam Cloud, or `Documents/My Games/Grim Dawn/save/main/` without it. The game holds the
files open while it runs, so the user has to close it first.

## The file format

Only `dataVersion` 8 is read. A different version is refused outright rather than decoded
into plausible nonsense, which is the failure mode worth avoiding: a wrong layout still
produces record paths and small integers, just the wrong ones.

### The cipher

The first `uint32` is a seed stored in the clear. The key starts as `seed ^ 0x55555555`, and
a 256-entry table is derived from it, one rotate-right-by-one and multiply by `39916801` per
entry. Reading a value XORs it with the current key, then advances the key by XORing in
`table[b]` for each **raw** (still encrypted) byte consumed.

Two consequences shape the whole parser:

- Key state depends only on how many bytes have been consumed, not on how they were grouped.
  A `uint32` read and four byte reads leave the key in the same place.
- Some fields are **frozen**: they are XORed with the key but do not advance it. Block lengths
  and block end markers are the ones that matter. A reader that treats them as ordinary reads
  desynchronizes permanently, and every string after that point decodes to a constant XOR of
  the truth, which looks like noise rather than an obvious failure.

### Layout

```
u32  seed (clear)
u32  magic = 0x58434447 ("GDCX")
u32  file version (2)
wstr character name          ; u32 char count, then per char: u8 low, u8 high
u8   sex
astr class tags              ; u32 length, then that many u8
u32  level
u8   hardcore
u8   expansions owned (bitmask)
u32  checksum                [frozen]
u32  data version (8)
16 x u8 reserved
blocks to EOF:
  u32  block id
  u32  content length        [frozen]
  <content>
  u32  end marker = 0        [frozen]
```

### Stepping over blocks

The inventory and stash nest their own frozen length fields, so walking their contents
correctly would mean understanding item structures the planner has no use for. It does not
have to. Every block ends with a marker whose plaintext is zero, which means the raw bytes
stored there **are** the key. Reading them resynchronizes the key exactly, so any block can be
skipped by position regardless of what it contains. This is what lets the parser walk a
character file to the byte without modelling inventory at all.

### Block 2: points

Twelve `uint32` values. Index 1 is the character level, 2 is experience, 4 is unspent skill
points, **5 is unspent devotion points**, and **6 is total devotion points earned**. The rest
are attribute points and float stats.

### Block 8: skills

```
u32  block version
u32  entry count
count x:
  astr record path
  u32  level
  16 bytes                   ; enabled, devotion level, devotion experience, sublevel
  astr autocast skill
  astr autocast controller
u32  masteries allowed
u32  skill reclamation points used
u32  devotion reclamation points used
```

A devotion star is an entry whose record path contains `/devotion/` and whose level is above
zero. Every star costs one point, so the count of those entries equals earned minus unspent,
which the parser's tests assert as a self-check.

The two autocast fields hold record paths of their own, so they are indistinguishable from the
next entry's name. They must be **read**, never scanned past. A reader that looks for the next
record path to find the next entry treats each bound skill's autocast value as an entry, falls
one behind for the rest of the block, and reports duplicate stars. That failure is quiet: the
star set still looks reasonable, and only the entry count gives it away.

## Mapping stars to the planner

`starIdsByDbr` in `web/src/core/model.ts` maps each star's `dbr` from `data/devotions.json`
to its planner star id. The record path is the one identifier the game and this dataset
already agree on, so no separate mapping table is needed (unlike the grimtools import, which
needs `data/grimtools-stars.json`). Crossroads stars are ordinary stars here and need no
special handling. A record the dataset does not know (a mod, or a save newer than the
dataset) is dropped and counted in the panel's dropped-star line.

## The gate

`web/test/gdSaveImport.test.ts` holds the invariant: every build read from a save is mapped
completely, reconciles against the save's own point counters, and is put through
`verifyBuildOrder`, the same independent oracle that gates the build-order panel. Parsing is
not enough; a selection that cannot be built legally is a bug wherever it came from.

Fixtures are synthesized by `web/test/helpers/gdSaveFixture.ts`, which implements the writer
half of the format from this spec. No real save is committed. `web/test/fixtures/save-builds.json`
carries only the devotion selections of real characters, as star record paths.
