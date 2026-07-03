// ABOUTME: Guard: core must not contain a localization singleton or resolve text globally.
// ABOUTME: Locale-independence of core output is enforced by construction; this keeps it that way.
import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const CORE = join(import.meta.dir, "../src/core");
const FORBIDDEN = /\bsetLocalization\b|\bresolveTextGlobal\b/;

test("no core or adapter file references the deleted singleton API", () => {
  for (const dir of [CORE, join(import.meta.dir, "../src/adapters"), join(import.meta.dir, "../src/app")]) {
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
      const src = readFileSync(join(dir, f), "utf8");
      expect(FORBIDDEN.test(src), `${f} references the singleton`).toBe(false);
    }
  }
});
