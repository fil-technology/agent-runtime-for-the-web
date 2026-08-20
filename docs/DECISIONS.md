# Decisions

Ambiguities resolved during the MVP, with the reasoning. Each was taken as the simplest
reversible option consistent with the architecture rules.

### 1. The pipeline is staged, not one call

**Why.** A single decide-everything call forces a large model. Three small, constrained
questions (pick a label / fill a schema / rewrite facts) can each be served by a different tier,
which is what makes on-device inference realistic. Providers that are good at one shot can still
return `arguments` in the route stage, and the runtime skips the extraction call.

**Reversible.** Merge the stages behind a provider capability flag.

### 2. The action name is an enum, not a string

The route schema is rebuilt per request from the actions *this* user can currently reach. A
model that invents a capability fails validation and the router escalates, rather than the
runtime catching an unknown name afterwards.

Found by watching the browser's built-in model echo a prompt placeholder as an action name.

### 3. Confirmation is stateless

The proposal is echoed back by the client instead of being stored server-side. The server
re-validates and re-authorizes it from scratch, so the worst a forged proposal achieves is
something the user could already do. Avoids a session store in v0.1.

**Reversible.** Add a signed, expiring proposal id.

### 4. Context-bound fields beat model-supplied ones

When `fillFromContext` maps a field, the context value overwrites whatever the model proposed.
"Delete project ghi789" on project abc123's page cannot redirect the action.

The cost: a legitimate cross-resource request needs its own action with an explicit selector.
Worth it.

### 5. Grounding thresholds on coverage, not rank

Relevance scores are relative, so the best match always looks perfect. IDF-weighted coverage —
how much of the question's informative vocabulary the chunk contains — is scale-free and makes
"I don't have anything on that" actually reachable.

The first attempt used an absolute BM25 floor and broke on small corpora, where every score is
small. Corrected.

### 6. Vague input gets a question; specific input gets an honest refusal

"change it" → clarification. "Write me a poem about databases" → "that isn't something this
product knows about". The discriminator is whether the user supplied ≥2 content words, not
whether the sentence looks like a question.

### 7. Filesystem access is injected, never imported

Core stays isomorphic because the runtime can run in the browser. A dynamic `import("node:fs")`
inside core is still followed by bundlers, so `@agent-runtime/next` registers the docs loader
instead. `docs()` in a browser bundle produces an error that says exactly what to do.

### 8. `docs()` paths resolve against the working directory

Right for an app server, wrong for a tool loading two apps at once. Rather than add a second
path convention, `AgentRuntime` accepts a prebuilt retriever, which is what the eval harness
uses.

### 9. transformers.js is loaded at runtime, not bundled

Bundling it drags native ONNX bindings into the application build and breaks `next build`. It is
loaded from an ESM CDN in the browser (overridable) and from the installed package under Node.
The app bundle stays ~103 kB and pays nothing until someone opts in.

### 10. The default provider is rule-based, not a model

Every demo works with no key, no download, and no network. It is a genuine deterministic
baseline (88.2% of the eval suite) and the control in every model comparison — not a stub.

### 11. Local-first moves the confirmation gate into the browser

Documented as a trade-off rather than hidden. The server still validates, still refuses
`disabled`, and still authorizes; it trusts the client's claim that the user clicked confirm.
Server mode remains the default and the recommendation for destructive capabilities.

### 12. Structured output uses forced tool use on Anthropic

The installed SDK (0.68) predates `output_config.format` / `messages.parse`. A single forced
tool call whose input schema *is* the target schema is constrained by the API and works across
versions. `effort` is only sent when explicitly configured, so the request shape stays valid on
older API versions.

### 13. Schema validation is a routing gate, not a score

A provider's output that fails the schema is a *failed attempt*, not a low-confidence answer.
The router re-validates every structured result itself and escalates past failures, rather than
trusting a provider's self-reported confidence.

Found when the browser's built-in model returned a prompt placeholder with 0.99 confidence and
the router accepted it as "the best available".

### 14. An echoed prompt is not an answer

Small models sometimes restate the prompt instead of answering. The runtime detects substantial
verbatim overlap between the generated text and the prompt, discards it, and falls back to the
deterministic summary. Without this, a weak model leaks the runtime's internal instructions into
the product's UI.

