// ABOUTME: Synthesizes minimal Grim Dawn player.gdc files for tests, so no real save is committed.
// ABOUTME: Written from the format spec independently of src/core/gdSave.ts, which it cross-checks.
const MAGIC = 0x58434447;
const SEED_MASK = 0x55555555;
const TABLE_MULTIPLIER = 39916801;

/** The writer half of the save's stream cipher. `frozen` writes emit a value XORed with the key
 *  without advancing it, which is how the game stores block lengths and block end markers. */
class Writer {
  private readonly table = new Uint32Array(256);
  private key: number;
  readonly out: number[] = [];

  constructor(seedRaw: number) {
    const seed = (seedRaw ^ SEED_MASK) >>> 0;
    let k = seed;
    for (let i = 0; i < 256; i++) {
      k = ((k >>> 1) | (k << 31)) >>> 0;
      k = Math.imul(k, TABLE_MULTIPLIER) >>> 0;
      this.table[i] = k;
    }
    this.key = seed;
    this.out.push(seedRaw & 0xff, (seedRaw >>> 8) & 0xff, (seedRaw >>> 16) & 0xff, (seedRaw >>> 24) & 0xff);
  }

  /** The key state right now, which is exactly what a block end marker encodes to. */
  get currentKey(): number {
    return this.key;
  }

  private emit(raw: number[], advance: boolean): void {
    for (const b of raw) {
      this.out.push(b);
      if (advance) this.key = (this.key ^ this.table[b]!) >>> 0;
    }
  }

  u8(v: number): void {
    this.emit([(v ^ this.key) & 0xff], true);
  }

  u32(v: number, advance = true): void {
    const raw = (v ^ this.key) >>> 0;
    this.emit([raw & 0xff, (raw >>> 8) & 0xff, (raw >>> 16) & 0xff, (raw >>> 24) & 0xff], advance);
  }

  ascii(s: string): void {
    this.u32(s.length);
    for (let i = 0; i < s.length; i++) this.u8(s.charCodeAt(i));
  }

  wide(s: string): void {
    this.u32(s.length);
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      this.u8(c & 0xff);
      this.u8((c >>> 8) & 0xff);
    }
  }

  /** id, frozen length, content, frozen zero end marker. */
  block(id: number, content: (w: Writer) => void): void {
    this.u32(id);
    // The length is frozen, so the key here is still the key the content starts from: capture it,
    // write a placeholder, then patch the real length in against that same key.
    const lengthKey = this.key;
    const lengthAt = this.out.length;
    this.u32(0, false);
    const start = this.out.length;
    content(this);
    const raw = ((this.out.length - start) ^ lengthKey) >>> 0;
    this.out[lengthAt] = raw & 0xff;
    this.out[lengthAt + 1] = (raw >>> 8) & 0xff;
    this.out[lengthAt + 2] = (raw >>> 16) & 0xff;
    this.out[lengthAt + 3] = (raw >>> 24) & 0xff;
    this.u32(0, false); // end marker: plaintext zero, so the raw bytes are the key itself
  }
}

export interface FixtureSkill {
  dbr: string;
  level: number;
  autoCast?: string;
}

export interface FixtureOptions {
  name?: string;
  level?: number;
  hardcore?: boolean;
  dataVersion?: number;
  devotionUnspent?: number;
  devotionTotal?: number;
  skills?: FixtureSkill[];
  /** Emits a decoy block whose content holds a nested frozen length, the way the inventory does.
   *  A parser that does not resync its key at block ends cannot read past it. */
  nestedDecoy?: boolean;
  seed?: number;
}

export function makeSave(opts: FixtureOptions = {}): Uint8Array {
  const name = opts.name ?? "Fixture";
  const skills = opts.skills ?? [];
  const w = new Writer(opts.seed ?? 0x12345678);

  w.u32(MAGIC);
  w.u32(2); // file version
  w.wide(name);
  w.u8(1); // sex
  w.ascii("tagSkillClassName0407");
  w.u32(opts.level ?? 100);
  w.u8(opts.hardcore ? 1 : 0);
  w.u8(7); // all three expansions
  w.u32(0, false); // checksum, frozen
  w.u32(opts.dataVersion ?? 8);
  for (let i = 0; i < 16; i++) w.u8(0);

  w.block(1, (b) => {
    b.u32(8); // block version
    b.ascii("creatures/pc/hero02.tex");
  });

  w.block(2, (b) => {
    const values = [8, opts.level ?? 100, 28475316, 0, 0, opts.devotionUnspent ?? 0, opts.devotionTotal ?? 55];
    for (const v of values) b.u32(v);
    for (let i = values.length; i < 12; i++) b.u32(0);
  });

  if (opts.nestedDecoy !== false) {
    w.block(3, (b) => {
      b.u32(8);
      // A nested id/frozen-length/content group, as the inventory bags use.
      b.u32(1);
      b.u32(4, false); // frozen: this is what desynchronizes a naive reader
      b.u32(0);
    });
  }

  w.block(8, (b) => {
    b.u32(8); // block version
    b.u32(skills.length);
    for (const s of skills) {
      b.ascii(s.dbr);
      b.u32(s.level);
      b.u32(1); // enabled
      b.u32(0); // devotion level
      b.u32(0); // devotion experience
      b.u32(0); // sublevel
      b.ascii(s.autoCast ?? "");
      b.ascii(""); // autocast controller
    }
    b.u32(2); // masteries allowed
    b.u32(0); // skill reclamation points used
    b.u32(0); // devotion reclamation points used
  });

  return new Uint8Array(w.out);
}
