# API reference

Every export, what it is for, and the shape it takes. Types are abbreviated for readability;
the packages ship full `.d.ts`.

## `@agent-runtime/core`

No runtime dependencies beyond your own zod (3 or 4).

### Defining an agent

```ts
defineAgent({
  identity: string;              // the product's name; appears in the UI and grounds refusals
  instructions?: string;         // short extra grounding; this is not a system-prompt product
  knowledge?: KnowledgeSource[]; // docs("./content/docs") or inline([...])
  context?: ({ user, page, session }) => AgentContext;
  actions: Record<string, ActionDefinition>;
  models?: {
    strategy?: "auto" | "local-only" | "cloud-only";
    localBudgetMB?: number;      // default 400
    cloudFallback?: boolean;     // default true
    confidenceThreshold?: number;// default 0.55 — below this the router escalates
  };
  groundedOnly?: boolean;        // default true: refuse rather than improvise
  maxSteps?: number;             // default 1, clamped to 5: safe reads per turn
}): Agent
```

### Actions

```ts
action({
  description: string;           // what the model routes on; write it from the user's view
  permission: "auto" | "confirm" | "disabled" | (({ user, input }) => Permission);
  input: ZodType;                // flat objects of primitives, enums, small arrays
  execute: (input, ctx) => { summary?: string; data?: JsonValue } | any;
  fillFromContext?: Record<string, string>;  // inputField -> contextKey; authoritative
  confirmLabel?: string;         // button text on the confirmation card
  describe?: (input, context) => string;     // the sentence shown before approving
  clarify?: (missing, context) => string;    // what to say when an argument is missing
  resolve?: Record<string, (ctx) => Choice[] | Promise<Choice[]>>;  // where the answers come from
  examples?: string[];           // phrasings; used for routing and evaluation
  authoritative?: boolean;       // this result is product truth
}): ActionDefinition
```

`clientAction({ ... })` takes the same options minus `execute` — the browser supplies the
implementation via `<AgentProvider clientActions>`.

`ctx` inside `execute`: `{ context, user, session, requestId, signal }`. Resolvers get the
same `ctx`.

#### `resolve` — answering "which one?" without sending the user away

An action that needs a `projectId` cannot always get one. The page may not name a project, and
the sentence may not either. Without `resolve` the only honest reply is a question, and the
question tends to become *"open a project from the sidebar and ask again"* — which is the
product telling the user to go and do the work by hand.

`resolve` says where the candidates come from:

```ts
resolve: {
  projectId: (ctx) =>
    listProjects(ctx.user.id).map((p) => ({ value: p.id, label: p.name, hint: p.environment })),
}
```

The runtime then:

| candidates | what happens |
| --- | --- |
| exactly one | it is used; nothing is asked |
| several | the question is asked **with the choices attached**, rendered as buttons |
| none | falls back to `clarify()` |

Choices round-trip on the pending clarification, and the next turn matches what the user says
against the **labels** — so clicking a button and typing "the coastal one" are the same act, and
no internal id is ever shown to the user or accepted from them. A reply that names no choice
re-asks rather than guessing.

**Enums need no resolver.** A `z.enum([...])` field already states its own answers,
so the runtime offers them as choices without the application repeating them.
`resolve` is for candidates only the application can know — rows, ids, entities.

**One question at a time.** Gaps are asked about in the order the schema declares
them, never bundled into "which project and name do you mean?". Answering one and
being asked the next is progress, so the repeat-question guard only counts repeats
of the *same* gap; an action needing three arguments can be completed in three
replies.

**A reply to a one-field question is the value.** Asked "what should I rename it
to?", the answer "EarthWatch" is taken literally — no extraction call. This applies
only to fields the user *authors*; an id or a `resolve`-backed field is chosen from
what exists, so "the one in staging" is never stored as an id. A reply that clearly
routes elsewhere ("show my invoices") supersedes the question instead of becoming
its answer, and "cancel" drops it.

Resolvers must return only what this user may act on. Permission is still evaluated afterwards,
but a resolver that leaks another tenant's rows has already leaked them by naming them.

Because the target may have been chosen this way, `describe()` must not assume the page names
it — look the name up from the id, or the confirmation will read "Permanently delete abc123?".

### Running it

