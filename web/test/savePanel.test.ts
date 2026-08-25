// ABOUTME: Tests the save-file panel adapter: the file control, its states, and the bytes it hands on.
// ABOUTME: Uses the same hand-rolled DOM double as importPanel.test.ts; this repo has no jsdom.
import { test, expect } from "bun:test";
import { mountSavePanel } from "../src/adapters/savePanel";
import { enLoc } from "./helpers/localizeEn";

class FakeElement {
  innerHTML = "";
  textContent = "";
  value = "";
  hidden = false;
  disabled = false;
  files: unknown[] | null = null;
  private attrs = new Map<string, string>();
  private listeners = new Map<string, ((e: unknown) => void)[]>();
  setAttribute(k: string, v: string) {
    this.attrs.set(k, v);
  }
  removeAttribute(k: string) {
    this.attrs.delete(k);
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
}

function mount() {
  const kids = {
    "#save-h": new FakeElement(),
    "#save-input": new FakeElement(),
    "#save-hint": new FakeElement(),
    "#save-msg": new FakeElement(),
  } as const;
  const root = {
    innerHTML: "",
    querySelector: (sel: string) => kids[sel as keyof typeof kids],
  } as unknown as HTMLElement;
  const seen: Uint8Array[] = [];
  const handle = mountSavePanel(root, enLoc, {
    onBytes: (b) => {
      seen.push(b);
    },
    readFile: async (f) => (f as { bytes: Uint8Array }).bytes,
  });
  return { handle, kids, seen };
}

test("choosing a file hands its bytes on", async () => {
  const { kids, seen } = mount();
  const bytes = new Uint8Array([1, 2, 3]);
  kids["#save-input"].files = [{ bytes }];
  kids["#save-input"].fire("change");
  await Promise.resolve();
  expect(seen).toEqual([bytes]);
});

test("a loaded character is shown with its level and its devotion point split", () => {
  const { handle, kids } = mount();
  handle.setState({ kind: "done", name: "Ashlyn", level: 84, spent: 48, total: 55 });
  expect(kids["#save-msg"].innerHTML).toContain("Ashlyn, level 84");
  expect(kids["#save-msg"].innerHTML).toContain("48 of 55 devotion points spent");
});

test("dropped stars are reported alongside the character", () => {
  const { handle, kids } = mount();
  handle.setState({ kind: "done", name: "Ashlyn", level: 84, spent: 48, total: 55, pruned: 3 });
  expect(kids["#save-msg"].innerHTML).toContain(enLoc.translate("ui.save.pruned", { n: 3 }));
});

test("each failure states its own reason", () => {
  const { handle, kids } = mount();
  handle.setState({ kind: "error", code: "version" });
  expect(kids["#save-msg"].innerHTML).toBe(enLoc.translate("ui.save.err.version"));
  handle.setState({ kind: "error", code: "notSave" });
  expect(kids["#save-msg"].innerHTML).toBe(enLoc.translate("ui.save.err.notSave"));
});

test("a file the browser cannot read reports a read failure, not silence", async () => {
  const kids = {
    "#save-h": new FakeElement(),
    "#save-input": new FakeElement(),
    "#save-hint": new FakeElement(),
    "#save-msg": new FakeElement(),
  } as const;
  const root = {
    innerHTML: "",
    querySelector: (sel: string) => kids[sel as keyof typeof kids],
  } as unknown as HTMLElement;
  mountSavePanel(root, enLoc, {
    onBytes: () => {},
    readFile: () => Promise.reject(new Error("locked")),
  });
  kids["#save-input"].files = [{}];
  kids["#save-input"].fire("change");
  await Promise.resolve();
  await Promise.resolve();
  expect(kids["#save-msg"].innerHTML).toBe(enLoc.translate("ui.save.err.corrupt"));
});
