# @agent-runtime/next

Next.js App Router integration for the Agent Runtime.

Next.js integration: a route handler for the App Router, and the filesystem docs
loader the isomorphic core deliberately does not depend on.

```ts
// app/api/agent/route.ts
import { createAgentRoute } from "@agent-runtime/next";
import { agent } from "@/lib/agent";

export const { POST } = createAgentRoute({ agent });
```

Part of **[Agent Runtime for the Web](https://github.com/fil-technology/agent-runtime-for-the-web)** — operate an existing web application in
natural language. The application declares what the assistant may know and may do; the model
proposes actions, it never authorizes them.

Full documentation, architecture notes and the evaluation harness live in the
[repository](https://github.com/fil-technology/agent-runtime-for-the-web#readme).

## Install

```bash
npm install @agent-runtime/next
```

## License

MIT
