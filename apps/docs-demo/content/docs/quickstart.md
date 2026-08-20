---
title: Quickstart
url: /docs/quickstart
---

# Quickstart

Install the packages and add three files to an existing Next.js application.

## Install

Add `@agent-runtime/core`, `@agent-runtime/react` and `@agent-runtime/next` to your app. The
core package has one dependency, zod, which you almost certainly already have.

## Define the agent

`defineAgent()` is the entire integration surface. It takes an identity, the knowledge you want
answers grounded in, a context resolver that says what the user is looking at, and the actions
the assistant is allowed to take.

## Add the route

`createAgentRoute()` turns the agent into a Next.js App Router handler. This is the only place
Next.js is mentioned in the whole runtime.

## Add the provider

Wrap your app in `AgentProvider` and drop in `AgentChat`. Any page can then publish what "this"
means with `useAgentPage()`.

Integration takes about ten minutes. Everything works with no API key: a deterministic
rule-based provider handles routing and extraction.
