// ABOUTME: Maps a save's devotion records onto planner star ids, and gates the result: every build
// ABOUTME: read from a save must survive the independent build-order legality oracle.
import { test, expect } from "bun:test";
import { starIdsByDbr } from "../src/core/model";
import { model, cons, table as coverTable } from "../scripts/reachability-fuzz";
import doc from "../../data/devotions.json";
import builds from "./fixtures/save-builds.json";
import { makeSave } from "./helpers/gdSaveFixture";
import { parseSave } from "../src/core/gdSave";
import { buildOrderPath, selectionSummary } from "../src/core/reachability";
import { verifyBuildOrder } from "../src/core/orderLegality";

test("every star in the dataset is addressable by its game record path", () => {
  const table = starIdsByDbr(doc as never);
  expect(table.get("records/skills/devotion/tier1_04a.dbr")).toBe("hammer:0");
  expect(table.size).toBe(model.stars.size);
});

// The gate the project keeps over every rendered schedule, applied to save import: a selection
// read out of a save file must survive the independent legality oracle, not merely parse. The
// fixture holds the devotion selections of real characters, star record paths only.
test("every build read from a save fixture maps completely and gets a legal order", () => {
  const table = starIdsByDbr(doc as never);
  for (const build of builds) {
    const bytes = makeSave({
      devotionTotal: build.devotionTotal,
      devotionUnspent: build.devotionUnspent,
      skills: build.stars.map((dbr) => ({ dbr, level: 1 })),
    });
    const result = parseSave(bytes);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") continue;
    const character = result.character;

    expect(character.starDbrs.length).toBe(character.devotionTotal - character.devotionUnspent);
    const selected = new Set<string>();
    for (const dbr of character.starDbrs) {
      const id = table.get(dbr);
      expect(id, `${dbr} has no star id`).toBeDefined();
      selected.add(id!);
    }

    const members = selectionSummary(model, selected).built;
    const steps = buildOrderPath(cons, coverTable, members, character.devotionTotal, 16);
    expect(steps, `no order for a ${selected.size}-point save build`).not.toBeNull();
    expect(verifyBuildOrder(cons, members, steps!, character.devotionTotal)).toBeNull();
  }
});
