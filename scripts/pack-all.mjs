#!/usr/bin/env node
/**
 * Packs every publishable package into ./dist-packages.
 *
 * Paths are passed as argv rather than interpolated into a shell string:
 * this repository lives under a directory with spaces in its name, and a
 * quoted-string command silently packs into the wrong folder.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const PACKAGES = ["core", "react", "next", "local", "cloud"];
const out = resolve(process.env.OUT ?? "dist-packages");
mkdirSync(out, { recursive: true });

for (const name of PACKAGES) {
  execFileSync("pnpm", ["pack", "--pack-destination", out], {
    cwd: resolve("packages", name),
    stdio: ["ignore", "ignore", "inherit"],
  });
}

console.log(`\npacked into ${out}\n`);
for (const file of readdirSync(out).sort()) console.log(`  ${file}`);
