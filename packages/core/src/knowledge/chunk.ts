import type { KnowledgeChunk } from "../types.js";

export interface ChunkOptions {
  /** Approximate characters per chunk. */
  size?: number;
  source: string;
  /** Document title fallback. */
  title: string;
  idPrefix: string;
  url?: string;
}

/**
 * Build-time chunking: split on markdown headings first, then on size.
 * Headings become chunk titles, which is most of the retrieval signal.
 */
export function chunkMarkdown(text: string, options: ChunkOptions): KnowledgeChunk[] {
  const size = options.size ?? 900;
  const sections: Array<{ title: string; body: string[] }> = [];
  let current = { title: options.title, body: [] as string[] };

  for (const line of text.split(/\r?\n/)) {
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      if (current.body.join("\n").trim()) sections.push(current);
      current = { title: heading[2]!.trim(), body: [] };
    } else {
      current.body.push(line);
    }
  }
  if (current.body.join("\n").trim()) sections.push(current);

  const chunks: KnowledgeChunk[] = [];
  for (const section of sections) {
    const body = section.body.join("\n").trim();
    if (!body) continue;
    for (const piece of splitBySize(body, size)) {
      chunks.push({
        id: `${options.idPrefix}#${chunks.length}`,
        title: section.title,
        text: piece,
        source: options.source,
        ...(options.url ? { url: options.url } : {}),
      });
    }
  }
  return chunks;
}

function splitBySize(text: string, size: number): string[] {
  if (text.length <= size) return [text];
  const paragraphs = text.split(/\n{2,}/);
  const out: string[] = [];
  let buffer = "";
  for (const paragraph of paragraphs) {
    if (buffer && buffer.length + paragraph.length > size) {
      out.push(buffer.trim());
      buffer = "";
    }
    buffer += (buffer ? "\n\n" : "") + paragraph;
  }
  if (buffer.trim()) out.push(buffer.trim());
  return out;
}
