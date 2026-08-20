# @agent-runtime/local

On-device model providers: the browser's built-in model and SmolLM2 via transformers.js.

On-device inference in the browser. Runs the reasoning loop in a Web Worker via
transformers.js, with the built-in browser model preferred when the user's browser has one and
self-hosted quantised weights as the fallback.

Part of **[Agent Runtime for the Web](https://github.com/fil-technology/agent-runtime-for-the-web)** — operate an existing web application in
natural language. The application declares what the assistant may know and may do; the model
proposes actions, it never authorizes them.

Full documentation, architecture notes and the evaluation harness live in the
[repository](https://github.com/fil-technology/agent-runtime-for-the-web#readme).

## Install

```bash
npm install @agent-runtime/local
```

## License

MIT
