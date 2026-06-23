// ABOUTME: Encode/decode the precomputed cover-table blob (magic + version + buildId + Uint16 grid).
// ABOUTME: caps/strides are recomputed from the model on decode, so the blob is almost pure payload.
import { createHash } from "node:crypto";
import { coverDims, type CoverTable, type ReachCon } from "../core/reachability";

const MAGIC = "GDCT";
const VERSION = 1;
const HEADER = 4 + 1 + 16; // magic + version + 16-byte buildId

export function computeBuildId(devotionsJsonText: string): string {
  return createHash("sha256").update(devotionsJsonText).digest("hex").slice(0, 16);
}

export function encodeCoverBlob(table: CoverTable, buildId: string): Uint8Array {
  if (buildId.length !== 16) throw new Error(`buildId must be 16 chars, got ${buildId.length}`);
  const body = new Uint8Array(table.cost.buffer, table.cost.byteOffset, table.cost.byteLength);
  const out = new Uint8Array(HEADER + body.byteLength);
  out.set(
    [...MAGIC].map((c) => c.charCodeAt(0)),
    0,
  );
  out[4] = VERSION;
  out.set(
    [...buildId].map((c) => c.charCodeAt(0)),
    5,
  );
  out.set(body, HEADER);
  return out;
}

export function decodeCoverBlob(bytes: Uint8Array, cons: ReachCon[]): { table: CoverTable; buildId: string } {
  if (String.fromCharCode(...bytes.slice(0, 4)) !== MAGIC) throw new Error("cover blob: bad magic");
  if (bytes[4] !== VERSION) throw new Error(`cover blob: unsupported version ${bytes[4]}`);
  const buildId = String.fromCharCode(...bytes.slice(5, 21));
  const dims = coverDims(cons); // caps/strides depend only on the model's reqs
  const expected = dims.caps.reduce((a, c) => a * (c + 1), 1);
  const body = bytes.slice(HEADER);
  if (body.byteLength !== expected * 2)
    throw new Error(`cover blob: body ${body.byteLength} bytes, expected ${expected * 2}`);
  const cost = new Uint16Array(body.buffer, body.byteOffset, expected).slice();
  return { table: { cost, caps: dims.caps, strides: dims.strides }, buildId };
}
