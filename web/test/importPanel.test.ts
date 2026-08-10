// ABOUTME: Tests the import panel adapter: the two-state control (textbox+Import vs link+clear),
// ABOUTME: live input validation, submit/clear wiring, and rendered states.
import { test, expect } from "bun:test";
import { mountImportPanel } from "../src/adapters/importPanel";
import { enLoc } from "./helpers/localizeEn";

// A hand-rolled double for the handful of DOM operations mountImportPanel performs (innerHTML,
// querySelector by a fixed id, addEventListener, attribute/text setters, hidden/disabled flags).
// This repo has no jsdom/happy-dom dependency; see searchPanel.test.ts for the same pattern.
// Every state renders #import-msg via innerHTML (never textContent), including the plain-text
// branches: a real DOM element keeps the two setters in sync but this FakeElement tracks them as
// independent strings, so mixing them here would leave stale innerHTML behind after a later
// plain-text state. Assert message content via innerHTML.
class FakeElement {
  innerHTML = "";
  textContent = "";
  value = "";
  placeholder = "";
  focused = false;
  hidden = false;
  disabled = false;
  private attrs = new Map<string, string>();
  private listeners = new Map<string, ((e: unknown) => void)[]>();

  setAttribute(k: string, v: string) {
    this.attrs.set(k, v);
  }
  getAttribute(k: string) {
    return this.attrs.get(k) ?? null;
  }
  addEventListener(type: string, fn: (e: unknown) => void) {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }
  fire(type: string, e: unknown = {}) {
    for (const fn of this.listeners.get(type) ?? []) fn(e);
  }
  focus() {
    this.focused = true;
  }
}

function mount() {
  const kids = {
    "#import-h": new FakeElement(),
    "#import-input": new FakeElement(),
    "#import-go": new FakeElement(),
    "#import-source": new FakeElement(),
    "#import-clear": new FakeElement(),
    "#import-msg": new FakeElement(),
  } as const;
  const root = {
    innerHTML: "",
    querySelector: (sel: string) => kids[sel as keyof typeof kids],
  } as unknown as HTMLElement;
  const calls: string[] = [];
  const handle = mountImportPanel(root, enLoc, { onSubmit: (s) => calls.push(s) });
  return { handle, kids, calls };
}

// Types into the fake input, firing the "input" event mountImportPanel listens on to recompute
// the live hint and the Import button's disabled state.
function type(kids: ReturnType<typeof mount>["kids"], value: string) {
  kids["#import-input"].value = value;
  kids["#import-input"].fire("input");
}

test("an empty box shows no hint and a disabled Import button", () => {
  const { kids } = mount();
  expect(kids["#import-go"].disabled).toBe(true);
  expect(kids["#import-msg"].innerHTML).toBe("");
});

test("unparseable text disables Import and shows a live hint, both updating as text changes", () => {
  const { kids } = mount();
  type(kids, "https://evil.example.com/calc/qNYgbjeV");
  expect(kids["#import-go"].disabled).toBe(true);
  expect(kids["#import-msg"].innerHTML).toBe(enLoc.translate("ui.import.err.badInput"));

  type(kids, "https://www.grimtools.com/calc/qNYgbjeV");
  expect(kids["#import-go"].disabled).toBe(false);
  expect(kids["#import-msg"].innerHTML).toBe("");
});

test("submitting a full URL passes the bare slug on", () => {
  const { kids, calls } = mount();
  type(kids, "https://www.grimtools.com/calc/qNYgbjeV");
  kids["#import-go"].fire("click");
  expect(calls).toEqual(["qNYgbjeV"]);
});

test("Enter does nothing while the box does not parse, leaving the hint in place", () => {
  const { kids, calls } = mount();
  type(kids, "https://evil.example.com/calc/qNYgbjeV");
  kids["#import-input"].fire("keydown", { key: "Enter" });
  expect(calls).toEqual([]);
  expect(kids["#import-msg"].innerHTML).toBe(enLoc.translate("ui.import.err.badInput"));
});

test("Enter submits", () => {
  const { kids, calls } = mount();
  kids["#import-input"].value = "qNYgbjeV";
  kids["#import-input"].fire("keydown", { key: "Enter" });
  expect(calls).toEqual(["qNYgbjeV"]);
});

test("the done state hides the textbox and Import button, showing the source link and clear button", () => {
  const { kids, handle } = mount();
  handle.setState({ kind: "done", slug: "qNYgbjeV" });
  expect(kids["#import-input"].hidden).toBe(true);
  expect(kids["#import-go"].hidden).toBe(true);
  expect(kids["#import-source"].hidden).toBe(false);
  expect(kids["#import-clear"].hidden).toBe(false);
  expect(kids["#import-source"].getAttribute("href")).toBe("https://www.grimtools.com/calc/qNYgbjeV");
  // No title on this state: falls back to the untitled source string.
  expect(kids["#import-source"].innerHTML).toBe(enLoc.translate("ui.import.source"));
});

