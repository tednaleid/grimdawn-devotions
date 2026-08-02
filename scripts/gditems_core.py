# ABOUTME: Pure query model, scoring, tier collapse, and grimtools link building for the item CLI.
# ABOUTME: Imports no database driver and performs no I/O, so every rule here is unit testable.
import json
from dataclasses import dataclass

import lzstring


@dataclass(frozen=True)
class StatCriterion:
    family: str
    minimum: float | None


@dataclass(frozen=True)
class Criteria:
    domains: tuple[str, ...]
    slots: tuple[str, ...]
    gear_types: tuple[str, ...]
    rarities: tuple[str, ...]
    expansions: tuple[str, ...]
    sources: tuple[str, ...]
    fits: str | None
    level: int | None
    all_tiers: bool
    stats: tuple[StatCriterion, ...]
    converts_to: str | None
    min_convert: float | None
    grants_skills: tuple[str, ...]
    boosts_skills: tuple[str, ...]
    boosts_masteries: tuple[str, ...]
    masteries: tuple[str, ...]
    limit: int


@dataclass(frozen=True)
class Candidate:
    record: str
    group_key: str
    name: str
    item_level: int
    req_level: int
    rarity: str
    domain: str
    slots: tuple[str, ...]
    source: str
    stat_values: dict[str, float]
    skill_boosts: dict[str, int]
    mastery_boosts: dict[str, int]
    granted_skills: tuple[str, ...]
    conversions: tuple[tuple[str, str, float], ...]


def collapse_tiers(candidates, level):
    """Group records into item families, strongest usable tier first.

    A family is one item that exists at several levels (base, Empowered, Mythical),
    sharing a group_key. When a level is given, tiers requiring a higher level are
    dropped entirely, so a family with no usable tier disappears rather than
    suggesting gear the character cannot equip.
    """
    families: dict[str, list[Candidate]] = {}
    for c in candidates:
        if level is not None and c.req_level > level:
            continue
        families.setdefault(c.group_key, []).append(c)
    out = []
    for members in families.values():
        members.sort(key=lambda c: c.item_level, reverse=True)
        out.append(members)
    return out


def criteria_criterion_names(c: Criteria) -> list[str]:
    """Return one stable label per scored criterion the caller actually passed.

    Only the scored dimensions (stats, conversion, granted/boosted skills, boosted
    masteries, mastery union) produce labels here; scope flags such as domain, slot,
    rarity, source, fits, and level narrow the candidate set but never score it, so
    they contribute nothing. Scoring uses these labels as weight keys, and the
    per-criterion empty-match report uses them to say which criterion matched
    nothing, rather than just reporting an empty result overall.
    """
    names: list[str] = []
    for stat in c.stats:
        names.append(f"stat:{stat.family}")
    if c.converts_to is not None:
        names.append(f"converts_to:{c.converts_to}")
    for skill in c.grants_skills:
        names.append(f"grants_skill:{skill}")
    for skill in c.boosts_skills:
        names.append(f"boosts_skill:{skill}")
    for mastery in c.boosts_masteries:
        names.append(f"boosts_mastery:{mastery}")
    for mastery in c.masteries:
        names.append(f"mastery:{mastery}")
    return names


MASTERY_FALLBACK_WEIGHT = 0.5


@dataclass(frozen=True)
class CriterionScore:
    name: str
    raw: float
    normalised: float
    weight: float
    note: str


@dataclass(frozen=True)
class ScoredItem:
    candidate: Candidate
    total: float
    parts: tuple[CriterionScore, ...]


def _mastery_dir(record: str) -> str:
    """The playerclass directory a skill or mastery record lives under.

    Both a skill and the mastery it belongs to share this prefix (for example
    records/skills/playerclass04/), which is how a mastery boost is matched to the
    skills it lifts without a separate skill-to-mastery table.
    """
    head, _, _ = record.rpartition("/")
    return head


