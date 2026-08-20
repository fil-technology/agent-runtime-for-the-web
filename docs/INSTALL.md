# Installing into an existing application

**Status: released on GitHub, not yet on npm.** Install from the
[v0.2.0 release tarballs](https://github.com/fil-technology/agent-runtime-for-the-web/releases/tag/v0.2.0).

Verified by installing into a clean project and running the runtime — from the release URLs and
from local tarballs, against both zod 3.25 and zod 4.4.

## 1. Install

```bash
pnpm add https://github.com/fil-technology/agent-runtime-for-the-web/releases/download/v0.2.0/agent-runtime-core-0.2.0.tgz \
         https://github.com/fil-technology/agent-runtime-for-the-web/releases/download/v0.2.0/agent-runtime-react-0.2.0.tgz \
         https://github.com/fil-technology/agent-runtime-for-the-web/releases/download/v0.2.0/agent-runtime-next-0.2.0.tgz
```

Install them **in one command**. They depend on each other by version, so adding them one at a
time sends the package manager to the npm registry for `@agent-runtime/core@0.2.0`, which is not
published yet.

Installing the repository directly (`github:fil-technology/agent-runtime-for-the-web`) does not
work — it is a monorepo whose build output is not committed.

### Building the tarballs yourself

```bash
pnpm install && pnpm pack:all      # writes ./dist-packages/*.tgz
```

`pnpm pack` rewrites the internal `workspace:*` links to real versions, so the tarballs install
correctly outside this monorepo.

## 2. Optional tiers

```bash
pnpm add https://github.com/fil-technology/agent-runtime-for-the-web/releases/download/v0.2.0/agent-runtime-cloud-0.2.0.tgz   # AI SDK, Anthropic, OpenAI-compatible
pnpm add https://github.com/fil-technology/agent-runtime-for-the-web/releases/download/v0.2.0/agent-runtime-local-0.2.0.tgz   # on-device models
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
3. `pnpm release` — runs `pnpm verify`, then publishes all five with `--access public`.

## What is not ready

- **No CI.** Nothing runs `pnpm verify` automatically.
- **Releases are immutable from 0.2.0 onward.** A fix means a new version, never a rebuilt
  file at an existing URL. The `v0.1.0` assets were replaced in place several times during
  early development and do not identify a single build; [CHANGELOG.md](../CHANGELOG.md)
  records what each version contains.
- **The React package ships one opinionated component.** `useAgent()` is headless if you want
  your own; see the notes on shadcn in DECISIONS.md.
- **`docs()` resolves paths against the working directory.** Correct for a Next.js server;
  supply a prebuilt retriever if you need otherwise.