Detected by a long verbatim window rather than a marker string, so it survives prompt rewording.

### 15. The inference worker is a Blob, not a bundled module

A bundler-emitted worker keeps its relative imports, which then 404 from wherever the asset
lands — and a worker that fails to load is indistinguishable from a model that is loading
slowly. The worker is now self-contained source built into a Blob URL, plus an `error` handler
and a load timeout so no provider can hang a turn.

### 16. A cold model never makes you wait

`ModelCapabilities.readyNow` separates "can serve eventually" from "can serve now", and the
router sorts by readiness before tier. A model with 200MB still to download is still the
preferred destination — it just doesn't get to hold up the current request. Whoever is warm
answers, and the model takes over on a later turn.

Spec §10 lists "local model loaded/cached" as a routing input; this is that input.

### 17. Don't pay a weak model to reword a sentence the developer already wrote

When an action returns a `summary` and the best available provider scores below 0.5 quality, the
explain stage is skipped entirely. The summary is deterministic, already correct, and written by
the person who knows the product.

### 18. The router benches providers that fail a stage

Static quality scores are guesses; runtime behaviour is evidence. A provider whose output is
rejected as a prompt echo is removed from that stage for the rest of the session. Chrome's
built-in model rates 0.6 and routes well, but echoes prompts when asked to explain — one wasted
round trip, then never again. Measured 2016ms → 1027ms on the second turn.

### 19. A failed extraction is a question, not a crash

When no provider can fill an action's schema, the runtime falls through to validation, which
turns the missing fields into "which event do you mean?". Errors the runtime recovered from are
marked `recoverable` and shown in the trace panel, never as a failure in the conversation.

Found by asking "tell me about this earthquake" on a list page, where no event is selected: it
surfaced a raw `NO_PROVIDER` developer error to the user.

### 20. A reply to the runtime's question resumes the same action

When a required argument cannot be filled, the turn returns a `PendingClarification` — the
action, what was already established, what is missing, and the question asked. The client echoes
it with the next message, and the runtime resumes that action instead of routing from scratch.
Without it, the assistant asks "which project?" and then treats your answer as an unrelated new
request.

Extraction now runs against a **partial** schema so a half-answer survives to inform the
question, rather than being discarded by strict validation.

Capped at two attempts: repeating a question verbatim reads as broken, so the second failure
says the answer did not land and defers to the application's own guidance.

### 21. Only the application knows how a user is meant to choose

`action({ clarify })` lets the app write the question. The runtime knows a field is missing; it
does not know that projects are picked from the sidebar or that tsunami messages are per event.

The demo initially promised "name the region — Japan, Iceland…" for an action that only accepts
a catalogue id. Guidance that promises what the action cannot do is worse than none.

### 22. A failed model load must say so

An on-device provider whose weights fail to load reports `available: false` with the reason,
instead of reporting "loading" forever.

This paid for itself immediately: the default model id `onnx-community/SmolLM2-360M-Instruct`
does not exist and returns **401**. The symptom was an eternal spinner. The real repos are under
`HuggingFaceTB/`, verified serving q4 ONNX weights (135M = 182MB).

### 23. A new intent supersedes a pending question

The first version of conversational repair attached the outstanding question to *every*
subsequent message, so after "which event do you mean?" the next three unrelated questions were
all resumed into the same action. The runtime now routes first: a message that clearly asks for
something else wins, and only an otherwise-unresolved message is treated as the answer.

Traced as `resume` or `resume.superseded`, so which one happened is visible.

### 24. Action results are rendered as elements, not prose

An action returns structured `data`; collapsing a list of four earthquakes into one sentence
throws that away. Auto actions that return data now render as rows in the chat, and the prose is
suppressed when it only restates them.

The renderer is deliberately generic — it picks a label field and shows the remaining primitives
as metadata. Per-type components would put product knowledge in the runtime, which is the one
thing this architecture is trying to avoid.

### 25. Conversations live on the device

The runtime is stateless and history travels with each request, so conversations are purely a
client concern: `createLocalConversationStore()` keeps them in localStorage, with no database, no
user table, and nothing leaving the browser. Pass your own `ConversationStore` to sync them.

A confirmation restored from storage comes back **expired** rather than clickable — consent is
given in a moment and about a page the user may have long since left.

### 26. Filler pronouns are stopwords

