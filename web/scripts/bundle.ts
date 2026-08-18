// ABOUTME: Builds the planner's JS/CSS into web/dist with content-hashed, minified filenames.
// ABOUTME: Bundles main.ts (Bun.build), hashes styles.css, and rewrites the asset refs in index.html.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { computeBuildId } from "../src/adapters/coverTableBlob";

// buildId identifies the planner data (devotions.json) and is checked against the cover blob.
const buildId = computeBuildId(await Bun.file("../data/devotions.json").text());

// assetVersion tags the ?v= on every runtime-fetched JSON (every page's dataset, and all i18n
// catalogs), so a deploy that changes ANY of them busts returning visitors' caches. buildId alone
// can't: it only reflects devotions.json, so an i18n-only change would leave it unchanged. Hash
// the source files (in a stable order) before the build recipe copies them into dist. Every
// runtime-fetched JSON must be listed here - fix round 1, I2 found monsters.json, skill-items.json,
// and stat-item-tags.json missing, so their pages' withVersion() calls were a no-op: regenerating
// only one of those files left the token unchanged and returning visitors kept a stale cache.
function assetVersionHash(): string {
  const jsonIn = (dir: string) =>
    readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .sort()
      .map((f) => `${dir}/${f}`);
  const files = [
    "../data/devotions.json",
    "../data/resistance-reduction.json",
    "../data/monsters.json",
    "../data/skill-items.json",
    "../data/stat-item-tags.json",
    "../data/skill-icons.json",
    "../data/skill-icons.png", // the tree's sprite sheet: not JSON, but still runtime-fetched
    ...jsonIn("src/i18n"), // app.<locale>.json (UI chrome)
    ...jsonIn("../data/i18n"), // game.<locale>.json (game text)
  ];
  const h = createHash("sha256");
  for (const f of files) {
    h.update(f);
    h.update(readFileSync(f));
  }
  return h.digest("hex").slice(0, 16);
}
const assetVersion = assetVersionHash();

