import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, extname, basename } from "node:path";
import type { KnowledgeChunk, KnowledgeSource } from "../types.js";
import { chunkMarkdown } from "../knowledge/chunk.js";

/** Filesystem loader for docs() sources. Node only. */
export async function loadDocs(
  source: Extract<KnowledgeSource, { kind: "docs" }>
): Promise<KnowledgeChunk[]> {
  const extensions = source.extensions ?? [".md", ".mdx", ".txt"];
  const files = await walk(source.dir);
  const chunks: KnowledgeChunk[] = [];

  for (const file of files) {
    if (!extensions.includes(extname(file))) continue;
    const text = await readFile(file, "utf8");
    const rel = relative(source.dir, file);
    const { body, title, url } = parseFrontmatter(text, basename(file, extname(file)));
    chunks.push(
      ...chunkMarkdown(body, {
        source: rel,
        title,
        idPrefix: rel,
        ...(url ? { url } : {}),
      })
    );
  }
  return chunks;
}

async function walk(dir: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    throw new Error(
      `docs("${dir}") could not be read. Paths are resolved relative to the process working directory (${process.cwd()}).`
    );
  }
  const out: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry);
    const info = await stat(full);
    if (info.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}

function parseFrontmatter(
  text: string,
  fallbackTitle: string
): { body: string; title: string; url?: string } {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) {
    const heading = text.match(/^#\s+(.*)$/m);
    return { body: text, title: heading?.[1]?.trim() ?? fallbackTitle };
  }
  const meta: Record<string, string> = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (kv) meta[kv[1]!] = kv[2]!.replace(/^["']|["']$/g, "").trim();
  }
  const body = text.slice(match[0].length);
  return {
    body,
    title: meta.title ?? fallbackTitle,
    ...(meta.url ? { url: meta.url } : {}),
  };
}
