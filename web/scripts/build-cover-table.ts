// ABOUTME: Build-time generator: serialize the cover table to data/cover-table.bin with a buildId.
// ABOUTME: Run by `just cover-table`; the blob is gitignored and rebuilt from committed devotions.json.
import { buildModel } from "../src/core/model";
import { buildReachCons, buildCoverTable } from "../src/core/reachability";
import { encodeCoverBlob, computeBuildId } from "../src/adapters/coverTableBlob";
import { fileURLToPath } from "url";
import { resolve } from "path";

const scriptPath = fileURLToPath(import.meta.url);
const webDir = resolve(scriptPath, "..", "..");
const root = resolve(webDir, "..");
const jsonPath = resolve(root, "data", "devotions.json");
const binPath = resolve(root, "data", "cover-table.bin");

const jsonText = await Bun.file(jsonPath).text();
const buildId = computeBuildId(jsonText);
const cons = buildReachCons(buildModel(JSON.parse(jsonText)));
const blob = encodeCoverBlob(buildCoverTable(cons), buildId);
await Bun.write(binPath, blob);
console.log(`wrote data/cover-table.bin (${blob.byteLength} bytes, buildId ${buildId})`);
