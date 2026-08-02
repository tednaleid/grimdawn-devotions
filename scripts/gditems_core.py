# ABOUTME: Pure query model, scoring, tier collapse, and grimtools link building for the item CLI.
# ABOUTME: Imports no database driver and performs no I/O, so every rule here is unit testable.
from dataclasses import dataclass


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
