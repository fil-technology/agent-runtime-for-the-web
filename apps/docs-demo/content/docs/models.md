---
title: Models and routing
url: /docs/models
---

# Models and routing

The model is an implementation detail. Nothing above the `ModelProvider` interface names a model
family.

## Routing order

A model the browser already ships costs no download, so it is preferred over one the runtime
would have to fetch. On-device models come next. Cloud is last: it is a capability, not a
dependency.

## Readiness

A model with weights still downloading is available but not ready. The router routes around it
so the first message is never blocked, and picks it up once it is warm.

## Escalation

Escalation happens on unavailability, on failure, or on self-reported confidence below the
threshold. A provider whose output fails the schema is treated as a failed attempt, not a
low-confidence answer.

## Providers

The Vercel AI SDK adapter reaches 25+ vendors. There is also a direct Anthropic provider, an
adapter for any OpenAI-compatible endpoint, and a server proxy so a browser-side loop can
escalate to the cloud without ever holding an API key.
