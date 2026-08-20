# @agent-runtime/cloud

Cloud model providers: Vercel AI SDK, Anthropic, OpenAI-compatible endpoints and a server proxy.

Cloud model access behind the same provider interface, over the Vercel AI SDK —
so any AI SDK model works, and the runtime treats cloud as a fallback tier rather than a
requirement.

Part of **[Agent Runtime for the Web](https://github.com/fil-technology/agent-runtime-for-the-web)** — operate an existing web application in
natural language. The application declares what the assistant may know and may do; the model
proposes actions, it never authorizes them.

Full documentation, architecture notes and the evaluation harness live in the
[repository](https://github.com/fil-technology/agent-runtime-for-the-web#readme).

## Install

```bash
npm install @agent-runtime/cloud
```

## License

MIT