const result = await Bun.build({
  entrypoints: ["src/app/main.ts"],
  outdir: "dist",
  target: "browser",
  minify: true,
  sourcemap: "linked", // emits main-<hash>.js.map; only fetched when devtools is open
  naming: "[name]-[hash].[ext]", // dist/main-<hash>.js
  define: {
    __BUILD_ID__: JSON.stringify(buildId),
    __ASSET_V__: JSON.stringify(assetVersion),
    __IMPORT_API__: JSON.stringify(process.env.IMPORT_API ?? "http://localhost:8787"),
  },
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  throw new Error("bundle: Bun.build failed");
}
const entry = result.outputs.find((o) => o.kind === "entry-point");
if (!entry) throw new Error("bundle: no entry-point output");
const jsName = entry.path.split(/[\\/]/).pop()!; // main-<hash>.js

// styles.css is not built by Bun (plain CSS copied through), so hash it here for the same cache-busting.
const cssBytes = await Bun.file("src/styles.css").bytes();
const cssName = `styles-${createHash("sha256").update(cssBytes).digest("hex").slice(0, 8)}.css`;
await Bun.write(`dist/${cssName}`, cssBytes);

// Rewrite the two asset references in the HTML shell to the hashed names.
let html = await Bun.file("index.html").text();
html = html.replace('src="./main.js"', `src="./${jsName}"`).replace('href="./styles.css"', `href="./${cssName}"`);
if (html.includes('"./main.js"') || html.includes('"./styles.css"')) {
  throw new Error("bundle: index.html still has un-hashed asset refs after rewrite (did the markup change?)");
}
if (!html.includes(jsName) || !html.includes(cssName)) {
  throw new Error("bundle: hashed asset refs not present after rewrite (did index.html markup change?)");
}
await Bun.write("dist/index.html", html);

// Second page: the RR reference, its own bundle under dist/resistance-reduction/, sharing the
// hashed styles.css from the parent dir. Named rr-main to avoid colliding with the planner's main.
const rr = await Bun.build({
  entrypoints: ["src/rr/app/main.ts"],
  outdir: "dist/resistance-reduction",
  target: "browser",
  minify: true,
  sourcemap: "linked",
  naming: "rr-[name]-[hash].[ext]", // dist/resistance-reduction/rr-main-<hash>.js
  define: { __ASSET_V__: JSON.stringify(assetVersion) },
});
if (!rr.success) {
  for (const log of rr.logs) console.error(log);
  throw new Error("bundle: RR Bun.build failed");
}
const rrEntry = rr.outputs.find((o) => o.kind === "entry-point");
if (!rrEntry) throw new Error("bundle: no RR entry-point output");
const rrJsName = rrEntry.path.split(/[\\/]/).pop()!; // rr-main-<hash>.js

// The RR page's own scoped stylesheet, hashed like styles.css and copied into its subfolder.
const rrCssBytes = await Bun.file("src/rr/rr.css").bytes();
const rrCssName = `rr-${createHash("sha256").update(rrCssBytes).digest("hex").slice(0, 8)}.css`;
await Bun.write(`dist/resistance-reduction/${rrCssName}`, rrCssBytes);

let rrHtml = await Bun.file("resistance-reduction.html").text();
rrHtml = rrHtml
  .replace('src="./rr-main.js"', `src="./${rrJsName}"`)
  .replace('href="../styles.css"', `href="../${cssName}"`)
  .replace('href="./rr.css"', `href="./${rrCssName}"`);
if (rrHtml.includes('"./rr-main.js"') || rrHtml.includes('"../styles.css"') || rrHtml.includes('"./rr.css"')) {
  throw new Error("bundle: resistance-reduction.html still has un-hashed asset refs after rewrite");
}
if (!rrHtml.includes(rrJsName) || !rrHtml.includes(cssName) || !rrHtml.includes(rrCssName)) {
  throw new Error("bundle: hashed RR asset refs not present after rewrite");
}
await Bun.write("dist/resistance-reduction/index.html", rrHtml);

// Third page: the monster resistance explorer, its own bundle under dist/monster-resistances/,
// sharing the hashed styles.css from the parent dir. Named mon-main to avoid colliding.
const mon = await Bun.build({
  entrypoints: ["src/monsters/app/main.ts"],
  outdir: "dist/monster-resistances",
  target: "browser",
  minify: true,
  sourcemap: "linked",
  naming: "mon-[name]-[hash].[ext]", // dist/monster-resistances/mon-main-<hash>.js
  define: { __ASSET_V__: JSON.stringify(assetVersion) },
});
if (!mon.success) {
  for (const log of mon.logs) console.error(log);
  throw new Error("bundle: monsters Bun.build failed");
}
const monEntry = mon.outputs.find((o) => o.kind === "entry-point");
if (!monEntry) throw new Error("bundle: no monsters entry-point output");
const monJsName = monEntry.path.split(/[\\/]/).pop()!; // mon-main-<hash>.js

const monCssBytes = await Bun.file("src/monsters/monsters.css").bytes();
const monCssName = `mon-${createHash("sha256").update(monCssBytes).digest("hex").slice(0, 8)}.css`;
await Bun.write(`dist/monster-resistances/${monCssName}`, monCssBytes);

let monHtml = await Bun.file("monster-resistances.html").text();
monHtml = monHtml
  .replace('src="./mon-main.js"', `src="./${monJsName}"`)
  .replace('href="../styles.css"', `href="../${cssName}"`)
  .replace('href="./monsters.css"', `href="./${monCssName}"`);
if (
  monHtml.includes('"./mon-main.js"') ||
  monHtml.includes('"../styles.css"') ||
  monHtml.includes('"./monsters.css"')
) {
  throw new Error("bundle: monster-resistances.html still has un-hashed asset refs after rewrite");
}
if (!monHtml.includes(monJsName) || !monHtml.includes(cssName) || !monHtml.includes(monCssName)) {
  throw new Error("bundle: hashed monster asset refs not present after rewrite");
}
await Bun.write("dist/monster-resistances/index.html", monHtml);

// Fourth page: the skill item finder, its own bundle under dist/items/, sharing the hashed
// styles.css from the parent dir. Named items-main to avoid colliding.
const items = await Bun.build({
  entrypoints: ["src/items/app/main.ts"],
  outdir: "dist/items",
  target: "browser",
  minify: true,
  sourcemap: "linked",
  naming: "items-[name]-[hash].[ext]", // dist/items/items-main-<hash>.js
  define: { __ASSET_V__: JSON.stringify(assetVersion) },
});
if (!items.success) {
  for (const log of items.logs) console.error(log);
  throw new Error("bundle: items Bun.build failed");
}
const itemsEntry = items.outputs.find((o) => o.kind === "entry-point");
if (!itemsEntry) throw new Error("bundle: no items entry-point output");
const itemsJsName = itemsEntry.path.split(/[\\/]/).pop()!; // items-main-<hash>.js

const itemsCssBytes = await Bun.file("src/items/items.css").bytes();
const itemsCssName = `items-${createHash("sha256").update(itemsCssBytes).digest("hex").slice(0, 8)}.css`;
await Bun.write(`dist/items/${itemsCssName}`, itemsCssBytes);

let itemsHtml = await Bun.file("items.html").text();
itemsHtml = itemsHtml
  .replace('src="./items-main.js"', `src="./${itemsJsName}"`)
  .replace('href="../styles.css"', `href="../${cssName}"`)
  .replace('href="./items.css"', `href="./${itemsCssName}"`);
if (
  itemsHtml.includes('"./items-main.js"') ||
  itemsHtml.includes('"../styles.css"') ||
  itemsHtml.includes('"./items.css"')
) {
  throw new Error("bundle: items.html still has un-hashed asset refs after rewrite");
}
if (!itemsHtml.includes(itemsJsName) || !itemsHtml.includes(cssName) || !itemsHtml.includes(itemsCssName)) {
  throw new Error("bundle: hashed items asset refs not present after rewrite");
}
await Bun.write("dist/items/index.html", itemsHtml);

console.log(
  `bundled dist: ${jsName}, ${cssName}, ${rrJsName}, ${monJsName}, ${itemsJsName} (buildId ${buildId}, assetV ${assetVersion})`,
);