test("a done state with a title renders it via the titled source string", () => {
  const { kids, handle } = mount();
  handle.setState({ kind: "done", slug: "qNYgbjeV", title: "Warder, Level 100 (GD 1.2.1.6)" });
  expect(kids["#import-source"].innerHTML).toBe(
    enLoc.translate("ui.import.sourceTitled", { title: "Warder, Level 100 (GD 1.2.1.6)" }),
  );
});

test("a done state with no title (absent, e.g. a pre-title cached worker response) falls back to the untitled source string", () => {
  const { kids, handle } = mount();
  handle.setState({ kind: "done", slug: "qNYgbjeV" });
  expect(kids["#import-source"].innerHTML).toBe(enLoc.translate("ui.import.source"));
});

test("a done state with title explicitly null falls back the same as an absent title", () => {
  const { kids, handle } = mount();
  handle.setState({ kind: "done", slug: "qNYgbjeV", title: null });
  expect(kids["#import-source"].innerHTML).toBe(enLoc.translate("ui.import.source"));
});

test("a title containing markup is HTML-escaped, not passed through as live tags", () => {
  const { kids, handle } = mount();
  handle.setState({ kind: "done", slug: "qNYgbjeV", title: '<script>alert(1)</script> & "quoted"' });
  const rendered = kids["#import-source"].innerHTML;
  expect(rendered).not.toContain("<script>");
  expect(rendered).toBe(
    enLoc.translate("ui.import.sourceTitled", {
      title: "&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;quoted&quot;",
    }),
  );
});

// main.ts's syncImportPanel() applies a "done" state as the very first setState() call, both on
// boot from a gt= hash and on every hashchange (Back/Forward). Nothing precedes it: State A never
// paints. Assert that path directly, distinct from the test above which happens to also cover it
// after an import, to make sure a fresh mount landing straight on "done" is exercised on its own.
test("a done state applied as the first call after mount (a page load or Back/Forward restoring gt=) renders State B directly", () => {
  const { kids, handle } = mount();
  handle.setState({ kind: "done", slug: "qNYgbjeV" });
  expect(kids["#import-input"].hidden).toBe(true);
  expect(kids["#import-go"].hidden).toBe(true);
  expect(kids["#import-source"].hidden).toBe(false);
  expect(kids["#import-clear"].hidden).toBe(false);
  expect(kids["#import-msg"].innerHTML).toBe(""); // no stray hint/loading/error text from the idle default
});

test("a pruned count is reported alongside the link", () => {
  const { kids, handle } = mount();
  handle.setState({ kind: "done", slug: "qNYgbjeV", pruned: 3 });
  expect(kids["#import-msg"].innerHTML).toContain(enLoc.translate("ui.import.pruned", { n: 3 }));
});

test("no pruned count renders no message", () => {
  const { kids, handle } = mount();
  handle.setState({ kind: "done", slug: "qNYgbjeV" });
  expect(kids["#import-msg"].innerHTML).toBe("");
});

test("clear empties the box, reports it, and returns to an empty State A", () => {
  const { kids, handle, calls } = mount();
  handle.setState({ kind: "done", slug: "qNYgbjeV" });
  kids["#import-clear"].fire("click");
  expect(kids["#import-input"].value).toBe("");
  expect(kids["#import-input"].hidden).toBe(false);
  expect(kids["#import-go"].hidden).toBe(false);
  expect(kids["#import-go"].disabled).toBe(true);
  expect(kids["#import-source"].hidden).toBe(true);
  expect(kids["#import-clear"].hidden).toBe(true);
  expect(kids["#import-msg"].innerHTML).toBe("");
  expect(calls).toEqual([""]); // empty slug means "drop the association"
});

test("each error code renders its own message", () => {
  const { kids, handle } = mount();
  for (const code of ["notFound", "network", "version", "empty"] as const) {
    handle.setState({ kind: "error", code });
    expect(kids["#import-msg"].innerHTML).toBe(enLoc.translate(`ui.import.err.${code}`));
  }
});

test("relocalize re-renders the source link text and a live hint that is currently showing", () => {
  const { kids, handle } = mount();
  type(kids, "https://evil.example.com/calc/qNYgbjeV");
  handle.setState({ kind: "done", slug: "qNYgbjeV" });
  const frLoc = {
    ...enLoc,
    translate: (key: string) => `FR:${key}`,
  };
  handle.relocalize(frLoc);
  expect(kids["#import-source"].innerHTML).toBe("FR:ui.import.source");

  handle.setState({ kind: "idle" });
  type(kids, "https://evil.example.com/calc/qNYgbjeV");
  expect(kids["#import-msg"].innerHTML).toBe("FR:ui.import.err.badInput");
});
