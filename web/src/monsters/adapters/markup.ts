// ABOUTME: Markup helpers shared by the monster page's view modules.
// ABOUTME: esc mirrors the private helper in rr/adapters/tableView.ts; views build strings, not DOM.

/** Escape text for interpolation into an HTML attribute or text node. */
export function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}
