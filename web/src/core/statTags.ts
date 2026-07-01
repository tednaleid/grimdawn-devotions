// ABOUTME: Maps stat catalog keys (stat.attr.*, stat.damage.*, stat.dot.*, stat.resist.*) to their
// ABOUTME: authoritative Grim Dawn game text tags, so statFormat can resolve them via gameText.
import statTags from "../../../data/stat-tags.json";

export const STAT_TAGS: Record<string, string> = statTags;