"and that one?" was matching any action whose examples contained the word "one". Words like
one/them/those read as content but carry no topic, so they are treated as stopwords in both
routing and retrieval.

### 27. A follow-up is answered from the data already fetched

"what depth?" is two words and matches no action name, so routing could never reach the action
that holds the answer — every follow-up fell back to the same summary sentence regardless of what
was asked.

Each turn now carries a `RecallState`: the last action's result, plus a signature of the context
it described. A follow-up is answered directly from that record — exact, grounded, no model, no
second call, and no side effects from re-running an action.

The signature is what makes it safe: navigate to a different earthquake and the carried record is
dropped rather than answering for the wrong one.

### 28. Field questions match on words, not search tokens

Retrieval strips "where", "when" and "how many" as stopwords, which is right for finding
documents and exactly wrong for "where is it?" — those words *are* the question. Field matching
uses plain words, splits camelCase (`feltReports` → "felt reports"), and understands a small set
of everyday synonyms (deep→depth, where→place, many→count).

Naming a field outright outranks matching a synonym, and ties go to the field declared first —
which is why "where is it?" answers with `place` rather than `region`.

### 29. A bounded gathering loop, not an autonomous agent

`maxSteps` (default 1) lets a turn run more than one lookup when a question needs it — "tell me
about this earthquake **and** is there a tsunami warning?" is two questions.

Rule 8 says not to build autonomous-agent infrastructure until the MVP demonstrates a need. The
need showed up in real use, so this is the smallest thing that meets it. What keeps it a
gathering loop rather than an agent:

- **A hard ceiling.** `maxSteps` is clamped to 5, and defaults to 1 — chaining is opted into.
- **Only safe reads chain.** A `confirm` action ends the turn with a proposal; a client action
  hands back to the browser. Neither is ever "stepped through".
- **No new capabilities.** Each step routes over the same permission-filtered surface.
- **A repeat guard.** The same action with the same arguments twice is a loop, not progress.
- **No goals of its own.** Steps only ever answer the user's message.

Every step is traced (`route.step2`, `gather.stop`), and three tests pin the invariants: chaining
works, a confirm action still stops the loop, and a stuck router is cut off after one retry.

### 30. A keyword router only continues on evidence of a compound request

The deterministic provider cannot tell whether a question has been answered, so with chaining
enabled it happily ran a second, unwanted action — the eval fell from 88.2% to 78.9%. It now
continues only when the message actually contains "and"/"also"/"both" *and* the next action
matches strongly. Back to 88.2%.

A real model gets the gathered results in its prompt and decides properly; the rule-based
provider gets a conservative heuristic, because guessing here means running actions nobody asked
for.

### 31. The AI SDK supplies models; it does not supply the runtime

`createAiSdkProvider({ model })` implements `ModelProvider` over the Vercel AI SDK, so any of its
25+ vendors works without another adapter, and `generateObject` constrains the model with the
*same* zod schema the runtime validates with — one representation, no drift.

What is deliberately **not** adopted:

- **`HarnessAgent` / the AI SDK agent loop.** It runs tools itself, with `permissionMode` and a
  `toolApproval` map. Handing it our loop would make the deterministic permission engine a
  callback inside someone else's control flow, and Rules 3 and 5 — the model never owns
  authorization, consequential actions require deterministic policy — are the product. Spec §12
  already says an agent executor should be an optional adapter, not foundational. That is the
  slot `HarnessAgent` fits: long-running and durable work, later.
- **AI SDK UI (`useChat`).** It assumes its own message and stream protocol. Ours carries
  proposals, pending clarifications, recall and traces — precisely the parts that are not
  chat-shaped. An adapter for teams already on `useChat` is a reasonable future addition.

### 32. shadcn/ui belongs in applications, not in this package

shadcn is copy-paste components on Tailwind and Radix. That is an excellent choice for an
application and the wrong one for a library that must drop into an app it does not control —
it would make Tailwind a requirement of adopting the runtime.

The chat UI stays dependency-free and themed through CSS variables, and `useAgent()` stays
headless so any design system can be built on it. The Vercel AI Chatbot template is a *starter
application* (Auth.js, Postgres, Blob storage) — useful to mine for UX, structurally the
opposite of a drop-in runtime.

