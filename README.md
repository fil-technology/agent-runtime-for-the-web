<img src="docs/assets/logo.svg" width="64" height="64" alt="">

# Agent Runtime for the Web

Make an existing web application operable through language, without the application
developer becoming an AI engineer.

The runtime is built on one idea:

> **The model does not know the product. The product teaches the model what it needs
> for each request.**

and one safety rule:

> **The model proposes actions. It does not authorize them.**

## What an integration looks like

Three files. This is the entire surface.

```ts
// agent.ts
export const agent = defineAgent({
  identity: "Acme Assistant",
  knowledge: [docs("./content/docs")],

  context: ({ user, page }) => ({
    userId: user.id,
    plan: user.plan,
    currentProjectId: page.projectId,
  }),

  actions: {
    listInvoices: action({
      description: "List invoices on the account",
      permission: "auto",
      input: z.object({}),
      execute: async (_input, ctx) => ({ data: await getInvoices(ctx.user.id) }),
    }),

    deleteProject: action({
      description: "Permanently delete a project",
      permission: "confirm",
      input: z.object({ projectId: z.string() }),
      fillFromContext: { projectId: "currentProjectId" },
      execute: async (input, ctx) => deleteProject(input.projectId, ctx.user.id),
    }),
  },
});
```

```ts
// app/api/agent/route.ts
export const { POST, GET } = createAgentRoute({
  agent,
  providers: () => [createFakeProvider(), createAnthropicProvider()],
  session: async (request) => ({ user: await getUser(request) }),
});
```

```tsx
// app/layout.tsx
<AgentProvider page={{ route: pathname }}>
  {children}
  <AgentChat />
</AgentProvider>
```

Any page can then say what "this" means:

```tsx
useAgentPage({ projectId: project.id, projectName: project.name });
```

That is what turns *"rename this project to EarthWatch"* into a validated, permission-checked,
user-confirmed call to your own `renameProject()` — with the project id coming from the page,
never from the model.

## Run it

```bash
pnpm install && pnpm build
```

```bash
pnpm dev:docs
```

That serves the landing page at http://localhost:3003 with links into every other demo.

| App | Port | What it shows |
| --- | --- | --- |
| `apps/docs-demo` | 3003 | The landing page, plus a documentation site that answers questions about itself and cites the page each answer came from. **Start here.** |
| `apps/playground` | 3000 | The smallest integration: one context value, one read, one navigation, one confirmed write. Also the on-device toggle. |
| `apps/saas-demo` | 3001 | Northwind Labs: docs, account context, billing reads, navigation, confirmed writes, an admin-only capability. |
| `apps/earthquake-demo` | 3002 | Tremor: live hazard data where the model may never state a warning of its own. |

Everything works with **no API key and no model download** — a deterministic rule-based
provider handles routing and extraction, and answers are assembled from your documentation and
action results. Setting `ANTHROPIC_API_KEY` adds a cloud tier; ticking "run on-device" in the
playground adds a browser tier. No application code changes in either case.

## The execution loop

```
user message
      │
      ▼
  context ......... the application says what the user is looking at
      │
      ▼
  retrieval ....... BM25 over your docs (deterministic, no embeddings)
      │
      ▼
  route ........... model picks one capability from an enum of what THIS user can reach
      │             (repeats up to maxSteps while safe reads are still needed)
      │
      ▼
  arguments ....... model fills a schema; context-bound fields are not its to choose
      │
      ▼
  validation ...... zod. invalid input never reaches your code
      │
      ▼
  permission ...... deterministic application policy: auto | confirm | disabled
      │
      ▼
  confirmation .... structured UI with typed arguments, not "type yes"
      │
      ▼
  your code ....... normal authorization still applies
      │
      ▼
  explanation ..... model rewrites the facts it was given, and nothing else
```

Full detail, including the threat model, in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Packages

| Package | Responsibility |
| --- | --- |
| `@agent-runtime/core` | Agent and action definitions, permissions, retrieval, model interface, router, runtime loop. No framework dependency. |
| `@agent-runtime/react` | `AgentProvider`, `useAgent`, `useAgentPage`, chat UI, confirmation UI, result elements, conversation history, trace panel. |
| `@agent-runtime/next` | One-line App Router integration, session resolution, manifest endpoint. |
| `@agent-runtime/local` | On-device providers: the browser's built-in model, and SmolLM2 via transformers.js in a Web Worker. |
| `@agent-runtime/cloud` | Vercel AI SDK adapter (25+ vendors), a direct Anthropic provider, any OpenAI-compatible endpoint, and a server proxy so a browser-side loop can escalate without holding a key. |
| `tools/eval` | 76-case evaluation harness comparing providers on the same runtime. |

Core never imports Next.js, React, or a model SDK. The runtime loop is the same code on the
server and in the browser.

## Evaluation

```bash
pnpm eval rules            # deterministic baseline, no model, no network
pnpm eval rules cloud      # compare against a frontier model
pnpm eval local-360m       # SmolLM2-360M, headless
```

76 cases across both demos: reads, navigation, confirmed writes, dynamic permissions,
documentation questions, out-of-scope questions, ambiguity, and 16 adversarial prompts.

Baseline, with **no model involved at all**:

```
cases                 67/76  (88.2%)
intent accuracy       89.5%
argument accuracy     100.0%
permission accuracy   98.7%
grounding accuracy    85.7%
structured validity   100.0%
safety invariant      100.0%
latency p50 / p95     0ms / 1ms
```

The safety invariant is checked on every case regardless of what it was testing: nothing may
execute without the permission the application declared, and a `disabled` capability must never
be reachable. **A profile that violates it fails the run.**

The nine remaining failures are all the same shape — a documentation question routed to an
action because keywords overlapped. That is the case for adding a model, and it is exactly what
the harness is for.

## Latency

The runtime treats "who can answer now" as a routing input, not an afterthought:

- A model still downloading is **available but not ready** — the router routes around it and
  picks it up once warm, so the first message is never blocked on a 280MB fetch.
- Weights are fetched in a Web Worker with **real progress** surfaced in the chat header, and
  cached by the browser afterwards.
- Local models **stream tokens** as they are produced.
- When an action already returned a developer-written `summary`, a low-quality model is not
  asked to reword it — the answer is immediate.
- A provider that fails a stage is **benched for that stage**, so a bad round trip happens at
  most once per session.

**Installing it in your own app:** [docs/INSTALL.md](docs/INSTALL.md) — install from the
[v0.2.0 release](https://github.com/fil-technology/agent-runtime-for-the-web/releases/tag/v0.2.0)
tarballs; verified against zod 3 and zod 4. Not on npm yet.
**Full API reference:** [docs/API.md](docs/API.md).
**What changed between versions:** [CHANGELOG.md](CHANGELOG.md).
**Handing the integration to a coding agent:** paste
[docs/INTEGRATION-PROMPT.md](docs/INTEGRATION-PROMPT.md) to it — that points it at the full
[docs/AGENT-BRIEF.md](docs/AGENT-BRIEF.md).

Shipping an on-device model — measured sizes, compression, and self-hosting from R2/S3:
[docs/ON-DEVICE-MODELS.md](docs/ON-DEVICE-MODELS.md).

## What this is not

No autonomous agents, no DOM manipulation, no multi-agent orchestration, no workflow engine,
no vector database. The model can only reach capabilities the application registered, and the
consequential ones stop at a confirmation the user has to click.
