// ABOUTME: Renders one item's full skill-by-skill breakdown: every touched skill's level grant
// ABOUTME: and/or modifier lines, its pet panel when it carries one, and the grimtools link.
import { gameFormatT, gameT, litT, resolveText, type Text } from "../../core/localization";
import type { Localization } from "../../ports/Localization";
import { rowEffectLines, type EffectContext, type ModStat } from "../core/effectText";
import type { Item, ItemSet, PetBlock, PetStat, Skill } from "../core/model";
import { effectHtml } from "./effectMarkup";

// Everything the detail view needs beyond EffectContext: a Localization to resolve Text (the
// summary table only ever hands resolved strings to esc(), but the detail view builds its own
// markup so it resolves directly), a mastery-name resolver for item.masteryBoosts (nameOf only
// covers skills), and a skill lookup so Task 16's pet panel can find a touched skill's PetBlocks
// (Item itself carries no pet data - that lives on the Skill record).
export interface DetailContext extends EffectContext {
  loc: Localization;
  masteryNameOf: (record: string) => Text | undefined;
  skillOf: (record: string) => Skill | undefined;
  // The set a piece belongs to, when the catalogue carries it. A set's bonuses are stored once
  // rather than on each member, so the item alone cannot answer this.
  setOf: (record: string | null) => ItemSet | undefined;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

function render(loc: Localization, t: Text): string {
  return esc(resolveText(loc, t));
}

function skillName(ctx: DetailContext, record: string): Text {
  return ctx.nameOf(record) ?? litT(record);
}

// One entry per skill record the item touches, in first-appearance order (modifiers first, then
// boosts): a modifier block and a level grant on the SAME skill record merge into one entry (e.g.
// Badge of the Crimson Company's Leap: a modifier block AND a +2 boost), but a modifier on one
// record and a boost on a differently-recorded sibling (that item's Cadence modifier is on
// cadence1.dbr, its boost is on cadence2.dbr) stay separate entries - they are, in the raw data,
// different skill records, not the same skill twice.
interface SkillEntry {
  record: string;
  modBlocks: ModStat[][];
  boostLevel: number;
}

function touchedSkills(item: Item): SkillEntry[] {
  const byRecord = new Map<string, SkillEntry>();
  const order: string[] = [];
  const entryFor = (record: string): SkillEntry => {
    let e = byRecord.get(record);
    if (!e) {
      e = { record, modBlocks: [], boostLevel: 0 };
      byRecord.set(record, e);
      order.push(record);
    }
    return e;
  };
  for (const mb of item.modifiers) entryFor(mb.skill).modBlocks.push(mb.stats);
  for (const b of item.boosts) entryFor(b.skill).boostLevel += b.level;
  return order.map((r) => byRecord.get(r)!);
}

// Three engine MULTIPLIERS that occur only on pet records (0 occurrences across every item
// modifier block; 56 across the pet panels), while their tags are the ordinary percentage
// templates ("{%+.0f0}% Attack Speed" and siblings). Passing the raw record value through
// printed the multiplier as if it were a bonus: 0.79 read "+1% Attack Speed" where the truth
// is -21%, 1.5 read "+2% Movement Speed" where the truth is +50%, and an untouched 1.0 invented
// a bonus that does not exist. The multiplier-ness is a property of the pet source, not of the
// tag - characterAttackSpeedModifier on an item block is an honest percentage and is untouched.
const PET_MULTIPLIER = new Set(["characterAttackSpeed", "characterRunSpeed", "characterSpellCastSpeed"]);

// PetStat carries first/max/ultimate, not the single `value` ModStat/effectLines need (see
// task-14-16-report.md for the fuller rationale): this always uses `max`, the value at the
// skill's normal rank cap without an Ultimate-difficulty unlock. It matches what the table's own
// "Levels" column already reports (the maximum level an item enables, not an entry-level or
// Ultimate-gated figure), and picking one number keeps each stat one line instead of a three-way
// first/max/ultimate spread that effectLines' template composition isn't shaped to produce.
// Returns null for a stat that has no line to render at all: a multiplier of exactly 1.0 is the
// engine's neutral value, not a bonus.
function petStatToModStat(s: PetStat): ModStat | null {
  if (!PET_MULTIPLIER.has(s.stat)) return { stat: s.stat, value: s.max };
  if (s.max === 1) return null;
  return { stat: s.stat, value: (s.max - 1) * 100 };
}

// Ability rows are grouped for DISPLAY by source_name_tag (Task 16 Step 2), but effectLines is
// still called once per distinct `source` record (the real block boundary, same as a ModBlock's
// skill): two different abilities could in principle share a name tag, and flattening their stats
// into one effectLines call would let one ability's Min pair with the other's Max - the exact
// Krieg's Mask shape this file must not reintroduce. rowEffectLines is what keeps that safe: it
// calls effectLines per block and only ever concatenates the resulting LINES.
function petStatLines(ctx: DetailContext, stats: PetStat[]) {
  const bySource = new Map<string, PetStat[]>();
  for (const s of stats) {
    const arr = bySource.get(s.source) ?? [];
    arr.push(s);
    bySource.set(s.source, arr);
  }
  const blocks = [...bySource.values()].map((group) =>
    group.map(petStatToModStat).filter((s): s is ModStat => s !== null),
  );
  return rowEffectLines(blocks, ctx);
}

function petPanelHtml(ctx: DetailContext, pet: PetBlock): string {
  const loc = ctx.loc;
  const ownStats = pet.stats.filter((s) => s.sourceKind === "pet");
  const abilityStats = pet.stats.filter((s) => s.sourceKind === "pet_skill");

  const ownLines = petStatLines(ctx, ownStats)
    .map((l) => `<li>${effectHtml(loc, l)}</li>`)
    .join("");

  // Named groups (source_name_tag present) get their own sub-heading, in first-appearance order.
  // Rows with no name tag (579 of 743 across the whole dataset, per the task brief) are rendered
  // with no heading rather than an empty one - grouped together at the end, not interleaved,
  // since there is nothing to label them with individually.
  const namedOrder: string[] = [];
  const named = new Map<string, PetStat[]>();
  const unnamed: PetStat[] = [];
  for (const s of abilityStats) {
    if (s.sourceNameTag) {
      if (!named.has(s.sourceNameTag)) named.set(s.sourceNameTag, []);
      if (!namedOrder.includes(s.sourceNameTag)) namedOrder.push(s.sourceNameTag);
      named.get(s.sourceNameTag)!.push(s);
    } else {
      unnamed.push(s);
    }
  }
  const namedHtml = namedOrder
    .map((tag) => {
      const lines = petStatLines(ctx, named.get(tag)!)
        .map((l) => `<li>${effectHtml(loc, l)}</li>`)
        .join("");
      return `<div class="pet-ability"><h5 class="pet-ability-name">${render(loc, gameT(tag))}</h5><ul>${lines}</ul></div>`;
    })
    .join("");
  const unnamedLines = unnamed.length
    ? petStatLines(ctx, unnamed)
        .map((l) => `<li>${effectHtml(loc, l)}</li>`)
        .join("")
    : "";
  const unnamedHtml = unnamedLines ? `<ul class="pet-ability-plain">${unnamedLines}</ul>` : "";

  // data-pet-key: PetBlock.record is a specific dbr path, unique per skill, so tableView.ts can
  // use it to restore this panel's open/closed state after a rebuild (native <details> state
  // lives in the DOM element itself, which does not survive renderBody replacing the row's
  // markup - fix-1).
  return `<details class="pet-panel" data-pet-key="${esc(pet.record)}">
    <summary>${render(loc, gameT(pet.nameTag))}</summary>
    <ul class="pet-own-stats">${ownLines}</ul>
    ${namedHtml}${unnamedHtml}
  </details>`;
}

function skillSectionHtml(ctx: DetailContext, entry: SkillEntry): string {
  const loc = ctx.loc;
  const name = render(loc, skillName(ctx, entry.record));
  const lines: string[] = [];
  if (entry.boostLevel) {
    lines.push(render(loc, gameFormatT("ItemSkillIncrement", [entry.boostLevel, skillName(ctx, entry.record)])));
  }
  if (entry.modBlocks.length) {
    for (const line of rowEffectLines(entry.modBlocks, ctx)) lines.push(effectHtml(loc, line));
  }
  const skill = ctx.skillOf(entry.record);
  const pet = skill?.pets[0];
  const petHtml = pet ? petPanelHtml(ctx, pet) : "";
  return `<section class="skill-detail">
    <h4 class="skill-detail-name">${name}</h4>
    <ul class="skill-detail-lines">${lines.map((l) => `<li>${l}</li>`).join("")}</ul>
    ${petHtml}
  </section>`;
}

// The set's own bonuses, grouped by the piece count that turns each on. Rendered as its own
// block under the item's, and captioned with the count, because a set bonus is not something the
// player has by equipping this piece: it arrives only once N members of the set are worn.
function setSectionHtml(ctx: DetailContext, set: ItemSet): string {
  const loc = ctx.loc;
  const byPieces = new Map<number, string[]>();
  const lineFor = (pieces: number): string[] => {
    let l = byPieces.get(pieces);
    if (!l) {
      l = [];
      byPieces.set(pieces, l);
    }
    return l;
  };
  for (const b of set.boosts) {
    lineFor(b.pieces).push(render(loc, gameFormatT("ItemSkillIncrement", [b.level, skillName(ctx, b.skill)])));
  }
  for (const mb of set.masteryBoosts) {
    lineFor(mb.pieces).push(
      render(loc, gameFormatT("ItemMasteryIncrement", [mb.level, ctx.masteryNameOf(mb.mastery) ?? litT(mb.mastery)])),
    );
  }
  for (const m of set.modifiers) {
    const name = render(loc, skillName(ctx, m.skill));
    for (const line of rowEffectLines([m.stats], ctx)) {
      lineFor(m.pieces).push(`<span class="set-detail-skill">${name}</span> ${effectHtml(loc, line)}`);
    }
  }
  const blocks = [...byPieces.keys()]
    .sort((a, b) => a - b)
    .map((pieces) => {
      const caption = esc(loc.translate("items.set.pieces", { set: setName(loc, set), pieces }));
      const lines = byPieces
        .get(pieces)!
        .map((l) => `<li>${l}</li>`)
        .join("");
      return `<h4 class="set-detail-name">${caption}</h4><ul class="skill-detail-lines">${lines}</ul>`;
    })
    .join("");
  return blocks ? `<section class="set-detail">${blocks}</section>` : "";
}

/** The set's display name, falling back to its record like every other name on this page. */
export function setName(loc: Localization, set: ItemSet): string {
  const name = set.nameTag ? loc.gameText(set.nameTag) : set.record;
  return name === set.nameTag ? set.record : name;
}

/** Pure markup for one item's full detail: every touched skill, its lines, its pet panel when it
 *  carries one, mastery-wide grants, its set's bonuses, and the grimtools link. */
export function detailMarkup(item: Item, ctx: DetailContext): string {
  const loc = ctx.loc;
  const skillsHtml = touchedSkills(item)
    .map((e) => skillSectionHtml(ctx, e))
    .join("");
  const masteryLines = item.masteryBoosts
    .map((mb) => gameFormatT("ItemMasteryIncrement", [mb.level, ctx.masteryNameOf(mb.mastery) ?? litT(mb.mastery)]))
    .map((t) => `<li>${render(loc, t)}</li>`)
    .join("");
  const masteryHtml = masteryLines ? `<ul class="item-detail-mastery">${masteryLines}</ul>` : "";
  const set = ctx.setOf(item.set);
  const setHtml = set ? setSectionHtml(ctx, set) : "";
  const gtHtml = item.grimtools
    ? `<a class="item-detail-grimtools" href="${esc(item.grimtools)}" target="_blank" rel="noopener noreferrer">${esc(loc.translate("items.detail.grimtools"))}</a>`
    : "";
  return `<div class="item-detail-skills">${skillsHtml}</div>${masteryHtml}${setHtml}${gtHtml}`;
}

/** Render one item's expanded detail row content. */
export function renderDetail(item: Item, ctx: DetailContext): HTMLElement {
  const el = document.createElement("div");
  el.className = "item-detail";
  el.innerHTML = detailMarkup(item, ctx);
  return el;
}
