// ABOUTME: Port for the planner's two conversations with grimtools, both relayed through our worker:
// ABOUTME: read a build's skill ids by slug, and save a devotion selection as a fresh build or a copy of a base.

/** Outcome of reading a build. `skills` mixes mastery skills and devotion stars: the caller splits
 * them with the mapping table (see mapStars). `dataVersion` null means the worker could not check
 * grimtools' devotion data version; `title` null means the build has no usable display name. */
export type FetchBuildResult =
  | { kind: "ok"; skills: string[]; dataVersion: string | null; title: string | null }
  | { kind: "notFound" }
  | { kind: "network" };

/** Outcome of saving a build. `upstream` is grimtools refusing or garbling the save; `network` is
 * everything between the planner and a well-formed worker answer (offline, a worker error, an
 * unexpected shape). */
export type SaveBuildResult =
  | { kind: "ok"; slug: string }
  | { kind: "rateLimited" }
  | { kind: "upstream" }
  | { kind: "network" };

/** The build an export copies: `slug` names it, `remove` lists which of its skill ids are the
 * devotion stars to replace (the worker cannot tell them apart; the planner can, via the table). */
export interface ExportBase {
  slug: string;
  remove: string[];
}

export interface GrimtoolsGateway {
  fetchBuild(slug: string): Promise<FetchBuildResult>;
  /** `skills` are grimtools `sk` ids (see toGrimtoolsSkills), never our star ids. With `base` the
   * saved build is a copy of that build with only its devotions replaced; without, a fresh
   * devotions-only character. */
  saveBuild(skills: string[], base?: ExportBase): Promise<SaveBuildResult>;
}
