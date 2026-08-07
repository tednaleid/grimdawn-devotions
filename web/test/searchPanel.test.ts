// ABOUTME: Tests the search panel adapter: the three setCount states, that a language switch
// ABOUTME: re-renders an on-screen count, and that both clear paths notify onInput("").
import { test, expect } from "bun:test";
import { mountSearchPanel } from "../src/adapters/searchPanel";
import type { SearchMatch } from "../src/core/search";
import { enLoc } from "./helpers/localizeEn";

// A hand-rolled double for the handful of DOM operations mountSearchPanel performs
// (innerHTML, querySelector by a fixed id, addEventListener, attribute/text setters). This repo
// has no jsdom/happy-dom dependency; other DOM-adapter tests fake just enough by hand (see
// sidebar-affinity.test.ts's `{ innerHTML: "" }` element), and mountSearchPanel's child ids are
// fixed by its own template, so querySelector can resolve them directly.
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

function mount(initial = "") {
  const kids = {
    "#search-h": new FakeElement(),
    "#search-input": new FakeElement(),
    "#search-clear": new FakeElement(),
    "#search-count": new FakeElement(),
  } as const;
  const root = {
    innerHTML: "",
    querySelector: (sel: string) => kids[sel as keyof typeof kids],
  } as unknown as HTMLElement;
  const onInputCalls: string[] = [];
  const handle = mountSearchPanel(root, enLoc, { initial, onInput: (q) => onInputCalls.push(q) });
  return { handle, kids, onInputCalls };
}

function match(constellations: string[], stars: string[]): SearchMatch {
  return { constellations: new Set(constellations), stars: new Set(stars) };
}

test("setCount(null) clears the count line", () => {
  const { handle, kids } = mount();
  handle.setCount(match(["a"], ["s1"]));
  handle.setCount(null);
  expect(kids["#search-count"].textContent).toBe("");
});

test("setCount with both sets empty shows the none state, not a 0/0 count", () => {
  const { handle, kids } = mount();
  handle.setCount(match([], []));
  expect(kids["#search-count"].textContent).toBe(enLoc.translate("ui.search.none"));
});

test("setCount with matches shows the constellations/stars counts", () => {
  const { handle, kids } = mount();
  handle.setCount(match(["a", "b"], ["s1"]));
  expect(kids["#search-count"].textContent).toBe(enLoc.translate("ui.search.count", { cons: 2, stars: 1 }));
});

test("relocalize re-renders the static chrome and an on-screen count", () => {
  const { handle, kids } = mount();
  handle.setCount(match([], []));
  const frLoc = {
    ...enLoc,
    translate: (key: string) => `FR:${key}`,
  };
  handle.relocalize(frLoc);
  expect(kids["#search-h"].textContent).toBe("FR:ui.search.label");
  expect(kids["#search-count"].textContent).toBe("FR:ui.search.none");
});

test("the clear button empties the query, notifies onInput(''), and refocuses the input", () => {
  const { kids, onInputCalls } = mount("abc");
  kids["#search-input"].value = "abc";
  kids["#search-clear"].fire("click");
  expect(kids["#search-input"].value).toBe("");
  expect(onInputCalls).toEqual([""]);
  expect(kids["#search-input"].focused).toBe(true);
});

test("Escape empties the query and notifies onInput('')", () => {
  const { kids, onInputCalls } = mount("abc");
  kids["#search-input"].value = "abc";
  kids["#search-input"].fire("keydown", { key: "Escape" });
  expect(kids["#search-input"].value).toBe("");
  expect(onInputCalls).toEqual([""]);
});

test("a non-Escape key does not clear the query", () => {
  const { kids, onInputCalls } = mount("abc");
  kids["#search-input"].value = "abc";
  kids["#search-input"].fire("keydown", { key: "Enter" });
  expect(kids["#search-input"].value).toBe("abc");
  expect(onInputCalls).toEqual([]);
});

test("value()/setValue() reflect the input", () => {
  const { handle, kids } = mount("seed");
  expect(handle.value()).toBe("seed");
  handle.setValue("next");
  expect(kids["#search-input"].value).toBe("next");
  expect(handle.value()).toBe("next");
});
