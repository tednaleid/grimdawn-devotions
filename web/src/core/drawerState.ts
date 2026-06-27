// ABOUTME: Pure reducer for the narrow-layout overlay sidebars: which one (if any) is open.
// ABOUTME: No DOM; the layout adapter maps the returned state to CSS classes.
export type DrawerState = "none" | "left" | "right";
export type DrawerSide = "left" | "right";

// Toggle a side: open it, unless it is already open, in which case close (opening one side
// therefore also closes the other, since only one value can be held at a time).
export function toggleDrawer(state: DrawerState, side: DrawerSide): DrawerState {
  return state === side ? "none" : side;
}
