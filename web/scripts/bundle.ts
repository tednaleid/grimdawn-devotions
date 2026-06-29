// ABOUTME: Builds the planner's JS/CSS into web/dist with content-hashed, minified filenames.
// ABOUTME: Bundles main.ts (Bun.build), hashes styles.css, and rewrites the asset refs in index.html.
import { createHash } from "node:crypto";
import { computeBuildId } from "../src/adapters/coverTableBlob";

// buildId tags the data ?v= and is checked against the cover blob; it is data-only by design.
const buildId = computeBuildId(await Bun.file("../data/devotions.json").text());

const result = await Bun.build({
  entrypoints: ["src/app/main.ts"],
  outdir: "dist",
  target: "browser",
  minify: true,
  sourcemap: "linked", // emits main-<hash>.js.map; only fetched when devtools is open
  naming: "[name]-[hash].[ext]", // dist/main-<hash>.js
  define: { __BUILD_ID__: JSON.stringify(buildId) },
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

console.log(`bundled dist: ${jsName}, ${cssName} (buildId ${buildId})`);
