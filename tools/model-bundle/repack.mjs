#!/usr/bin/env node
/**
 * Re-emits a built bundle as plain, uncompressed files in a shallow layout,
 * for uploading by hand through the R2 dashboard.
 *
 * Two reasons this exists:
 *  - The dashboard cannot set `Content-Encoding: br` on an object. Uploading
 *    compressed bytes without that header serves garbage to the browser.
 *  - The hub's `{model}/resolve/{revision}/` layout is five levels deep, which
 *    is miserable to recreate by hand. A flat prefix works just as well once
 *    `weightsPathTemplate` is set.
 */
import { mkdir, readFile, writeFile, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { brotliDecompressSync } from "node:zlib";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};

const source = flag("from", "out");
const outDir = flag("out", "r2-upload");
const slug = flag("slug", "");

const manifest = JSON.parse(await readFile(join(source, "manifest.json"), "utf8"));
const prefix = slug || manifest.model.split("/").pop().toLowerCase();

await rm(outDir, { recursive: true, force: true });
console.log(`\nrepacking ${manifest.model} (${manifest.dtype})`);
console.log(`layout    ${prefix}/…  (uncompressed)\n`);

let total = 0;
const uploaded = [];

for (const entry of manifest.files) {
  const filename = entry.key.split("/resolve/main/")[1];
  const target = join(outDir, prefix, filename);
  await mkdir(dirname(target), { recursive: true });

  const stored = await readFile(join(source, entry.key));
  const body = entry.contentEncoding === "br" ? brotliDecompressSync(stored) : stored;
  await writeFile(target, body);

  total += body.length;
  uploaded.push({ path: `${prefix}/${filename}`, bytes: body.length });
  console.log(`  ${filename.padEnd(28)} ${(body.length / 1048576).toFixed(2)} MB`);
}

await writeFile(
  join(outDir, "UPLOAD-ME.md"),
  [
    `# Upload these to R2`,
    ``,
    `Model: ${manifest.model} (${manifest.dtype}), uncompressed.`,
    ``,
    `Keep this exact structure under the bucket root:`,
    ``,
    "```",
    ...uploaded.map((f) => `${f.path}${" ".repeat(Math.max(1, 44 - f.path.length))}${(f.bytes / 1048576).toFixed(2)} MB`),
    "```",
    ``,
    `Total: ${(total / 1048576).toFixed(1)} MB`,
    ``,
    `Then in the app:`,
    ``,
    "```ts",
    `createLocalProvider({`,
    `  model: "${prefix}",`,
    `  weightsHost: "https://<your-r2-domain>/",`,
    `  weightsPathTemplate: "{model}/",`,
    `})`,
    "```",
  ].join("\n")
);

console.log(`\ntotal     ${(total / 1048576).toFixed(1)} MB → ${outDir}/${prefix}/`);
console.log(`\nsee ${outDir}/UPLOAD-ME.md\n`);
