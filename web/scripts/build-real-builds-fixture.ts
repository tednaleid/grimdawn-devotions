// ABOUTME: Turn a raw grimtools harvest (scripts/gt_harvest_builds.ts) into the committed
// ABOUTME: real-build corpus web/test/fixtures/real-builds.json, gated per build and reported.
//
// Usage: bun scripts/build-real-builds-fixture.ts RAW_IN FIXTURE_OUT
// Aborts when the harvest's grimtools data version differs from the committed mapping
// table's (stale table: run `just gt-star-table` first). Skips are per build and loud.
import { readFileSync, writeFileSync } from "node:fs";
import { mapStars, type StarTable } from "../src/core/grimtools";
import { buildModel } from "../src/core/model";
import { buildReachCons, buildCoverTable, BUDGET } from "../src/core/reachability";
import { repairSelection } from "../src/core/rules";
import { canonicalStarIds } from "../src/core/urlState";

export interface RawBuild {
  source: string;
  title: string;
  slug: string;
  gameVersion: string;
  skillIds: string[];
  devotionPointsLeft: number | null;
}
export interface FixtureBuild {
  source: string;
  calc: string;
  title: string;
  starIds: string[];
}

export function convertRawBuild(
  raw: RawBuild,
  table: StarTable,
  known: Set<string>,
  repair: (stars: string[]) => Set<string>,
): { ok: FixtureBuild } | { skip: string } {
  const stars = mapStars(raw.skillIds, table);
  if (stars.length === 0) return { skip: "no-devotions" };
  for (const s of stars) if (!known.has(s)) return { skip: `unknown-star ${s}` };
  const repaired = repair(stars);
  if (repaired.size !== stars.length || stars.some((s) => !repaired.has(s)))
    return { skip: `fails-repair (${stars.length} -> ${repaired.size})` };
  return {
    ok: {
      source: raw.source,
      calc: `https://www.grimtools.com/calc/${raw.slug}`,
      title: raw.title,
      starIds: [...stars].sort(),
    },
  };
}

if (import.meta.main) {
  const [rawPath, outPath] = process.argv.slice(2);
  if (!rawPath || !outPath) {
    console.error("usage: bun scripts/build-real-builds-fixture.ts RAW_IN FIXTURE_OUT");
    process.exit(2);
  }
  const harvest = JSON.parse(readFileSync(rawPath, "utf8")) as {
    harvestedUtc: string;
    grimtoolsDataVersion: string;
    builds: RawBuild[];
  };
  const starsFile = JSON.parse(readFileSync(new URL("../../data/grimtools-stars.json", import.meta.url), "utf8")) as {
    dataVersion: string;
    stars: StarTable;
  };
  if (harvest.grimtoolsDataVersion !== starsFile.dataVersion) {
    console.error(
      `stale mapping table: harvest saw grimtools data ${harvest.grimtoolsDataVersion}, ` +
        `table is ${starsFile.dataVersion}. Run: just gt-star-table`,
    );
    process.exit(2);
  }
  const doc = JSON.parse(readFileSync(new URL("../../data/devotions.json", import.meta.url), "utf8"));
  const model = buildModel(doc);
  const cons = buildReachCons(model);
  const covTable = buildCoverTable(cons);
  const known = new Set(canonicalStarIds(model));
  const repair = (stars: string[]) => repairSelection(model, cons, covTable, new Set(stars), BUDGET);

  const out: FixtureBuild[] = [];
  const skips: Record<string, number> = {};
  for (const raw of harvest.builds) {
    const r = convertRawBuild(raw, starsFile.stars, known, repair);
    if ("skip" in r) {
      skips[r.skip.split(" ")[0]!] = (skips[r.skip.split(" ")[0]!] ?? 0) + 1;
      console.error(`skip ${raw.slug}: ${r.skip} (${raw.source})`);
      continue;
    }
    if (raw.devotionPointsLeft !== null && 55 - raw.devotionPointsLeft !== r.ok.starIds.length)
      console.error(
        `warn ${raw.slug}: mapped ${r.ok.starIds.length} stars but bio says ${55 - raw.devotionPointsLeft} spent ` +
          `(sub-55 earned points or table drift; kept)`,
      );
    out.push(r.ok);
  }
  writeFileSync(
    outPath,
    JSON.stringify(
      { harvestedUtc: harvest.harvestedUtc, grimtoolsDataVersion: harvest.grimtoolsDataVersion, builds: out },
      null,
      1,
    ),
  );
  console.error(`wrote ${outPath}: ${out.length}/${harvest.builds.length} builds; skips ${JSON.stringify(skips)}`);
  if (out.length < 50) {
    console.error("harvest is thin (< 50 mappable builds): investigate the skips before committing");
    process.exit(1);
  }
}