### 33. Grounded answers quote the facts — that is not an echo

The echo guard compared the answer against the whole prompt, and the FACTS block *is* in the
prompt. A correctly grounded answer therefore looked like an echo, and the provider was benched
for the answer stage — permanently, process-wide — after which every reply fell back to raw
documentation text.

Two fixes: the comparison now excludes the facts and looks only at the instructions, and a
provider is never benched when it is the only candidate for that stage. Disabling the last
provider is worse than one poor answer.

### 34. Explanatory questions are never answered with a field

"why was it felt so far away?" contains "felt", which is also a field name, so it was answered
with `Felt reports: 4210`. That is not a near miss — it is a different question. Anything
matching why / how does / explain / what causes skips field lookup entirely and goes to
documentation.

### 35. The transcript scrolls because a flex child needs `min-height: 0`

Without it a flex child grows to fit its content instead of scrolling, so the message list
overflowed its panel and the newest message was unreachable.

Auto-follow is instant rather than smooth: `scrollTo({behavior:"smooth"})` **and** CSS
`scroll-behavior: smooth` both silently fail to move the container in some embedded contexts,
which loses the newest message. It also only follows when the reader is already within 140px of
the bottom — yanking someone back down mid-read is worse than not following.

### 36. Every grounded answer can name its source

The runtime knows exactly which chunks it used, so an answer can point at the page it came from
and offer to open it. That turns a claim into something the reader can check, and gives them the
obvious next step.

Sources are emitted as their own event before the text, so the UI can show provenance without
waiting for the answer to finish. `docs()` frontmatter carries the `url`, so the card links into
the app's own router rather than reloading the page.

### 37. A turn must never render nothing

An action that returned an empty array rendered no element card, and the prose was suppressed
because it "restated the elements" — leaving a completely blank turn that read as a hang. Prose
is only suppressed when elements were actually rendered.

### 38. A list on screen is still an answerable record set

"what is Coastal Sensors id?" names which row it means, so the runtime reads that row from the
list it already fetched instead of searching again.

Rows are scored by how much of the row the question *names*, not by what fraction of the row is
repeated — scoring by fraction punished records for carrying more fields, which has nothing to do
with whether they are the one being asked about. A tie means the question did not single out a
row, and guessing between two records is worse than searching properly.

### 39. A safe browser action is offered, not performed

Navigating someone away from what they were reading, without being asked to, is startling even
when the destination is right. `autoRunClientActions` defaults to **false**: the action appears
as a card with a single button.

It is deliberately not styled as a confirmation. A confirmation asks you to take responsibility
for a consequence; an offer just saves you a click, so it gets one button and no "are you sure"
framing.

### 40. A record that knows where it lives becomes a link

Action results routinely carry a `url` — an invoice, a project, a documentation page. Rendering
those rows as links turns an answer into a way of getting there, with no extra work from the
application beyond returning the field it already had.

### 41. Content fields are literal, not search queries

"add a note - hello how are you" was producing a note that said "new hello", because a free-text
field was being processed like a search query and having its "noise" stripped. Fields named
text/content/body/message/title take what the user actually dictated: a quoted string, or
everything after a dash or colon.

### 42. zod is a peer dependency, and both major versions are supported

Installing the tarball into a clean project failed immediately: `npm install zod` gives **zod 4**,
and the schema introspection was written against zod 3 internals (`_def.typeName`). Zod 4 uses
`def.type` with different shapes for enums, arrays and unions.

zod is now a `peerDependency` (`^3.23 || ^4`), so the application's own copy is used rather than
a second one bundled underneath, and every read of a schema goes through a small compatibility
layer. Verified end to end from a packed tarball against zod 3.25 and zod 4.4.

Core now has **no runtime dependencies at all**.

This is the bug that only a real install finds. Everything passed inside the monorepo, where
zod 3 was hoisted.

### 43. Actions can call anything, and the hazard demo now proves it

`getLiveEvents` fetches the real USGS feed over the network. Nothing else changes: the same
permission evaluation, the same grounding, the same trace. The runtime never makes the request
and never sees the endpoint — an action is just your code.

### 44. The sentence is the answer; elements are supplementary

Suppressing prose "because the elements already said it" was hiding the actual answer. Asking
"is there an official tsunami warning?" produced a field dump — level, event id, agency — and no
sentence, which reads as the assistant failing to reply.

