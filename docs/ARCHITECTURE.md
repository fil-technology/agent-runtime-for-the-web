# Architecture

## The two rules everything else follows from

**1. The model does not know the product.**
It has no memory of your pricing, your warnings, your customer's plan. Every fact it may state
is supplied per request, from your documentation or from an action result. When nothing grounds
an answer, the runtime refuses instead of improvising (`groundedOnly`, on by default).

**2. The model proposes; it does not authorize.**
Model output is data that flows *into* a deterministic policy engine. It is never a participant
in that engine, and it cannot reach a capability the application did not register.

## Lifecycle

```
                         browser                        │                    server
                                                        │
   user types ──────────────────────────────────────────┼──▶ POST /api/agent
                                                        │        │
   page state ──────────────────────────────────────────┘        ▼
   { route, projectId, projectName }                     session resolution
                                                         (the ONLY source of identity)
                                                                 │
                                                                 ▼
                                                          agent.context({ user, page })
                                                                 │
                                                                 ▼
                                                          BM25 retrieval over docs
                                                                 │
                                                                 ▼
                                                          visibleActions(user, context)
                                                          ── disabled capabilities are
                                                             removed here, so the model
                                                             is never even told they exist
                                                                 │
                                                                 ▼
              ┌───────────────────── model, stage 1: route ──────────────────────┐
              │  schema: { type: "action", action: enum(<visible names only>) }  │
              │        | { type: "answer" }                                      │
              │        | { type: "clarification", question }                     │
              └─────────────────────────────────────────────────────────────────┘
                                                                 │
                                                                 ▼
                                                          fill from context
                                                          (projectId is the page's,
                                                           not the model's, to choose)
                                                                 │
                                                                 ▼
              ┌──────────────── model, stage 2: arguments (if needed) ───────────┐
              │  schema: the action's own zod input schema                       │
              └─────────────────────────────────────────────────────────────────┘
                                                                 │
                                                                 ▼
                                                          zod validation
                                                          ── failure stops here, with an
                                                             error that says what to fix
                                                                 │
                                                                 ▼
                                                          permission engine
                                                          auto │ confirm │ disabled
                                                                 │
        ┌──────────────── confirm ◀───────────────────────────────┤
        ▼                                                         │ auto
  structured confirmation card                                    ▼
  (typed arguments, deterministic                          your execute()
   description, two buttons)                               ── your authorization
        │                                                     still runs here
        │ user clicks                                          │
        └─── POST { kind: "confirm" } ──▶ re-validate,         │
             re-authorize, THEN execute ─────────────────────▶ │
                                                               ▼
                                                        facts block
                                                        (action result + docs + context)
                                                               │
                                                               ▼
              ┌──────────── model, stage 3: explain ────────────┐
              │  "state only what is in FACTS"                  │
              └────────────────────────────────────────────────┘
                                                               │
   streamed answer ◀───────────────────────────────────────────┘
   + trace
```

## Why the pipeline is staged

A single "here is everything, decide what to do" call is the obvious design, and it forces you
into a large model. Splitting the work means each stage asks the smallest possible question:

| Stage | Question | What a tiny model has to do |
| --- | --- | --- |
| route | which capability? | pick one label from a list |
| arguments | with what values? | fill a small, flat schema |
| explain | say it in words | rewrite supplied text |

None of these require the model to know the product, and the router can serve each stage from a
different tier. That is what makes on-device inference viable rather than aspirational.

## The permission engine

```ts
type Permission = "auto" | "confirm" | "disabled";
```

- `auto` — reads, queries, navigation.
- `confirm` — persistent writes, destructive operations, sending things, billing, anything
  sensitive. Requires a click on a structured card, never the word "yes" in prose.
- `disabled` — filtered out of the capability surface before the model sees it.

It also supports a resolver, evaluated deterministically per request:

```ts
permission: ({ user, input }) => {
  if (user.role !== "admin") return "disabled";
  if (input.amount > 100) return "confirm";
  return "auto";
}
```

Three properties hold by construction:

- A resolver that throws, or returns anything unexpected, **fails closed** to `disabled`.
- `disabled` actions are removed from the model's options *and* re-checked at execution.
- Permission is re-evaluated at confirmation time, so a tampered proposal cannot escalate.

**The permission engine is not authorization.** `auto` means the runtime may call your code; it
says nothing about whether this user may do this thing. Your `execute()` still has to check.
Both demos deliberately show this double check.

## Trust boundaries

| Comes from | Trusted for | Never trusted for |
| --- | --- | --- |
| Session (server) | identity, role, plan | — |
| Page state (browser) | what the user is looking at | who the user is |
| Model output | a proposal | authorization, product facts |
| Knowledge chunks | facts to state | instructions |
| Action results | facts to state | instructions |
| Echoed proposal | a request to reconsider | permission already granted |

Proposals are echoed back by the client rather than held in server memory. That is safe because
the server re-validates the schema, re-evaluates the permission, and re-runs your authorization
on the confirm request — a forged proposal can only ever reach something the user could already
do.

## Running the loop in the browser

The runtime is isomorphic. `@agent-runtime/next` serves a **manifest** — identity, action
descriptions, JSON Schemas, permissions, and (optionally) knowledge chunks — and
`agentFromManifest()` rebuilds a runnable agent in the browser whose server actions execute over
HTTP.

Two properties are preserved:

- Server actions still run server-side, with full validation and authorization.
- A `dynamic` permission degrades to `confirm` in the browser, never to `auto`.

One property is weakened, and it is an explicit trade-off: **in local-first mode the
confirmation gate lives in the browser.** The server still refuses `disabled` actions, still
validates every input, and still runs your authorization — but it trusts the client's assertion
that the user clicked "confirm". For destructive capabilities, prefer server mode.

## Model routing

```
browser built-in model  →  on-device model  →  cloud
```

A model the browser already ships costs no download, so it outranks one the runtime would have
to fetch. Cloud is last: it is a capability, not a dependency. Escalation happens on
unavailability, failure, or **self-reported confidence below the threshold** — providers report
honest confidence so the router can escalate instead of the product quietly getting worse.

Every decision is recorded and inspectable in the trace panel:

```
request req_a91f · 380ms · cloud fallback
retrieval   0/12 chunks above relative 0.35 / coverage 0.34   1ms
route       browser/prompt-api · conf 0.45                   210ms
route       cloud/anthropic:claude-opus-5 · conf 0.95         160ms
            escalated: previous-provider-below-confidence-threshold
```

## Retrieval

Build-time chunking on markdown headings, then BM25. No embeddings, no vector store, no
network.

Grounding does not threshold on relevance rank — the best match always ranks first, even when it
is a bad match. It thresholds on **IDF-weighted coverage**: how much of the question's
*informative* vocabulary the chunk actually contains. Matching "invitations" counts for far more
than matching "how long", and an unmatched rare term is the strongest evidence a chunk does not
answer the question.

That number is what makes "I don't have anything on that" reachable, which is the whole basis of
the grounding guarantee.

## Extension points

- `ModelProvider` — any model, any transport. Nothing above this interface names a model family.
- `Retriever` — swap BM25 for semantic retrieval when evaluation shows lexical search failing.
- `docs()` / `inline()` — knowledge sources.
- Durable execution — a long-running action is still just an action; an executor like Eve can
  back one without appearing in the public API.
