import type { KnowledgeChunk, RetrievedChunk } from "../types.js";

/**
 * Includes pronoun-like fillers ("one", "them", "those") on purpose: they read
 * as content words but carry no topic. Without that, "and that one?" matches
 * any action whose examples happen to contain the word "one".
 */
const STOPWORDS = new Set(
  ("a an and are as at be by can do does for from had has have how i if in is it its me my of on " +
    "or our so than that the their then there these this to was what when where which who why " +
    "will with you your one ones them those here mean means meaning").split(" ")
);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]+/gu, " ")
    .split(/[\s_-]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
    .map(stem);
}

/** Deliberately crude suffix stripping: enough for docs, no dependency. */
function stem(token: string): string {
  for (const suffix of ["ing", "ies", "ed", "es", "s"]) {
    if (token.length > suffix.length + 2 && token.endsWith(suffix)) {
      return token.slice(0, -suffix.length);
    }
  }
  return token;
}

interface IndexedChunk {
  chunk: KnowledgeChunk;
  length: number;
  frequencies: Map<string, number>;
}

/**
 * Lexical BM25 retrieval.
 *
 * Chosen over a vector store on purpose: it needs no embedding model, no
 * network call and no infrastructure, and product documentation is
 * vocabulary-heavy. The Retriever interface leaves room for a semantic
 * implementation once evaluation shows lexical search failing.
 */
export class Bm25Index {
  private readonly documents: IndexedChunk[] = [];
  private readonly documentFrequency = new Map<string, number>();
  private averageLength = 0;

  constructor(
    chunks: KnowledgeChunk[] = [],
    private readonly options: { k1?: number; b?: number } = {}
  ) {
    if (chunks.length) this.add(chunks);
  }

  add(chunks: KnowledgeChunk[]): void {
    for (const chunk of chunks) {
      // Titles carry disproportionate signal in docs; weight them by repetition.
      const tokens = tokenize(`${chunk.title} ${chunk.title} ${chunk.text}`);
      const frequencies = new Map<string, number>();
      for (const token of tokens) {
        frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
      }
      for (const token of frequencies.keys()) {
        this.documentFrequency.set(token, (this.documentFrequency.get(token) ?? 0) + 1);
      }
      this.documents.push({ chunk, length: tokens.length, frequencies });
    }
    const total = this.documents.reduce((sum, d) => sum + d.length, 0);
    this.averageLength = this.documents.length ? total / this.documents.length : 0;
  }

  get size(): number {
    return this.documents.length;
  }

  search(query: string, limit = 4): RetrievedChunk[] {
    if (!this.documents.length) return [];
    const k1 = this.options.k1 ?? 1.5;
    const b = this.options.b ?? 0.75;
    const terms = tokenize(query);
    if (!terms.length) return [];

    const distinctTerms = [...new Set(terms)];
    // Coverage is weighted by how informative each term is. Matching
    // "invitations" says far more about relevance than matching "how long",
    // and an unmatched rare term is the strongest signal that a chunk does not
    // answer the question at all.
    const idfOf = (term: string) => {
      const df = this.documentFrequency.get(term) ?? 0;
      return Math.log(1 + (this.documents.length - df + 0.5) / (df + 0.5));
    };
    const totalIdf = distinctTerms.reduce((sum, term) => sum + idfOf(term), 0) || 1;

    const scored = this.documents.map((doc) => {
      let score = 0;
      let matchedIdf = 0;
      for (const term of distinctTerms) {
        const frequency = doc.frequencies.get(term);
        if (!frequency) continue;
        const idf = idfOf(term);
        matchedIdf += idf;
        const norm = 1 - b + (b * doc.length) / (this.averageLength || 1);
        score += idf * ((frequency * (k1 + 1)) / (frequency + k1 * norm));
      }
      return {
        ...doc.chunk,
        score,
        rawScore: score,
        coverage: matchedIdf / totalIdf,
      };
    });

    const max = Math.max(...scored.map((s) => s.score), 0);
    return scored
      .filter((s) => s.score > 0)
      .sort((a, b2) => b2.score - a.score)
      .slice(0, limit)
      .map((s) => ({ ...s, score: max ? s.score / max : 0 }));
  }
}
