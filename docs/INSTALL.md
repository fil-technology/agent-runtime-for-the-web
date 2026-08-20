# Installing into an existing application

**Status: not published.** These packages are not on npm and this is not a git repository yet.
Everything below works today from local tarballs; the npm path is what to do once you publish.

Verified by installing the tarballs into a clean project and running the runtime, against both
zod 3.25 and zod 4.4.

## 1. Build the tarballs

```bash
pnpm install && pnpm build
mkdir -p /tmp/agent-runtime
for p in core react next local cloud; do
  (cd packages/$p && pnpm pack --pack-destination /tmp/agent-runtime)
done
```

`pnpm pack` rewrites the internal `workspace:*` links to real versions, so the tarballs install
correctly outside this monorepo.

## 2. Install them in your app

```bash
pnpm add /tmp/agent-runtime/agent-runtime-core-0.1.0.tgz \
         /tmp/agent-runtime/agent-runtime-react-0.1.0.tgz \
         /tmp/agent-runtime/agent-runtime-next-0.1.0.tgz
```

Optional tiers:

```bash
pnpm add /tmp/agent-runtime/agent-runtime-cloud-0.1.0.tgz   # AI SDK, Anthropic, OpenAI-compatible
pnpm add /tmp/agent-runtime/agent-runtime-local-0.1.0.tgz   # on-device models
```

### Peer dependencies

| Package | Needs |
| --- | --- |
| `core` | `zod` ^3.23 **or** ^4 |
| `react` | `react` 18 or 19 |
| `cloud` | one of `ai`, `@anthropic-ai/sdk`, or nothing (the OpenAI-compatible provider uses `fetch`) |
| `local` | nothing — transformers.js is fetched at runtime, only if you enable on-device inference |

Nothing else is required. `core` has **no runtime dependencies** beyond your own zod.

## 3. Three files in your app

```ts
// lib/agent.ts
import { z } from "zod";
import { action, clientAction, defineAgent, docs } from "@agent-runtime/core";
import { getEvent, listEvents } from "./your-existing-data-layer";

export const agent = defineAgent({
  identity: "Your Product",
  knowledge: [docs("./content/docs")],

  context: ({ user, page }) => ({
    userId: user?.id,
    currentEventId: page.eventId,
  }),

  actions: {
    getEvent: action({
      description: "Get an event's measured details",
      permission: "auto",
      input: z.object({ eventId: z.string() }),
      fillFromContext: { eventId: "currentEventId" },
      execute: async (input) => ({
        summary: `M${(await getEvent(input.eventId)).magnitude}`,
        data: await getEvent(input.eventId),
      }),
    }),
  },
});
```

```ts
// app/api/agent/route.ts
import { createAgentRoute } from "@agent-runtime/next";
import { createFakeProvider } from "@agent-runtime/core";
import { agent } from "@/lib/agent";

export const { POST, GET } = createAgentRoute({
  agent,
  providers: () => [createFakeProvider()],
  session: async (request) => ({ user: await getUserFromRequest(request) }),
});
```

```tsx
// app/layout.tsx (client component wrapper)
"use client";
import { AgentChat, AgentProvider } from "@agent-runtime/react";

export function Shell({ children }) {
  const pathname = usePathname();
  const router = useRouter();
  return (
    <AgentProvider page={{ route: pathname }} onNavigate={(p) => router.push(p)}>
      {children}
      <AgentChat title="Your Product" />
    </AgentProvider>
  );
}
```

Then publish page state wherever "this" means something:

```tsx
useAgentPage({ eventId: event.id, eventPlace: event.place });
```

## 4. Add a model when you want one

Nothing above needs an API key — the deterministic provider handles routing and extraction, and
answers come from your documentation and action results. To add a model:

```bash
pnpm add ai @ai-sdk/anthropic
```

```ts
import { createAiSdkProvider } from "@agent-runtime/cloud";
import { anthropic } from "@ai-sdk/anthropic";

providers: () => [
  createFakeProvider(),
  createAiSdkProvider({ model: anthropic("claude-opus-5") }),
],
```

## Publishing to npm later

The packages already carry `license`, `description`, `files` and `publishConfig.access`. Before
publishing you need to:

1. Set a real `repository.url` in each `packages/*/package.json` (currently a placeholder).
2. Decide whether `@agent-runtime` is a scope you control on npm, or rename.
3. `git init` and commit — the packages reference a repository that does not exist yet.
4. `pnpm -r publish --access public`.

## What is not ready

- **No CI.** Nothing runs `pnpm verify` automatically.
- **No versioning or changelog.** Everything is 0.1.0.
- **The React package ships one opinionated component.** `useAgent()` is headless if you want
  your own; see the notes on shadcn in DECISIONS.md.
- **`docs()` resolves paths against the working directory.** Correct for a Next.js server;
  supply a prebuilt retriever if you need otherwise.
