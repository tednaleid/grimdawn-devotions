// ABOUTME: Shared URL-hash codec helpers for multi-select facets, used by every faceted page.
// ABOUTME: Pure and locale-independent; the tolerance rules here are a project-wide invariant.

/** Append `key=a,b,c` to `parts` when the set is non-empty; a set at its empty default is omitted. */
export function putSet(parts: string[], key: string, set: Set<string>): void {
  if (set.size) parts.push(`${key}=${[...set].map(encodeURIComponent).join(",")}`);
}

/** Decode a comma-joined hash value, keeping only members of `allowed`.
 *
 *  A token that fails to decode is skipped individually rather than discarding the whole
 *  list, so one malformed value in a shared link cannot wipe out the user's other filters.
 */
export function readSet(val: string, allowed: Set<string>): Set<string> {
  const out = new Set<string>();
  for (const raw of val.split(",")) {
    let t: string;
    try {
      t = decodeURIComponent(raw);
    } catch {
      continue;
    }
    if (allowed.has(t)) out.add(t);
  }
  return out;
}
