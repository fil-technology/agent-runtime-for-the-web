---
title: Grounding
url: /docs/grounding
---

# Grounding

The model never owns product truth. Every fact it may state is supplied per request, from your
documentation or from an action result.

## Refusing instead of improvising

When nothing grounds an answer, the runtime refuses. `groundedOnly` is on by default, and in a
product that reports hazards or account state this is not a nicety.

## Retrieval

Documentation is chunked on markdown headings at build time and searched with BM25 — no
embeddings, no vector store, no network call.

Grounding does not threshold on relevance rank, because the best match always ranks first even
when it is a bad match. It thresholds on IDF-weighted coverage: how much of the question's
informative vocabulary a chunk actually contains. That number is what makes "I don't have
anything on that" reachable.

## Sources

Because the runtime knows exactly which chunks it used, every grounded answer can name its
source and offer to open the page.
