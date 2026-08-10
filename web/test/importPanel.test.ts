// ABOUTME: Tests the import panel adapter: input parsing, submit, clear, and rendered states.
// ABOUTME: Pure DOM, no network: the panel reports states it is given rather than fetching.
import { test, expect } from "bun:test";
import { mountImportPanel } from "../src/adapters/importPanel";
import { enLoc } from "./helpers/localizeEn";

// A hand-rolled double for the handful of DOM operations mountImportPanel performs (innerHTML,
// querySelector by a fixed id, addEventListener, attribute/text setters). This repo has no
// jsdom/happy-dom dependency; see searchPanel.test.ts for the same pattern. Unlike searchPanel,
// every panel state (not just "done") is painted via #import-msg.innerHTML: the "done" state
// needs markup for the source link, and a real DOM keeps textContent/innerHTML in sync, but this
// FakeElement tracks them as independent strings, so mixing the two setters here would leave
// stale innerHTML behind after a plain-text state. Assert message content via innerHTML.
class FakeElement {
  innerHTML = "";
  textContent = "";
  value = "";
  placeholder = "";
  focused = false;
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

test("submitting a full URL passes the bare slug on", () => {
  const { kids, calls } = mount();
  kids["#import-input"].value = "https://www.grimtools.com/calc/qNYgbjeV";
  kids["#import-go"].fire("click");
  expect(calls).toEqual(["qNYgbjeV"]);
});

test("submitting junk reports a bad-input error without calling onSubmit", () => {
  const { kids, calls } = mount();
  kids["#import-input"].value = "https://evil.example.com/calc/qNYgbjeV";
  kids["#import-go"].fire("click");
  expect(calls).toEqual([]);
  expect(kids["#import-msg"].innerHTML).toBe(enLoc.translate("ui.import.err.badInput"));
});

test("Enter submits", () => {
  const { kids, calls } = mount();
  kids["#import-input"].value = "qNYgbjeV";
  kids["#import-input"].fire("keydown", { key: "Enter" });
  expect(calls).toEqual(["qNYgbjeV"]);
});

test("the done state renders a link to the source build", () => {
  const { kids, handle } = mount();
  handle.setState({ kind: "done", slug: "qNYgbjeV" });
  const html = kids["#import-msg"].innerHTML;
  expect(html).toContain('id="import-source"');
  expect(html).toContain('href="https://www.grimtools.com/calc/qNYgbjeV"');
  expect(html).toContain(enLoc.translate("ui.import.source"));
});

test("a pruned count is reported alongside the link", () => {
  const { kids, handle } = mount();
  handle.setState({ kind: "done", slug: "qNYgbjeV", pruned: 3 });
  expect(kids["#import-msg"].innerHTML).toContain(enLoc.translate("ui.import.pruned", { n: 3 }));
});

test("clear empties the box and reports it", () => {
  const { kids, handle, calls } = mount();
  handle.setState({ kind: "done", slug: "qNYgbjeV" });
  kids["#import-clear"].fire("click");
  expect(kids["#import-input"].value).toBe("");
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
