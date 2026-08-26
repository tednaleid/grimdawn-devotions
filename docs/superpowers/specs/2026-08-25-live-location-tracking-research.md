# Live character location from save files: what the data actually supports

**Result: it does not work.** Grim Dawn's save files do not carry the player's
current position, and no combination of the values they do carry adds up to one.
This record exists so nobody re-runs the investigation, and because two findings
along the way are useful for a future map project.

The idea under test: read the player's location while the game runs and drive a
map in a browser window on another machine, updating as the character moves. Not
per-frame coordinates, just "where is the character now" at some usable rate.

## What the investigation established

Measured on 2026-08-25 against a live game session, save data version 8, on a
Steam Cloud install (`Steam/userdata/<id>/219990/remote/save/main/<character>/`).

**`player.gdc` has no position field.** Every block was scanned for float triples
shaped like a world coordinate. The small structural blocks (5, 7, 10, 15, 16)
contain none, and every candidate in the large blocks is a coincidental float
reading of string or integer data. Blocks 5 and 6, the respawn and teleport lists,
store 16-byte UIDs referencing world objects rather than coordinates: a character
played between two snapshots gained one more UID in block 5 and twelve in block 6,
which is what discovering riftgates looks like. See
[the save format](../../save-file-import.md) for the block layout.

**`levels_world001.map/<difficulty>/map.dat` holds a real world coordinate, but it
is not the player.** The file is 171 bytes of plaintext key/value pairs:

```
mapVersion = 2
mapPath = 'levels/world001.map'
modName = ''
streamSpawnCoords = 1
spawnCoords: 3x3 identity matrix, then xyz, then a 16-byte region UID
```

`spawnCoords` is the riftgate the character is anchored to. It is written on every
autosave and holds the same value every time.

**Nothing short of activating a different riftgate moves it.** Each of these was
tested against the live game with the file under observation:

| Event | `map.dat` writes | `spawnCoords` |
|---|---|---|
| Normal play, 170 seconds | 2 | unchanged |
| Teleport to the town already anchored | 0 | unchanged |
| Doorway into a sub-area, and back | 2 | unchanged |
| Quit to menu | 1 | unchanged |

Area transitions were the most promising trigger and they do nothing. A trapdoor
round trip rewrote `map.dat` twice with the same coordinate both times.

**The write cadence is a ~70 second autosave.** `player.gdc` and `map.dat` are
written in the same event, milliseconds apart, and only for the difficulty being
played (other difficulties keep months-old mtimes). Frequency was never the
problem; the payload is static.

**`map.fow` tracks exploration, not presence.** The fog-of-war file is plaintext
headed (`FOWX` magic, a revealed-chunk counter, one region name) with a packed
body. It grows as new ground is revealed, appending at the tail, and it looked at
first like a live position signal. It is not: it is silent in explored territory,
which is all of endgame play. Observed on an already-explored area, it did not
grow at all and shrank slightly as it re-packed.

**The `map.fow` header region does not follow the player.** It stayed at
`Levels/Region0C001.lvl` after teleporting to a different area. It is an anchor,
not the current region. This was the last cheap idea standing, because a
presence-based signal would have survived a fully-explored map where a
novelty-based one cannot, and it does not exist.

## Why the whole category fails

Every signal in the save files is driven by **novelty, not presence**: new
experience, new loot, new ground, new riftgate. A character running a familiar
farming route generates almost none, which is exactly when a tracker would be
wanted. The files are faithfully rewritten every 70 seconds and say the same thing
each time.

The only remaining source is the game's process memory, which is what existing
Grim Dawn tools use for live state. That costs offsets that break on every patch
plus an agent running on the gaming machine, and it is a different project.

## Do not drive the grimtools map

An embedded grimtools map was the original delivery idea. Two reasons it is a dead
end, beyond the missing position data.

Same-origin policy means a cross-origin iframe cannot be scripted, so there is no
way to pan their map from the host page. The only lever is the `src` attribute,
which reloads their whole page on every update, ad script included. `postMessage`
would be the clean path and needs a listener they do not have.

Independently: the site owner already firewalled this project's import worker (see
BACKLOG.md). An iframe reloading their ad-supported map on a timer is more traffic
and more conspicuous than the import ever was.

## What is worth keeping

Two findings survive the negative result and are the reason this file exists.

**`map.dat` is plaintext and `spawnCoords` is a real world coordinate.** No cipher,
64 bytes, trivially parsed. It is a usable source of ground-truth coordinates.

**`83.197, 7.711, 48.409` with region UID `02bb63762e4010d58ede9fb30968866b` is the
Devil's Crossing riftgate.** Identified by standing there and reading the file. It
is the value 8 of 11 observed save files carried, since most characters are last
anchored at the main town.

That is one calibration point for a coordinate frame, and more are cheap: ride a
riftgate somewhere recognizable, read `map.dat`, record the pair. The coordinates
are region-local (values in the tens to low hundreds, paired with a region UID), so
turning them into map positions still needs the region-to-world offsets. Those live
in the game's own archives, which are extractable with the existing pipeline:
`Levels.arc` (222 MB), `Level Art.arc` (848 MB), `Terrain Textures.arc` (193 MB).

## If someone picks this up

For a rendered map of our own, the calibration approach above is the starting
point, and the level and terrain archives are the data. That is a substantial
reverse-engineering project on its own and should be wanted for its own sake, not
as a means to a tracker.

For a tracker specifically, go to process memory or do not start.