Prose is now suppressed only for a genuine list enumeration (an array of more than one row whose
summary lists those rows). For a single record the sentence *is* the answer.

### 45. Cite documentation only when documentation answered

Sources were emitted whenever retrieval found anything, so "how many felt reports?" — answered
from an action result — carried an unrelated "FROM THE DOCS · Magnitude, intensity and depth"
card. When an action supplied the facts, the action is the source; citing a page beside it is
noise at best and misleading at worst.

### 46. Eve is not in the public API

A durable operation is still just an action. An executor can back one later without appearing in
`defineAgent()`.

## Known limitations

- **Chaining is read-only and shallow.** Up to `maxSteps` safe lookups per turn; writes always
  stop for confirmation, so "rename it and then show me my projects" still does one thing.
- **The rule-based provider routes on keywords.** Its nine eval failures are documentation
  questions that look like action requests. Adding a model is the fix.
- **`visibleActions` calls permission resolvers with an empty input** to filter the surface, so
  a resolver that inspects `input` must tolerate `{}`. It is re-evaluated authoritatively before
  execution.
- **Knowledge is reloaded per process, not watched.** Editing docs needs a restart.
- **SmolLM2-135M is too weak for this runtime.** Measured on-device: it routes at ~0.15
  confidence and cannot reliably pick an action from a five-item list. 360M is the realistic
  floor; the 135M profile exists to document that.
- **Streaming is per-stage.** Tokens stream from the explain stage only; earlier stages report
  as trace events.
- **A missing argument is a question with answers, not a redirect.** `resolve` lets the
  application enumerate the candidates; one is used silently, several become buttons. Telling
  the user to go and navigate somewhere was the assistant failing at the one thing it is for.
- **Choices travel on the pending clarification and are matched by label.** The runtime stays
  stateless, and clicking a choice is literally the same request as typing its name — there is
  no second, privileged path into the runtime that the typed path does not get.
- **A dead-end retry must match better than the choice it replaces.** Falling through to any
  action that merely accepts the available arguments answered "tell me about this earthquake"
  with a tsunami status. Confidence below the replaced choice means ask, not substitute.
- **Context is never blind-matched onto action inputs by field name.** An app's `role` (the
  signed-in user's) silently filled an invite's `role` (the invitee's), making every invitation
  an admin invitation. Only the `current*` convention and explicit `fillFromContext` fill inputs.
- **The interrogative constrains which field answers.** "When does my plan renew" names `plan`
  outright; the question word is what makes `renewsAt` the answer.
- **Arguments are gathered one question at a time.** A form asks for one field at a
  time; a conversation has no excuse to be worse. Clarify attempts count repeats of
  the same gap, not questions in the conversation, or a three-argument action could
  never be completed.
- **An enum states its own choices.** Requiring `resolve` for a field that already
  lists its values would be the application repeating itself.
- **A reply to a one-field question is read as the value, not extracted from.**
  Asking a model to find "EarthWatch" inside "EarthWatch" is slower and less
  reliable than reading it. Restricted to authored fields: an id is chosen from what
  exists, so free text is never stored as one.
- **A message spent answering one question is not mined for the next.** Choosing
  "Coastal Sensors" and then taking "Sensors" from the same two words as its new
  name is the failure this prevents.
- **No capability-switching mid-clarification.** The dead-end retry is for a fresh
  request that picked the wrong action, not for a user part-way through answering.
- **An enum value that appears in only one of an action's examples is incidental
  vocabulary.** "add a new member to my team" is how you *ask* for inviteMember, so
  "member" there is not a choice of role — but navigate's examples name several
  destinations, which is the enum being taught. One value mentioned means prose;
  several mean demonstration.
- **State updaters must be pure — verify the UI in `next dev`, not `next start`.** React
  double-invokes `setState` updaters under StrictMode to catch impure ones. An updater that set
  a closure flag ("have I added the bubble yet?") took the wrong branch on the second run and
  silently dropped every assistant message. It was invisible in a production build, which is how
  it shipped. Existence is now read from the state passed in, never from a flag.
- **An affordance hidden behind `:hover` does not exist on a phone.** The "Open →" link on a
  result row was `opacity: 0` until hover — on touch there is no hover, so the row looked inert.
