// ABOUTME: Maps stat catalog keys (stat.attr.*, stat.damage.*, stat.dot.*, stat.resist.*) to their
// ABOUTME: authoritative Grim Dawn game text tags, so statFormat can resolve them via gameText.
import statTags from "../../../data/stat-tags.json";
import statFormatTags from "../../../data/stat-format-tags.json";

export const STAT_TAGS: Record<string, string> = statTags;

// Raw stat ids whose game term is a value-embedded format string ("{v}% <noun>"). statFormat
// resolves these via gameText and strips the value token; unlike STAT_TAGS these are keyed by the
// raw GD stat id (they are reached from classify's fallback, not from a catalog key).
export const STAT_FORMAT_TAGS: Record<string, string> = statFormatTags;
