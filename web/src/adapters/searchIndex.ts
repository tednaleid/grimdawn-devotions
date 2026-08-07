// ABOUTME: Resolves the pure search corpus into normalized strings for the active locale.
// ABOUTME: The only text-resolving piece of search; core/search.ts stays language independent.
import { resolveText, type Text } from "../core/localization";
import { normalize, type SearchCorpus, type SearchIndex } from "../core/search";
import type { Localization } from "../ports/Localization";

/**
 * Flatten each corpus entry to one normalized string. Rebuild this on a language
 * switch: the corpus is locale-independent, the index is not.
 */
export function resolveIndex(loc: Localization, corpus: SearchCorpus): SearchIndex {
  const flatten = (parts: Text[]) => normalize(parts.map((t) => resolveText(loc, t)).join(" "));
  const constellations = new Map<string, string>();
  for (const [id, parts] of corpus.constellations) constellations.set(id, flatten(parts));
  const stars = new Map<string, string>();
  for (const [id, parts] of corpus.stars) stars.set(id, flatten(parts));
  return { constellations, stars };
}
