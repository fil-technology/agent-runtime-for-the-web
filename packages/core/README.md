# @agent-runtime/core

Framework-independent runtime: agent definitions, permissions, retrieval, model routing.

The framework-independent runtime. Agent definitions, the permission engine,
lexical retrieval, model routing, and the staged pipeline that turns a sentence into a
proposed action.

Isomorphic — no Node built-ins — so the same runtime works on a server, in an edge function,
or in the browser.

```ts
import { defineAgent, action } from "@agent-runtime/core";
import { z } from "zod";

export const agent = defineAgent({
  identity: "Northwind Assistant",
  actions: {
    getSubscription: action({
      description: "Get the current plan, seat count and renewal date",
      permission: "auto",
      input: z.object({}),
      execute: async () => ({ summary: "team plan, renews 2026-09-14" }),
    }),
  },
});
```

Part of **[Agent Runtime for the Web](https://github.com/fil-technology/agent-runtime-for-the-web)** — operate an existing web application in
natural language. The application declares what the assistant may know and may do; the model
proposes actions, it never authorizes them.

Full documentation, architecture notes and the evaluation harness live in the
[repository](https://github.com/fil-technology/agent-runtime-for-the-web#readme).

## Install

```bash
npm install @agent-runtime/core
```

## License

MIT
