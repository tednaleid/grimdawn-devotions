// ABOUTME: Parses a Grim Dawn player.gdc character save: its stream cipher, block framing, and
// ABOUTME: the devotion selection plus point totals. Pure; takes bytes and returns plain data.

const MAGIC = 0x58434447; // "GDCX"
const SEED_MASK = 0x55555555;
const TABLE_MULTIPLIER = 39916801;

/** The only save format this parser claims to read. Every save written by the current game is 8;
 *  refusing anything else is honest, since a different layout would decode to plausible nonsense. */
const SUPPORTED_DATA_VERSION = 8;

class CorruptSave extends Error {}

/** Grim Dawn's stream cipher. The key is a running XOR of table entries over every raw byte
 *  consumed, so key state depends only on how many bytes were read, not how they were grouped. */
class Reader {
  readonly table: Uint32Array;
  key: number;
  pos = 4;

  constructor(readonly bytes: Uint8Array) {
    const seed = (this.rawU32(0) ^ SEED_MASK) >>> 0;
    this.table = new Uint32Array(256);
    let k = seed;
    for (let i = 0; i < 256; i++) {
      k = ((k >>> 1) | (k << 31)) >>> 0;
      k = Math.imul(k, TABLE_MULTIPLIER) >>> 0;
      this.table[i] = k;
    }
    this.key = seed;
  }

  /** Every read goes through this. A save that decodes to nonsense produces wild lengths, so
   *  refusing to run past the buffer is what keeps a corrupt file from becoming a long loop. */
  private need(n: number): void {
    if (n < 0 || this.pos + n > this.bytes.length) throw new CorruptSave();
  }

  private advance(from: number, to: number): void {
    for (let i = from; i < to; i++) this.key = (this.key ^ this.table[this.bytes[i]!]!) >>> 0;
  }

  u32(): number {
    this.need(4);
    const v = (this.rawU32(this.pos) ^ this.key) >>> 0;
    this.advance(this.pos, this.pos + 4);
    this.pos += 4;
    return v;
  }

  u8(): number {
    this.need(1);
    const raw = this.bytes[this.pos]!;
    const v = raw ^ (this.key & 0xff);
    this.advance(this.pos, this.pos + 1);
    this.pos += 1;
    return v;
  }

  /** Block lengths and end markers: XORed with the key, but they do not advance it. */
  frozenU32(): number {
    this.need(4);
    const v = (this.rawU32(this.pos) ^ this.key) >>> 0;
    this.pos += 4;
    return v;
  }

  rawU32(at: number): number {
    const b = this.bytes;
    return (b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16) | (b[at + 3]! << 24)) >>> 0;
  }

  ascii(): string {
    const n = this.u32();
    this.need(n);
    let s = "";
    for (let i = 0; i < n; i++) s += String.fromCharCode(this.u8());
    return s;
  }

  wide(): string {
    const n = this.u32();
    this.need(n * 2);
    let s = "";
    for (let i = 0; i < n; i++) s += String.fromCharCode(this.u8() | (this.u8() << 8));
    return s;
  }

  skip(n: number): void {
    this.need(n);
    this.advance(this.pos, this.pos + n);
    this.pos += n;
  }
}

export type SaveErrorCode = "notSave" | "version" | "corrupt";

export interface SaveCharacter {
  name: string;
  level: number;
  hardcore: boolean;
  /** Devotion points the character has earned in total: the planner's point budget. */
  devotionTotal: number;
  /** Earned points not yet spent. Total minus this is what the selection below accounts for. */
  devotionUnspent: number;
  /** Record paths of the devotion stars the character has taken, in save order. */
  starDbrs: string[];
}

export type SaveParseResult = { kind: "ok"; character: SaveCharacter } | { kind: "error"; code: SaveErrorCode };

const POINTS_BLOCK = 2;
const SKILLS_BLOCK = 8;
/** Fixed bytes between a skill entry's level and its two autocast strings: enabled, devotion
 *  level, devotion experience and sublevel. The parser needs none of them, only their width. */
const SKILL_ENTRY_FIELD_BYTES = 16;
const DEVOTION_RECORD = "/devotion/";
/** A sanity bound on the skill count, so a misread length allocates nothing absurd. */
const MAX_SKILL_ENTRIES = 4096;
const DEVOTION_UNSPENT_INDEX = 5;
const DEVOTION_TOTAL_INDEX = 6;
/** Block ids run well under this; a larger one means the walk has lost the framing. */
const MAX_BLOCK_ID = 60;

/**
 * Positions the reader at the start of block `id`.
 *
 * Every block ends with a marker whose plaintext is zero, so the raw bytes there are the key
 * itself. Resyncing from that marker is what lets this walk step over blocks it does not
 * understand: the inventory and stash nest their own frozen length fields, which would otherwise
 * leave the key permanently out of step.
 */
function seekBlock(r: Reader, id: number): boolean {
  while (r.pos + 8 <= r.bytes.length) {
    const blockId = r.u32();
    const length = r.frozenU32();
    const end = r.pos + length;
    if (blockId <= 0 || blockId >= MAX_BLOCK_ID || end + 4 > r.bytes.length) return false;
    if (blockId === id) return true;
    r.key = r.rawU32(end);
    r.pos = end + 4;
  }
  return false;
}

export function parseSave(bytes: Uint8Array): SaveParseResult {
  try {
    return readSave(bytes);
  } catch (e) {
    if (e instanceof CorruptSave) return { kind: "error", code: "corrupt" };
    throw e;
  }
}

function readSave(bytes: Uint8Array): SaveParseResult {
  if (bytes.length < 8) return { kind: "error", code: "notSave" };
  const r = new Reader(bytes);
  if (r.u32() !== MAGIC) return { kind: "error", code: "notSave" };
  r.u32(); // file version
  const name = r.wide();
  r.u8(); // sex
  r.ascii(); // class tags
  const level = r.u32();
  const hardcore = r.u8() !== 0;
  r.u8(); // expansions owned
  r.frozenU32(); // checksum
  if (r.u32() !== SUPPORTED_DATA_VERSION) return { kind: "error", code: "version" };
  r.skip(16); // reserved

  const afterHeader = { pos: r.pos, key: r.key };
  if (!seekBlock(r, POINTS_BLOCK)) return { kind: "error", code: "corrupt" };
  const points: number[] = [];
  for (let i = 0; i < 12; i++) points.push(r.u32());
  const devotionUnspent = points[DEVOTION_UNSPENT_INDEX]!;
  const devotionTotal = points[DEVOTION_TOTAL_INDEX]!;
  r.pos = afterHeader.pos;
  r.key = afterHeader.key;

  if (!seekBlock(r, SKILLS_BLOCK)) return { kind: "error", code: "corrupt" };
  r.u32(); // block version
  const count = r.u32();
  if (count > MAX_SKILL_ENTRIES) return { kind: "error", code: "corrupt" };
  const starDbrs: string[] = [];
  for (let i = 0; i < count; i++) {
    const record = r.ascii();
    const skillLevel = r.u32();
    r.skip(SKILL_ENTRY_FIELD_BYTES);
    // Both autocast fields hold record paths of their own. They are read, never scanned past:
    // a reader that hunted for the next entry by looking for a record path would mistake them
    // for entries and fall one behind for the rest of the block.
    r.ascii(); // autocast skill
    r.ascii(); // autocast controller
    if (skillLevel > 0 && record.includes(DEVOTION_RECORD)) starDbrs.push(record);
  }

  return { kind: "ok", character: { name, level, hardcore, devotionTotal, devotionUnspent, starDbrs } };
}
