# Changelog

## 0.2.0

### Fixed

- **Every assistant message was dropped in React StrictMode** — so in any app running
  `next dev`, answers never appeared. The stream handler tracked "have I added the bubble
  yet?" with a closure flag set inside a `setItems` updater; React double-invokes updaters
  to catch exactly that, and the second run took the wrong branch. Reported from a real
  integration. It was invisible in production builds, which is how it shipped.
- **Retrieval returned nothing for questions its own corpus answered.** A term absent from
  the whole corpus carries the highest idf and can never be matched, so "what does magnitude
  6 actually mean?" was defeated by the word "actually". A second gate — a chunk must contain
  40% of the question's own words — keeps this from becoming permissive: without it, "what is
  X's stock price?" matched on "price" alone, and a question about next week's earthquake got
  answered from a safety leaflet. Eval 88.3% → 89.6%, both refusal cases held.
- **Context was blind-matched onto action inputs by field name.** An app's `role` (the
  signed-in user's) filled an invite's `role` (the invitee's), making every invitation an
  admin invitation. Only the `current*` convention and explicit `fillFromContext` fill inputs.
- **A confirmation card never left "Working…".** Confirming is a separate turn from proposing,
  so matching the outcome against *this turn's* proposals never matched, and the result
  rendered a second time as an anonymous card.
- **"When does my plan renew?" answered "Plan: team"** — the sentence names the `plan` field
  outright. The interrogative now constrains the answer's type.
- The `theme` prop reached only the closed launcher; the open panel never received it.
- The "Open →" affordance on a result row was `opacity: 0` until hover — invisible on touch.

### Added

- **`resolve`** — an action declares where the candidates for a missing argument come from.
  One candidate is used silently, several become buttons, none falls back to `clarify()`.
  This replaces answering *"open it from the sidebar and ask again"*.
- **Arguments are gathered one question at a time**, in schema order, until the action is
  complete or the user says "cancel". Enums offer their own choices without a resolver. A
  reply to a single-field question is read as the value rather than extracted from.
- **A minimum thinking phase** (`minThinkingMs`, default 450) so an answer that takes 5ms
  still reads as something worked out. It paces the display, never the work.
- **`theme="light" | "dark" | "system"`** — the panel can follow the host application instead
  of the operating system.
- **A mark, and unconditional attribution.** `<AgentChat>` always shows the runtime's mark and
  "Powered by Agent Runtime", linking to this repository. There is no prop to relabel, repoint
  or hide it.
- The panel was restyled: attributed turns with timestamps and an avatar, a centred empty
  state, a single rounded composer with a round send button.

### Changed

- **Breaking:** `AgentChatProps.poweredBy` was added and then removed within this release; if
  you set it, delete it. Attribution is not configurable.
- **Breaking:** `ChatItem` now carries `at: number`. Only affects code reading `items` directly.
- `inviteMember` in the SaaS demo no longer defaults `role`, and the eval expects a
  clarification for a bare email. What access someone gets is worth one question.
- The integration brief now states what the rule-based provider can and cannot do without a
  model: it routes and acts and answers lexically from knowledge; it does not explain or
  compare.

## 0.1.0

First release.

> **Note on this version's artifacts.** The `v0.1.0` release assets were rebuilt in place
> several times during early development, so that tag does **not** identify a single build.
> Releases from 0.2.0 onward are immutable: a fix means a new version, never a replaced file.