```ts
new AgentRuntime({ agent, providers, retriever?, debug?, onTrace? })

runtime.handle(request, { session })   // → Promise<AgentTurn>
runtime.stream(request, { session })   // → AsyncGenerator<AgentEvent>
runtime.describeActions()              // → the capability surface, for docs and evals
```

Requests: `{ kind: "message" | "confirm" | "client-result" | "execute", ... }`.

`AgentTurn`: `{ answer?, proposal?, pending?, recall?, sources?, outcomes, error?, trace }`.

Events: `stage`, `delta`, `answer`, `proposal`, `pending`, `recall`, `sources`, `outcome`,
`error`, `trace`, `done`.

### Permissions

```ts
evaluatePermission(action, { input, context, user }) // → PermissionDecision
visibleActions(actions, { context, user })           // the model's capability surface
```

A resolver that throws, or returns anything unexpected, fails closed to `disabled`.

### Knowledge

```ts
docs(dir, { extensions? })   // filesystem source; needs @agent-runtime/next or registerDocsLoader
inline([{ id, title, text, url? }])
buildRetriever(sources)      // → Retriever
loadKnowledgeChunks(sources) // → KnowledgeChunk[]
registerDocsLoader(loader)   // inject filesystem access into an isomorphic core
Bm25Index, tokenize, chunkMarkdown
```

### Models

```ts
interface ModelProvider {
  id: string;
  capabilities(): Promise<ModelCapabilities>;
  generate(input): Promise<GenerateResult>;
  generateStructured<T>(input): Promise<StructuredResult<T>>;
  generateStream?(input): AsyncIterable<string>;
  preload?(): Promise<void>;
}
```

`ModelCapabilities`: `{ id, label, tier, structuredOutput, streaming, quality, privacy,
available, unavailableReason?, readyNow?, loadProgress?, approxSizeMB?, maxInputTokens?, tasks }`.

Stages (`ModelTask`): `route` · `extract` · `explain` · `answer`.

```ts
createFakeProvider(options?)   // deterministic, rule-based; the default and the eval baseline
new ModelRouter(providers, policy)
```

### Manifests

```ts
buildManifest(agent, { knowledge? })            // serializable description of the agent
agentFromManifest(manifest, { execute, clientActions })  // rebuild it in the browser
jsonSchemaToZod(schema)
```

### Schema helpers

`toJsonSchema` · `describeSchema` · `objectFields` · `extractJson` — all work with zod 3 and 4.

### Errors

`AgentError` with `code`, `details`, `hint`. Codes: `UNKNOWN_ACTION`, `INVALID_ACTION_INPUT`,
`ACTION_DISABLED`, `CONFIRMATION_REQUIRED`, `NO_PROVIDER`, `MODEL_OUTPUT_INVALID`,
`ACTION_FAILED`, `CONFIG_INVALID`, `UNGROUNDED`.

## `@agent-runtime/next`

```ts
createAgentRoute({
  agent,
  providers: ModelProvider[] | (() => ModelProvider[]),
  session?: (request) => SessionState,   // the only source of identity
  exposeKnowledge?: boolean,             // ship chunks to the browser for on-device retrieval
  debug?: boolean,
  onTrace?: (trace) => void,
}) // → { POST, GET, runtime }
```

`GET ?manifest=1` returns the browser-side manifest. `POST { kind: "context" }` returns resolved
application context.

## `@agent-runtime/react`

```tsx
<AgentProvider
  endpoint="/api/agent"
  page={{ route }}
  clientActions={{ navigate: (input) => ... }}
  onNavigate={(path) => router.push(path)}
  providers={[]}                  // supplying any switches the loop into the browser
  mode="server" | "local-first"
  storage={ConversationStore | false}
  namespace="my-app"
  autoRunClientActions={false}    // default: offer, don't perform
  debug
/>

useAgent()      // items, status, activeStage, conversations, send, approve, decline, open, …
useAgentPage({ ... })  // publish page state; cleared on unmount
<AgentChat title suggestions defaultOpen launcherLabel />
<DebugPanel />
createLocalConversationStore({ namespace?, limit?, maxItems? })
agentStyles, injectStyles      // ~200 lines of CSS, themed by custom properties
```

## `@agent-runtime/cloud`

