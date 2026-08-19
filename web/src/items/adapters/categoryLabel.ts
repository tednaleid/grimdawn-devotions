// ABOUTME: The display name of a gear category, shared by the table's slot column and facet chips
// ABOUTME: and the detail view's set-member list, so a slot reads the same everywhere on the page.
import type { Localization } from "../../ports/Localization";
import { CATEGORIES, categoryGameTag } from "../core/facets";

const CATEGORY_SET = new Set(CATEGORIES);

// The weapon categories are the game's own (from its loot filter), so they resolve as game text
// and arrive translated; armour, jewellery and relic have no such tag and resolve from the app
// catalogue. A category outside the known vocabulary is a gear class core/facets.ts has not been
// taught yet (see itemCategory): it shows as its raw id rather than as a missing catalog key.
export function categoryLabel(loc: Localization, category: string): string {
  const tag = categoryGameTag(category);
  if (tag) return loc.gameText(tag);
  return CATEGORY_SET.has(category) ? loc.translate(`items.category.${category}`) : category;
}
