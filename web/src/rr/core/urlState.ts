// ABOUTME: The RR page ViewState (every view-changing control) and its default; hash codec added in Task 6.
// ABOUTME: ViewState is the single source of view state; main.ts round-trips it through the URL hash.

export interface ViewState {
  q: string;
  fType: string;
  fRR: string;
  fCat: string;
  fPar: string;
  fTrig: string;
  sortKey: string;
  sortDir: 1 | -1;
  group: "none" | "mastery" | "constellation" | "item";
  sel: Set<string>;
  r0: number;
}

export const DEFAULT_VIEW: ViewState = {
  q: "",
  fType: "",
  fRR: "",
  fCat: "",
  fPar: "",
  fTrig: "",
  sortKey: "rr",
  sortDir: 1,
  group: "none",
  sel: new Set(),
  r0: 100,
};