```ts
createAiSdkProvider({ model, tier?, quality?, tasks?, providerOptions? })  // any AI SDK model
createAnthropicProvider({ apiKey?, model?, effort?, tasks? })
createOpenAiCompatibleProvider({ baseUrl, apiKey?, model, ... })
createProxyProvider({ endpoint })         // browser-side handle on a server provider
createModelProxyRoute({ provider, authorize? })   // the server half; keys never reach the client
```

## `@agent-runtime/local`

```ts
createBrowserAiProvider({ tasks?, temperature? })   // the browser's built-in model
createLocalProvider({
  model?,            // default HuggingFaceTB/SmolLM2-360M-Instruct
  dtype?, device?,   // "webgpu" | "wasm" | "auto"
  weightsHost?,      // serve weights from your own origin — see ON-DEVICE-MODELS.md
  allowNode?,        // benchmark headlessly
  tasks?, requireWebGpu?, useWorker?, loadTimeoutMs?,
})
createEngine, hasWebGpu, loadTransformers
```

## Customising the chat UI

Three levels, in order of how much you take on.

### 1. Props

```tsx
<AgentChat
  title="QuakeMate"
  placeholder="Ask about earthquakes, tsunamis or volcanoes"
  suggestions={["Is there a tsunami warning right now?", "Earthquakes in Japan this week"]}
  launcherLabel="Ask QuakeMate"
  defaultOpen={false}
/>
```

#### Pacing

```tsx
<AgentProvider minThinkingMs={450}>   // default; 0 shows answers instantly
```

The deterministic provider answers in single-digit milliseconds. Without a floor the reply
simply appears, which reads as a canned string rather than something worked out — and a turn
that did real work looks identical to one that did none. The indicator shows the stage the
runtime actually reached ("Working out what you need", "Looking through the docs"), so what is
held is the *display*, never the work: the request has already completed, and an answer that
takes longer than the floor is never delayed past its own arrival.

#### Attribution

```tsx
<AgentChat poweredBy />                                   // mark + "Powered by Agent Runtime"
<AgentChat poweredBy={{ label: "…", href: "…" }} />       // or your own wording and target
```

**Off by default.** An SDK that puts its own name inside somebody else's product without being
asked is the kind of thing that gets torn out wholesale, and a badge nobody chose is worth
less than one somebody kept.

The mark is an inline SVG drawn in `currentColor` — no asset, no network request, and it takes
the surrounding text colour in either theme. Export it on its own with
`import { AgentRuntimeMark } from "@agent-runtime/react"`.

### 2. CSS variables and classes

Every colour comes from a variable on `.ar-root`, so restyling is a few lines in your own
stylesheet — no fork, no props threading:

```css
.ar-root {
  --ar-accent: #ff3b30;      /* buttons, links, the "Open →" affordance */
  --ar-accent-fg: #ffffff;
  --ar-bg: #14161a;          /* panel background */
  --ar-fg: #f2f3f5;          /* text */
  --ar-muted: #9aa1ad;       /* secondary text */
  --ar-line: #272b32;        /* borders */
  --ar-surface: #1b1e24;     /* cards, assistant bubbles */
  --ar-danger: #d33b3b;
  --ar-radius: 12px;
  --ar-font: "Your Font", system-ui, sans-serif;
}
```

Dark mode is `prefers-color-scheme` by default; override the same variables under your own
selector to control it yourself.

Every element carries a stable class — `.ar-panel`, `.ar-messages`, `.ar-msg-user`,
`.ar-msg-assistant`, `.ar-result`, `.ar-result-row`, `.ar-choice`, `.ar-proposal`,
`.ar-composer`, `.ar-launcher` — so you can restyle any part without touching the markup.
`injectStyles` only inserts the stylesheet once and never overrides a rule you wrote later.

### 3. Your own UI

`useAgent()` is the whole thing headless. `<AgentChat>` is written against this and nothing
more, so anything it does, your own component can do:

```tsx
const { items, status, send, approve, decline, open, modelStatus } = useAgent();
```

- `items` — the conversation: `user` | `assistant` | `result` | `proposal` | `error`
- `send(text)` — ask something
- `approve(id)` / `decline(id)` — answer a confirmation card
- `status` — `idle` | `thinking` | `streaming` | `awaiting-confirmation`

Keep `<AgentProvider>`: it owns the transport, conversation persistence, the pending
clarification and the client-action bridge. Replacing it means reimplementing those.

**Do not fork `AgentChat` to change colours or copy.** Levels 1 and 2 survive upgrades; a fork
does not.
