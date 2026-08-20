# @agent-runtime/react

React provider, chat UI, confirmation UI and hooks for the Agent Runtime.

The chat UI and React bindings: `<AgentProvider>`, `<AgentChat>`, conversation
history, streaming, confirmation cards, structured result rendering, and the on-device model
loader.

```tsx
<AgentProvider manifest={manifest} endpoint="/api/agent">
  <AgentChat title="Northwind Assistant" />
</AgentProvider>
```

Part of **[Agent Runtime for the Web](https://github.com/fil-technology/agent-runtime-for-the-web)** — operate an existing web application in
natural language. The application declares what the assistant may know and may do; the model
proposes actions, it never authorizes them.

Full documentation, architecture notes and the evaluation harness live in the
[repository](https://github.com/fil-technology/agent-runtime-for-the-web#readme).

## Install

```bash
npm install @agent-runtime/react
```

## License

MIT
