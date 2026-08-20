import type { KnowledgeSource, KnowledgeChunk, RetrievedChunk } from "../types.js";
import { Bm25Index } from "./bm25.js";
import { configError } from "../errors.js";

export { Bm25Index, tokenize } from "./bm25.js";
export { chunkMarkdown } from "./chunk.js";

export interface Retriever {
  search(query: string, limit?: number): Promise<RetrievedChunk[]> | RetrievedChunk[];
  readonly size: number;
}

export type DocsLoader = (
  source: Extract<KnowledgeSource, { kind: "docs" }>
) => Promise<KnowledgeChunk[]>;

let docsLoader: DocsLoader | undefined;

/**
 * Filesystem access is injected, never imported.
 *
 * Core has to stay importable from a browser bundle — the runtime can run on
 * the device — so it cannot reference node:fs even behind a dynamic import,
 * which bundlers still follow. @agent-runtime/next registers the loader.
 */
export function registerDocsLoader(loader: DocsLoader): void {
  docsLoader = loader;
}

export async function buildRetriever(sources: KnowledgeSource[] = []): Promise<Retriever> {
  return new Bm25Index(await loadKnowledgeChunks(sources));
}

/** Resolves every knowledge source to concrete chunks. */
export async function loadKnowledgeChunks(
  sources: KnowledgeSource[] = []
): Promise<KnowledgeChunk[]> {
  const chunks: KnowledgeChunk[] = [];
  for (const source of sources) {
    if (source.kind === "inline") {
      chunks.push(...source.chunks);
      continue;
    }
    if (!docsLoader) {
      throw configError(
        `docs("${source.dir}") needs a filesystem loader, and none is registered.`,
        `Create the runtime through @agent-runtime/next (createAgentRoute registers it), or call registerDocsLoader(loadDocs) yourself:\n\n` +
          `  import { registerDocsLoader } from "@agent-runtime/core";\n` +
          `  import { loadDocs } from "@agent-runtime/core/node";\n` +
          `  registerDocsLoader(loadDocs);\n\n` +
          `In a browser bundle, use inline([...]) instead, or serve the chunks through the agent manifest.`
      );
    }
    chunks.push(...(await docsLoader(source)));
  }
  return chunks;
}