def _raw_value(candidate: Candidate, criterion_name: str) -> tuple[float, str]:
    """Read the raw (unnormalised) value a candidate contributes to one criterion.

    Most criteria read a single field on the candidate directly. The exception is
    boosts_skill: a mastery-wide boost lifts every skill in that mastery too, so a
    candidate with only the mastery bonus still contributes, at MASTERY_FALLBACK_WEIGHT
    of a direct hit, with a note explaining the discount came via the mastery.
    """
    kind, _, target = criterion_name.partition(":")
    if kind == "stat":
        return candidate.stat_values.get(target, 0.0), ""
    if kind == "converts_to":
        total = sum(pct for _from, to, pct in candidate.conversions if to == target)
        return total, ""
    if kind == "grants_skill":
        return (1.0 if target in candidate.granted_skills else 0.0), ""
    if kind == "boosts_skill":
        direct = candidate.skill_boosts.get(target)
        if direct is not None:
            return float(direct), ""
        skill_dir = _mastery_dir(target)
        for mastery_record, level in candidate.mastery_boosts.items():
            if _mastery_dir(mastery_record) == skill_dir:
                return (level * MASTERY_FALLBACK_WEIGHT,
                        f"via +{level} to the mastery, not the skill directly")
        return 0.0, ""
    if kind == "boosts_mastery":
        return float(candidate.mastery_boosts.get(target, 0)), ""
    if kind == "mastery":
        mastery_dir = _mastery_dir(target)
        direct = candidate.mastery_boosts.get(target, 0)
        via_skill = max(
            (level for record, level in candidate.skill_boosts.items()
             if _mastery_dir(record) == mastery_dir),
            default=0)
        return float(max(direct, via_skill)), ""
    return 0.0, ""


def score(candidates, c, weights=None):
    """Rank candidates by how well they satisfy the criteria the caller passed.

    Each criterion normalises against the best value present among the candidates, so a
    total answers "how good is this relative to what exists" rather than against an
    invented absolute scale. An item that misses a criterion scores zero for it and stays
    in the list, which is what lets a strong partial match outrank a weak complete one.
    """
    weights = weights or {}
    names = criteria_criterion_names(c)
    raw: dict[str, dict[str, float]] = {n: {} for n in names}
    notes: dict[str, dict[str, str]] = {n: {} for n in names}
    for cand_ in candidates:
        for name in names:
            value, note = _raw_value(cand_, name)
            raw[name][cand_.record] = value
            notes[name][cand_.record] = note
    best = {n: max(v.values(), default=0.0) for n, v in raw.items()}
    out = []
    for cand_ in candidates:
        parts = []
        for name in names:
            value = raw[name][cand_.record]
            top = best[name]
            normalised = (value / top) if top > 0 else 0.0
            weight = weights.get(name, 1.0)
            parts.append(CriterionScore(name=name, raw=value, normalised=normalised,
                                        weight=weight, note=notes[name][cand_.record]))
        total = sum(p.normalised * p.weight for p in parts)
        out.append(ScoredItem(candidate=cand_, total=total, parts=tuple(parts)))
    out.sort(key=lambda s: s.total, reverse=True)
    return out


GRIMTOOLS_SEARCH = "https://www.grimtools.com/db/advsearch?query="


def grimtools_url(name, item_level):
    """Deep link that usually isolates one item on grimtools, built from name plus an
    exact itemLevel since grimtools item ids are internal to their site and cannot be
    derived from game data. This narrows a family's several tiers to the one intended
    record in the common case, but not always: measured exceptions are a cross-family
    name-and-level collision (Ulgrim's Keepsake, two unrelated quest-item families both
    at item level 1), duplicate levels within one family (Obsidian War Cleaver's
    ladder is 30 / 30 / 40 / 55 / 70 / 84 / 94), and every Ascension craft under
    records/items/awakened, which shares its base item's name and item level and differs
    only in rarity (97 such pairs at build 24346246). Any of these resolves more than one
    record on grimtools. Use the `record` field, which is always unambiguous, whenever the
    caller needs to name one specific tier.

    Refuses to build a link for an empty name: a name-less query (`{"name": ""}`)
    matches every item at that level on grimtools rather than isolating anything, which
    is worse than no link at all - see `gditems_duckdb.DuckDbRepository.fetch`'s
    docstring for the 944 entities this guards against.
    """
    if not name:
        raise ValueError("grimtools_url requires a non-empty item name")
    query = {"name": name, "raw": {"itemLevel": {"min": item_level, "max": item_level}}}
    blob = lzstring.LZString().compressToEncodedURIComponent(
        json.dumps(query, separators=(",", ":")))
    return GRIMTOOLS_SEARCH + blob
