---
title: Context
url: /docs/context
---

# Context

Context is how the application tells the assistant what the user is looking at. The runtime
never inspects the DOM to discover facts the application already knows.

## Publishing page state

Call `useAgentPage()` from a route segment with whatever is semantically true of that page — the
project id, the selected event, the current route. The keys are cleared automatically when the
component unmounts, so stale context cannot make "this" resolve to something you have navigated
away from.

## Filling arguments from context

An action can map an input field to a context key with `fillFromContext`. Those fields are
authoritative: the model cannot redirect an action at a different resource by proposing a
different id.

This is what turns "rename this project to EarthWatch" into a validated, permission-checked call
with the project id coming from the page.
