import type { ZodTypeAny } from "zod";
import type {
  ActionDefinition,
  ActionExecutionContext,
  Choice,
  Agent,
  AgentContext,
  ChatMessage,
  JsonObject,
  JsonValue,
  PageState,
  RetrievedChunk,
  SessionState,
} from "../types.js";
import type { ModelProvider, ModelTask } from "../model/types.js";
import { ModelRouter } from "../model/router.js";
import type { Retriever } from "../knowledge/index.js";
import { buildRetriever } from "../knowledge/index.js";
import { evaluatePermission, visibleActions } from "../permissions.js";
import {
  objectFields,
  isOptional,
  schemaTypeName,
  fieldSchema,
  fieldEnumValues,
} from "../schema.js";
import {
  AgentError,
  confirmationRequiredError,
  invalidActionInputError,
  unknownActionError,
} from "../errors.js";
import {
  buildFacts,
  explainPrompt,
  extractPrompt,
  routePrompt,
  type PromptParts,
} from "../model/prompt.js";
import { answerFromFields } from "./fields.js";
import {
  agentDecisionSchema,
  newId,
  type ActionOutcome,
  type ActionProposal,
  type AgentEvent,
  type AgentTurn,
  type AgentDecision,
  type PendingClarification,
  type AnswerSource,
  type RecallState,
  type RuntimeRequest,
  type StageTrace,
  type Trace,
} from "./protocol.js";

export interface RuntimeOptions {
  agent: Agent;
  providers: ModelProvider[];
  /** Pre-built retriever. Otherwise built from agent.knowledge on first use. */
  retriever?: Retriever;
  /** Attach provider capabilities to every trace. Development only. */
  debug?: boolean;
  onTrace?: (trace: Trace) => void;
}

export interface CallOptions {
  /** Server-resolved session. Never taken from the client payload. */
  session?: SessionState;
  signal?: AbortSignal;
}

const MAX_KNOWLEDGE_CHUNKS = 4;
/** Relative to the best match in the same result set. */
const MIN_RELATIVE_SCORE = 0.35;
/**
 * Fraction of the question's content words a chunk must actually contain.
 * Without it the best match always scores 1.0 relative to itself and "we have
 * nothing on that" becomes unreachable — which is the case grounded answering
 * depends on most.
 */
const MIN_COVERAGE = 0.34;
/**
 * Model quality below which a deterministic, developer-authored summary is
 * preferred over asking the model to rephrase it.
 */
const WORTH_REWORDING = 0.5;
/** Ask at most this many times before handing the problem back plainly. */
/**
 * How many times the *same* gap may be asked about before giving up.
 *
 * Counted per gap, not per conversation: filling in one field and being asked
 * about the next is progress, not repetition, so a three-field action can be
 * completed one answer at a time.
 */
const MAX_CLARIFY_ATTEMPTS = 2;
/** How sure a route must be to override an answer to an outstanding question. */
const RETRY_CONFIDENCE = 0.7;
/** Ways of saying "stop". */
const CANCELLED = /^\s*(cancel|nevermind|never mind|stop|forget it|no thanks|abort|drop it)\b/i;


/**
 * The execution loop.
 *
 *   message
 *     -> context          (application supplied truth)
 *     -> retrieval        (deterministic, lexical)
 *     -> route            (model, constrained to a capability list)
 *     -> arguments        (model, constrained to a schema)
 *     -> validation       (zod)
 *     -> permission       (deterministic application policy)
 *     -> confirmation     (structured UI, never prose)
 *     -> execute          (application code, normal authorization)
 *     -> explain          (model, grounded strictly in supplied facts)
 */
export class AgentRuntime {
  private readonly router: ModelRouter;
  private retrieverPromise?: Promise<Retriever>;
  private tierCache?: Map<string, string>;

  constructor(private readonly options: RuntimeOptions) {
    this.router = new ModelRouter(options.providers, options.agent.models);
    if (options.retriever) this.retrieverPromise = Promise.resolve(options.retriever);
  }

  static async create(options: RuntimeOptions): Promise<AgentRuntime> {
    const runtime = new AgentRuntime(options);
    await runtime.retriever();
    return runtime;
  }

  get agent(): Agent {
    return this.options.agent;
  }

  private retriever(): Promise<Retriever> {
    this.retrieverPromise ??= buildRetriever(this.options.agent.knowledge ?? []);
    return this.retrieverPromise;
  }

  async handle(request: RuntimeRequest, call: CallOptions = {}): Promise<AgentTurn> {
    let answer: string | undefined;
    let proposal: ActionProposal | undefined;
    let pending: PendingClarification | undefined;
    let recall: RecallState | undefined;
    let sources: AnswerSource[] | undefined;
    let error: AgentTurn["error"];
    const outcomes: ActionOutcome[] = [];
    let trace: Trace | undefined;

    for await (const event of this.stream(request, call)) {
      if (event.type === "answer") answer = event.text;
      else if (event.type === "proposal") proposal = event.proposal;
      else if (event.type === "pending") pending = event.pending;
      else if (event.type === "recall") recall = event.recall;
      else if (event.type === "sources") sources = event.sources;
      else if (event.type === "outcome") outcomes.push(event.outcome);
      else if (event.type === "error") error = event.error;
      else if (event.type === "trace") trace = event.trace;
    }

    return {
      requestId: trace?.requestId ?? "unknown",
      answer,
      pending,
      recall,
      sources,
      proposal,
      outcomes,
      error,
      trace: trace!,
    };
  }

  async *stream(request: RuntimeRequest, call: CallOptions = {}): AsyncGenerator<AgentEvent> {
    const startedAt = now();
    const requestId = request.requestId ?? newId("req");
    const session: SessionState = call.session ?? {};
    const user = (session.user ?? null) as JsonObject | null;
    const history: ChatMessage[] = request.history ?? [];
    const message = request.kind === "execute" ? `execute:${request.action}` : request.message;

    const trace: Trace = {
      requestId,
      message,
      context: {},
      knowledge: [],
      visibleActions: [],
      stages: [],
      outcomes: [],
      cloudFallbackUsed: false,
      ms: 0,
    };

    const finish = async function* (this: AgentRuntime): AsyncGenerator<AgentEvent> {
      trace.ms = now() - startedAt;
      if (this.options.debug) trace.providers = await this.router.describe();
      this.options.onTrace?.(trace);
      yield { type: "trace", trace };
      yield { type: "done" };
    }.bind(this);

    try {
      const context = await this.resolveContext(request.page ?? {}, session, user);
      trace.context = context;

      const parts: PromptParts = {
        identity: this.agent.identity,
        instructions: this.agent.instructions,
        context,
        knowledge: [],
        history,
        message,
      };

      const available = visibleActions(this.agent.actionList, { context, user });
      trace.visibleActions = available.map((a) => a.name);

      /* ------------------------- direct execution --------------------------- */

      if (request.kind === "execute") {
        const outcome = yield* this.runDirectExecution(
          request,
          { context, user, session, requestId, signal: call.signal },
          available,
          trace
        );
        if (outcome) trace.outcomes.push(outcome);
        yield* finish();
        return;
      }

      /* ---------------- resumed turns: confirm / client result --------------- */

      if (request.kind === "confirm") {
        if (!request.approved) {
          const text = "Cancelled — nothing was changed.";
          trace.stages.push({ stage: "cancelled", ms: 0, note: "user declined proposal" });
          yield { type: "answer", text };
          yield* finish();
          return;
        }
        const outcome = yield* this.runConfirmedProposal(
          request.proposal,
          { context, user, session, requestId, signal: call.signal },
          available,
          trace
        );
        if (outcome) trace.outcomes.push(outcome);
        yield* this.answerStage(parts, context, [], trace.outcomes, trace);
        yield* finish();
        return;
      }

      if (request.kind === "client-result") {
        const outcome: ActionOutcome = {
          proposalId: request.proposal.id,
          action: request.proposal.action,
          side: "client",
          ok: request.ok,
          ...(request.result !== undefined ? { data: request.result } : {}),
          ...(request.error ? { error: { code: "CLIENT_ACTION_FAILED", message: request.error } } : {}),
          summary: request.ok
            ? request.proposal.description
            : `Could not complete: ${request.proposal.description}`,
          ms: 0,
        };
        trace.outcomes.push(outcome);
        yield { type: "outcome", outcome };
        const knowledge = await this.retrieve(message, trace);
        yield* this.answerStage(parts, context, knowledge, trace.outcomes, trace);
        yield* finish();
        return;
      }

      /* --------------------- follow-up from carried data -------------------- */

      const contextSignature = JSON.stringify(context);
      const recall = request.kind === "message" ? request.recall : undefined;

      if (recall && recall.contextSignature === contextSignature) {
        const field = answerFromFields(message, recall.data);
        if (field) {
          trace.stages.push({
            stage: "answer.recall",
            ms: 0,
            note: `${field.field} from the previous ${recall.action} result`,
          });
          trace.decision = "answer";
          yield { type: "recall", recall };
          yield { type: "answer", text: `${field.label}: ${field.value}` };
          yield* finish();
          return;
        }
      }

      /* ------------------------------ retrieval ----------------------------- */

      yield { type: "stage", stage: "retrieval" };
      const knowledge = await this.retrieve(message, trace);
      parts.knowledge = knowledge;

      /* -------------------------------- route ------------------------------- */

      // A reply to our own question is not a new request — but a new request
      // is not a reply either. Route first: a message that clearly asks for
      // something else wins, and only an otherwise-unresolved message is
      // treated as the answer to the outstanding question.
      const offered = request.kind === "message" ? request.pending : undefined;

      // Gathering loop. Each pass may run one safe action; anything needing a
      // decision from the user ends the turn immediately.
      const gathered: ActionOutcome[] = [];
      const attempted = new Set<string>();
      // Set when a chosen action turned out to be uncompletable, so the next
      // pass replaces it rather than trying to add to it.
      let retrying = false;
      let deadEnds = 0;
      // The question we would have asked, held back while another capability
      // is tried. If the retry finds nothing better, this is what gets asked.
      let heldQuestion:
        | {
            action: ActionDefinition;
            missing: string[];
            known: Record<string, unknown>;
            text: string;
            error: AgentError;
            /** How well the dead-ended choice matched, as the bar to beat. */
            confidence: number;
            options?: { field: string; choices: Choice[] };
          }
        | undefined;
      let lastConfidence = 0;

      // The bound is on *gathering* passes. Replacing a choice that turned out
      // to be uncompletable is not gathering, so it gets its own allowance —
      // otherwise a single-step agent can never recover from a dead end.
      for (let step = 1; step <= this.agent.maxSteps + deadEnds; step++) {
      const wasRetry = retrying;
      const { decision: routed, confidence } = yield* this.routeStage(
        parts,
        available,
        knowledge,
        trace,
        gathered,
        attempted,
        retrying
      );
      retrying = false;

      // A replacement must match *better* than the choice it replaces.
      // Answering a question about an earthquake's details with its tsunami
      // status, merely because nothing better remained, is worse than
      // admitting we need to know which earthquake.
      const weakReplacement =
        wasRetry &&
        routed.type === "action" &&
        heldQuestion !== undefined &&
        confidence < heldQuestion.confidence;
      lastConfidence = confidence;

      // Naming one of the choices we offered is an answer, however much it
      // also looks like a fresh request. "Seismic Watch" routes to a project
      // search on its own; as a reply to "which project?" it is not one.
      // "Cancel" is an answer too. Without this the question just gets asked
      // again, and the only way out is to say something unrelated enough to
      // supersede it.
      if (offered && step === 1 && CANCELLED.test(parts.message)) {
        trace.decision = "clarification";
        trace.stages.push({
          stage: "clarify.cancelled",
          ms: 0,
          note: `dropped the outstanding ${offered.action} question`,
        });
        yield { type: "answer", text: "Cancelled — nothing was changed." };
        yield* finish();
        return;
      }

      const namedChoice = offered?.options
        ? matchChoice(parts.message, offered.options.choices)
        : undefined;

      // Answering a question about a single field. "EarthWatch" is not a
      // sentence to extract from — it is the answer. It also routes like a
      // fresh request, which is why this is decided before that question is.
      let answeredGap: { field: string; value: string | number | boolean } | undefined;
      if (offered && !offered.options && offered.missing.length === 1) {
        const field = offered.missing[0]!;
        const target = available.find((a) => a.name === offered.action);
        // Fields the user *authors* only. An id is chosen from what exists —
        // "the one in staging" is a description of a project, not its id.
        const authored =
          target !== undefined && !/id$/i.test(field) && !target.resolve?.[field];
        const value = authored
          ? literalAnswer(parts.message, target!.input as ZodTypeAny, field)
          : undefined;
        // ...unless the reply is plainly a request for something else.
        // "show my invoices" is three words and would otherwise become the
        // new project name.
        const divertedElsewhere =
          routed.type === "action" &&
          routed.action !== offered.action &&
          confidence >= RETRY_CONFIDENCE;
        if (value !== undefined && offered.known[field] === undefined && !divertedElsewhere) {
          answeredGap = { field, value };
        }
      }

      // Only the first step may answer an outstanding question. Once a step
      // has run, the turn is about the new request — resuming here would
      // re-ask a question the user has already moved on from.
      const resuming =
        step === 1 &&
        !gathered.length &&
        offered &&
        (routed.type !== "action" ||
          namedChoice !== undefined ||
          answeredGap !== undefined) &&
        available.some((a) => a.name === offered.action);

      const decision: AgentDecision = resuming
        ? { type: "action", action: offered!.action }
        : routed;
      let pending = resuming ? offered : undefined;

      // Answering a question we attached choices to. Clicking one sends its
      // label, so matching on the label covers both the button and the user
      // typing "the coastal one" — and neither has to know an internal id.
      if (pending && answeredGap) {
        pending = {
          ...pending,
          known: { ...pending.known, [answeredGap.field]: answeredGap.value },
        };
        trace.stages.push({
          stage: "clarify.answered",
          ms: 0,
          note: `${answeredGap.field} taken from the reply`,
        });
      }

      if (pending?.options && namedChoice) {
        const { field } = pending.options;
        pending = { ...pending, known: { ...pending.known, [field]: namedChoice.value } };
        trace.stages.push({
          stage: "resolve.chosen",
          ms: 0,
          note: `${field} = ${namedChoice.label}`,
        });
      }

      if (offered && step === 1) {
        trace.stages.push({
          stage: resuming ? "resume" : "resume.superseded",
          ms: 0,
          note: resuming
            ? `treating this as the answer to "${offered.question}"`
            : `new intent (${routed.type}) supersedes the pending ${offered.action}`,
        });
      }
      trace.decision = decision.type === "clarification" ? "clarification" : decision.type;

      // A retry that found no other capability means the original gap is the
      // real problem. Ask the question we held back, rather than answering
      // something the user did not ask.
      if (heldQuestion && (decision.type !== "action" || weakReplacement)) {
        yield {
          type: "error",
          error: {
            code: heldQuestion.error.code,
            message: heldQuestion.error.message,
            hint: heldQuestion.error.hint,
            recoverable: true,
          },
        };
        const next: PendingClarification = {
          action: heldQuestion.action.name,
          known: heldQuestion.known,
          missing: heldQuestion.missing,
          question: heldQuestion.text,
          attempts: (offered?.attempts ?? 0) + 1,
          options: heldQuestion.options,
        };
        trace.decision = "clarification";
        trace.stages.push({
          stage: "route.deadend.exhausted",
          ms: 0,
          note: `nothing else could answer; asking about ${heldQuestion.action.name}`,
        });
        yield { type: "pending", pending: next };
        yield { type: "answer", text: heldQuestion.text };
        yield* finish();
        return;
      }

      if (decision.type === "clarification") {
        yield { type: "answer", text: decision.question };
        yield* finish();
        return;
      }

      if (decision.type === "action") {
        const action = available.find((a) => a.name === decision.action);
        if (!action) {
          // Either a hallucinated name or a disabled action. Both are handled
          // the same way: the capability does not exist.
          const err = unknownActionError(
            decision.action,
            this.agent.actionList.map((a) => a.name)
          );
          trace.stages.push({
            stage: "route.reject",
            ms: 0,
            note: err.message.split("\n")[0],
          });
          yield {
            type: "error",
            error: {
              code: err.code,
              message: err.message,
              hint: err.hint,
              recoverable: true,
            },
          };
          yield* this.answerStage(parts, context, knowledge, [], trace);
          yield* finish();
          return;
        }

        const prepared = yield* this.prepareInput(
          action,
          { ...(pending?.known ?? {}), ...(decision.arguments ?? {}) },
          parts,
          context,
          trace,
          { context, user, session, requestId, signal: call.signal },
          namedChoice !== undefined || answeredGap !== undefined
        );

        if (!prepared.ok) {
          // Before asking the user to fill a gap, see whether a different
          // capability can answer without it. "Which earthquake has a tsunami
          // alert?" needs no earthquake chosen — another action scans them all.
          // Unless the application already told us what the answers are. A
          // question with two buttons on it beats guessing at a different
          // capability that was not asked for.
          // Not while the user is part-way through answering for a specific
          // action. Swapping capability under them mid-flow discards the
          // answers they have already given.
          if (
            !resuming &&
            !prepared.options &&
            deadEnds === 0 &&
            available.length > attempted.size + 1
          ) {
            deadEnds += 1;
            retrying = true;
            attempted.add(action.name);
            heldQuestion = {
              action,
              missing: prepared.missing,
              known: prepared.known,
              text: prepared.userMessage,
              error: prepared.error,
              confidence: lastConfidence,
              options: prepared.options,
            };
            trace.stages.push({
              stage: "route.deadend",
              ms: 0,
              note: `${action.name} needs ${prepared.missing.join(", ") || "more"}; trying another capability`,
            });
            continue;
          }

          // The user gets a question; the developer gets the full diagnosis in
          // the trace. Missing arguments are a normal outcome, not a failure.
          yield {
            type: "error",
            error: {
              code: prepared.error.code,
              message: prepared.error.message,
              hint: prepared.error.hint,
              recoverable: true,
            },
          };

          // Being asked about a *different* gap means the last answer landed.
          // Counting that as a repeat would strand any action needing more
          // than two arguments.
          const sameGap =
            pending !== undefined &&
            pending.missing.length === prepared.missing.length &&
            pending.missing.every((field) => prepared.missing.includes(field));
          const attempts = sameGap ? (pending?.attempts ?? 0) + 1 : 1;
          // Repeating a question verbatim reads as broken. Say that the answer
          // did not land, then repeat the guidance once.
          const guidance = prepared.options
            ? undefined
            : describeHowToChoose(action, prepared.missing, context);
          const question = prepared.options
            ? `${prepared.userMessage} ${humanList(
                prepared.options.choices.map((c) => c.label),
                "or"
              )}`
            : attempts > 1
              ? `That didn't give me enough to go on. ${
                  guidance ??
                  `Could you pick the ${humanList(
                    prepared.missing.map(humaniseField)
                  )} from the page?`
                }`
              : prepared.userMessage;

          if (attempts <= MAX_CLARIFY_ATTEMPTS) {
            const next: PendingClarification = {
              action: action.name,
              known: prepared.known,
              missing: prepared.missing,
              question,
              attempts,
              options: prepared.options,
            };
            trace.decision = "clarification";
            yield { type: "pending", pending: next };
          }
          yield { type: "answer", text: question };
          yield* finish();
          return;
        }

        const decisionRecord = evaluatePermission(action, {
          input: prepared.input,
          context,
          user,
        });
        trace.permission = {
          action: action.name,
          permission: decisionRecord.permission,
          reason: decisionRecord.reason,
          source: decisionRecord.source,
        };

        if (decisionRecord.permission === "disabled") {
          const text = `That isn't something ${this.agent.identity} can do for you here.`;
          yield { type: "answer", text };
          yield* finish();
          return;
        }

        const proposal: ActionProposal = {
          id: newId("prop"),
          action: action.name,
          side: action.side,
          input: prepared.input,
          permission: decisionRecord.permission,
          description: describeAction(action, prepared.input, context),
          confirmLabel: action.confirmLabel ?? defaultConfirmLabel(action),
        };
        trace.proposal = proposal;

        // Anything requiring confirmation, and anything the browser has to
        // run, goes back to the UI. The runtime never self-authorizes.
        if (decisionRecord.permission === "confirm" || action.side === "client") {
          yield { type: "proposal", proposal };
          yield* finish();
          return;
        }

        const outcome = await this.execute(action, prepared.input, {
          context,
          user,
          session,
          requestId,
          signal: call.signal,
        }, proposal.id);
        trace.outcomes.push(outcome);
        gathered.push(outcome);
        yield { type: "outcome", outcome };
        if (outcome.ok && outcome.data !== undefined) {
          yield {
            type: "recall",
            recall: {
              action: outcome.action,
              data: outcome.data,
              summary: outcome.summary,
              contextSignature,
            },
          };
        }

        // A failed step is not worth building on, and repeating a call with
        // the same arguments is a loop rather than progress.
        const signature = `${action.name}:${JSON.stringify(prepared.input)}`;
        const repeated = attempted.has(signature);
        attempted.add(signature);
        attempted.add(action.name);

        if (!outcome.ok || repeated || step === this.agent.maxSteps) {
          if (repeated) {
            trace.stages.push({
              stage: "gather.stop",
              ms: 0,
              note: `${action.name} was already called with these arguments`,
            });
          }
          break;
        }
        continue;
      }

      // The router chose to answer rather than fetch anything more.
      break;
      }

      /* ------------------------------- answer ------------------------------- */

      yield* this.answerStage(parts, context, knowledge, gathered, trace);
      yield* finish();
    } catch (error) {
      const agentError =
        error instanceof AgentError
          ? error
          : new AgentError("ACTION_FAILED", (error as Error).message ?? String(error));
      yield {
        type: "error",
        error: {
          code: agentError.code,
          message: agentError.message,
          hint: agentError.hint,
        },
      };
      yield* finish();
    }
  }

  /* ----------------------------- pipeline stages ---------------------------- */

  private async resolveContext(
    page: PageState,
    session: SessionState,
    user: JsonObject | null
  ): Promise<AgentContext> {
    if (!this.agent.context) {
      return Object.fromEntries(
        Object.entries(page).filter(([, v]) => v !== undefined)
      ) as AgentContext;
    }
    const context = await this.agent.context({ user, page, session });
    return context ?? {};
  }

  private async retrieve(query: string, trace: Trace): Promise<RetrievedChunk[]> {
    const started = now();
    const retriever = await this.retriever();
    if (!retriever.size) return [];
    const results = (await retriever.search(query, MAX_KNOWLEDGE_CHUNKS)).filter(
      (r) => r.score >= MIN_RELATIVE_SCORE && r.coverage >= MIN_COVERAGE
    );
    trace.knowledge = results.map((r) => ({
      id: r.id,
      title: r.title,
      source: r.source,
      score: Number(r.score.toFixed(3)),
      coverage: Number(r.coverage.toFixed(2)),
    }));
    trace.stages.push({
      stage: "retrieval",
      ms: now() - started,
      note: `${results.length}/${retriever.size} chunks above relative ${MIN_RELATIVE_SCORE} / coverage ${MIN_COVERAGE}`,
    });
    return results;
  }

  private async *routeStage(
    parts: PromptParts,
    actions: ActionDefinition[],
    knowledge: RetrievedChunk[],
    trace: Trace,
    gathered: ActionOutcome[] = [],
    attempted: Set<string> = new Set(),
    retrying = false
  ): AsyncGenerator<
    AgentEvent,
    {
      decision:
        | { type: "answer" }
        | { type: "action"; action: string; arguments?: Record<string, unknown> }
        | { type: "clarification"; question: string };
      confidence: number;
    }
  > {
    const started = now();
    yield { type: "stage", stage: "route" };
    const routed = await this.router.runStructured({
      task: "route",
      prompt: routePrompt(
        parts,
        actions,
        gathered.map((o) => ({ name: o.action, summary: o.summary }))
      ),
      schema: agentDecisionSchema(actions.map((a) => a.name)),
      schemaName: "AgentDecision",
      temperature: 0,
      maxTokens: 200,
      stage: {
        message: parts.message,
        context: parts.context,
        actions: actions.map((a) => ({
          name: a.name,
          description: a.description,
          examples: a.examples,
        })),
        attempted: [...attempted],
        retrying,
        hasKnowledge: knowledge.length > 0,
      },
    });

    this.recordStage(trace, {
      stage: retrying ? "route.retry" : gathered.length ? `route.step${gathered.length + 1}` : "route",
      provider: routed.providerId,
      ms: now() - started,
      confidence: routed.confidence,
      reason: routed.escalatedBecause,
      attempts: routed.attempts,
      output: routed.value,
    });

    yield { type: "stage", stage: "route", provider: routed.providerId };
    return { decision: routed.value, confidence: routed.confidence };
  }

  private async *prepareInput(
    action: ActionDefinition,
    proposed: Record<string, unknown>,
    parts: PromptParts,
    context: AgentContext,
    trace: Trace,
    execution?: ActionExecutionContext,
    /**
     * The user's message was already spent answering an earlier question.
     * Mining it again fills the *next* gap with a fragment of the last answer
     * — picking "Coastal Sensors" as the project and then, from the same two
     * words, "Sensors" as its new name.
     */
    consumedMessage = false
  ): AsyncGenerator<
    AgentEvent,
    | { ok: true; input: Record<string, unknown> }
    | {
        ok: false;
        error: AgentError;
        userMessage: string;
        known: Record<string, unknown>;
        missing: string[];
        options?: { field: string; choices: Choice[] };
      }
  > {
    // Context-bound fields are authoritative: the model cannot redirect an
    // action at a different project by proposing a different id.
    const prefilled: Record<string, unknown> = {};
    for (const [field, key] of Object.entries(action.fillFromContext ?? {})) {
      if (context[key] !== undefined) prefilled[field] = context[key];
    }

    let candidate: Record<string, unknown> = { ...proposed, ...prefilled };
    let parsed = action.input.safeParse(candidate);

    // Note the deliberate absence of `!parsed.success` here: an input made
    // entirely of optional fields validates while empty, and silently
    // searching for nothing is worse than spending one extraction call.
    if (!consumedMessage && needsExtraction(action.input as ZodTypeAny, candidate)) {
      const started = now();
      yield { type: "stage", stage: "extract" };
      try {
        const extracted = await this.router.runStructured({
          task: "extract",
          prompt: extractPrompt(parts, action, prefilled),
          // Ask for a partial fill and judge completeness ourselves. Validating
          // the strict schema here would throw away a half-answer that is
          // exactly what we need to ask a good follow-up question.
          schema: partialSchema(action.input as ZodTypeAny),
          schemaName: `${action.name}Input`,
          temperature: 0,
          maxTokens: 300,
          stage: {
            message: parts.message,
            context,
            actionName: action.name,
            actionPhrases: [action.description, ...(action.examples ?? [])],
            prefilled,
          },
        });
        this.recordStage(trace, {
          stage: "extract",
          provider: extracted.providerId,
          ms: now() - started,
          confidence: extracted.confidence,
          reason: extracted.escalatedBecause,
          attempts: extracted.attempts,
          output: extracted.value,
        });
        yield { type: "stage", stage: "extract", provider: extracted.providerId };
        const filled = Object.fromEntries(
          // Only absent values are dropped. An empty string is a real answer:
          // for a search filter it means "everything".
          Object.entries((extracted.value ?? {}) as Record<string, unknown>).filter(
            ([, value]) => value !== undefined && value !== null
          )
        );
        candidate = { ...candidate, ...filled, ...prefilled };
        parsed = action.input.safeParse(candidate);
      } catch (error) {
        // No provider could fill the schema. That is not a crash — it means we
        // do not know enough yet, which is a question for the user. Validation
        // below turns the missing fields into that question.
        this.recordStage(trace, {
          stage: "extract.failed",
          ms: now() - started,
          note: (error as Error).message.split("\n")[0],
        });
      }
    }

    // Still short a required field. Before treating that as a question for
    // the user, ask the application what the answers even are — it knows, and
    // if there is only one there is nothing to ask about.
    //
    // Gaps are taken in the order the schema declares them, and only the first
    // outstanding one is ever asked about. A person filling in a form is asked
    // one thing at a time; there is no reason a conversation should be worse.
    let askAbout: string | undefined;
    let askChoices: Choice[] | undefined;

    while (!parsed.success) {
      const gaps = parsed.error.issues.map((i) => i.path.join(".")).filter(Boolean);
      const field = gaps[0];
      if (!field) break;

      // An enum has already said what its answers are. Making the application
      // repeat them in a resolver would be busywork.
      const declared = fieldEnumValues(action.input as ZodTypeAny, field);
      const resolver = action.resolve?.[field];

      if (!resolver || !execution) {
        askAbout = field;
        askChoices = declared.length
          ? declared.map((value) => ({ value, label: humaniseValue(value) }))
          : undefined;
        break;
      }

      const started = now();
      let choices: Choice[];
      try {
        choices = await resolver(execution);
      } catch (error) {
        this.recordStage(trace, {
          stage: "resolve.failed",
          ms: now() - started,
          note: `${action.name}.${field}: ${(error as Error).message.split("\n")[0]}`,
        });
        askAbout = field;
        break;
      }

      // Exactly one candidate is not a choice. Fill it and move to the next gap.
      if (choices.length === 1) {
        candidate = { ...candidate, [field]: choices[0]!.value };
        parsed = action.input.safeParse(candidate);
        this.recordStage(trace, {
          stage: "resolve",
          ms: now() - started,
          note: `${action.name}.${field} = ${choices[0]!.label} (only candidate)`,
        });
        continue;
      }

      this.recordStage(trace, {
        stage: "resolve",
        ms: now() - started,
        note: `${action.name}.${field}: ${choices.length} candidates to choose from`,
      });
      askAbout = field;
      askChoices = choices.length ? choices : undefined;
      break;
    }

    if (!parsed.success && askAbout) {
      const known = Object.fromEntries(
        Object.entries(candidate).filter(([, v]) => v !== undefined)
      );
      return {
        ok: false,
        error: invalidActionInputError(
          action.name,
          action.input,
          candidate,
          parsed.error,
          Object.keys(context)
        ),
        known,
        missing: [askAbout],
        options: askChoices ? { field: askAbout, choices: askChoices } : undefined,
        userMessage:
          describeHowToChoose(action, [askAbout], context) ??
          // "Which" for something picked from what already exists, "what" for
          // a value the user is making up.
          (askChoices || /id$/i.test(askAbout) || action.resolve?.[askAbout]
            ? `Which ${humaniseField(askAbout)}?`
            : `What ${humaniseField(askAbout)}?`),
      };
    }

    if (!parsed.success) {
      const error = invalidActionInputError(
        action.name,
        action.input,
        candidate,
        parsed.error,
        Object.keys(context)
      );
      const missing = parsed.error.issues.map((i) => i.path.join(".")).filter(Boolean);
      trace.stages.push({
        stage: "validation.reject",
        ms: 0,
        note: `${action.name}: ${missing.join(", ") || "schema mismatch"}`,
      });
      const known = Object.fromEntries(
        Object.entries(candidate).filter(([, v]) => v !== undefined)
      );
      return {
        ok: false,
        error,
        known,
        missing,
        userMessage:
          describeHowToChoose(action, missing, context) ??
          (missing.length
            ? `I need a bit more to do that — which ${humanList(
                missing.map(humaniseField)
              )} do you mean?`
            : `I couldn't work out the details for that. Could you rephrase?`),
      };
    }

    return { ok: true, input: parsed.data as Record<string, unknown> };
  }

  private async *runDirectExecution(
    request: { action: string; arguments: Record<string, unknown>; confirmed?: boolean },
    ctx: {
      context: AgentContext;
      user: JsonObject | null;
      session: SessionState;
      requestId: string;
      signal?: AbortSignal;
    },
    available: ActionDefinition[],
    trace: Trace
  ): AsyncGenerator<AgentEvent, ActionOutcome | undefined> {
    const action = available.find((a) => a.name === request.action);
    if (!action) {
      const error = unknownActionError(
        request.action,
        this.agent.actionList.map((a) => a.name)
      );
      yield {
        type: "error",
        error: { code: error.code, message: error.message, hint: error.hint },
      };
      return undefined;
    }
    if (action.side === "client") {
      yield {
        type: "error",
        error: {
          code: "ACTION_FAILED",
          message: `Action "${action.name}" is a client action and has no server implementation.`,
          hint: `Client actions run in the browser through the handlers passed to <AgentProvider clientActions={{ ... }} />.`,
        },
      };
      return undefined;
    }

    // Context-bound fields are re-applied server-side; a client cannot point
    // an action at a resource the current page is not about.
    const input: Record<string, unknown> = { ...request.arguments };
    for (const [field, key] of Object.entries(action.fillFromContext ?? {})) {
      if (ctx.context[key] !== undefined) input[field] = ctx.context[key];
    }

    const parsed = action.input.safeParse(input);
    if (!parsed.success) {
      const error = invalidActionInputError(
        action.name,
        action.input,
        input,
        parsed.error,
        Object.keys(ctx.context)
      );
      yield {
        type: "error",
        error: { code: error.code, message: error.message, hint: error.hint },
      };
      return undefined;
    }

    const decision = evaluatePermission(action, {
      input: parsed.data,
      context: ctx.context,
      user: ctx.user,
    });
    trace.permission = {
      action: action.name,
      permission: decision.permission,
      reason: decision.reason,
      source: decision.source,
    };

    if (decision.permission === "disabled") {
      yield {
        type: "error",
        error: {
          code: "ACTION_DISABLED",
          message: `Action "${action.name}" is not permitted for this user.`,
        },
      };
      return undefined;
    }
    if (decision.permission === "confirm" && !request.confirmed) {
      const error = confirmationRequiredError(action.name);
      yield {
        type: "error",
        error: { code: error.code, message: error.message, hint: error.hint },
      };
      return undefined;
    }

    const outcome = await this.execute(
      action,
      parsed.data as Record<string, unknown>,
      ctx,
      newId("prop")
    );
    yield { type: "outcome", outcome };
    return outcome;
  }

  private async *runConfirmedProposal(
    proposal: ActionProposal,
    ctx: {
      context: AgentContext;
      user: JsonObject | null;
      session: SessionState;
      requestId: string;
      signal?: AbortSignal;
    },
    available: ActionDefinition[],
    trace: Trace
  ): AsyncGenerator<AgentEvent, ActionOutcome | undefined> {
    const action = available.find((a) => a.name === proposal.action);
    if (!action) {
      const error = unknownActionError(
        proposal.action,
        this.agent.actionList.map((a) => a.name)
      );
      yield {
        type: "error",
        error: { code: error.code, message: error.message, hint: error.hint },
      };
      return undefined;
    }

    // The echoed proposal is untrusted input. Re-validate and re-authorize.
    const parsed = action.input.safeParse(proposal.input);
    if (!parsed.success) {
      const error = invalidActionInputError(
        action.name,
        action.input,
        proposal.input,
        parsed.error,
        Object.keys(ctx.context)
      );
      yield {
        type: "error",
        error: { code: error.code, message: error.message, hint: error.hint },
      };
      return undefined;
    }

    const decision = evaluatePermission(action, {
      input: parsed.data,
      context: ctx.context,
      user: ctx.user,
    });
    trace.permission = {
      action: action.name,
      permission: decision.permission,
      reason: `${decision.reason} (re-evaluated at confirmation)`,
      source: decision.source,
    };
    if (decision.permission === "disabled") {
      yield {
        type: "error",
        error: {
          code: "ACTION_DISABLED",
          message: `Action "${action.name}" is not permitted for this user.`,
        },
      };
      return undefined;
    }
    if (action.side === "client") {
      // Client actions are executed by the browser, not here.
      yield { type: "proposal", proposal: { ...proposal, permission: "auto" } };
      return undefined;
    }

    const outcome = await this.execute(
      action,
      parsed.data as Record<string, unknown>,
      ctx,
      proposal.id
    );
    yield { type: "outcome", outcome };
    return outcome;
  }

  private async execute(
    action: ActionDefinition,
    input: Record<string, unknown>,
    ctx: {
      context: AgentContext;
      user: JsonObject | null;
      session: SessionState;
      requestId: string;
      signal?: AbortSignal;
    },
    proposalId: string
  ): Promise<ActionOutcome> {
    const started = now();
    try {
      const raw = await action.execute!(input, ctx);
      const normalized = normalizeResult(raw);
      return {
        proposalId,
        action: action.name,
        side: action.side,
        input,
        ok: true,
        ms: now() - started,
        ...(normalized.summary ? { summary: normalized.summary } : {}),
        ...(normalized.data !== undefined ? { data: normalized.data } : {}),
      };
    } catch (error) {
      const err = error as Error & { code?: string };
      return {
        proposalId,
        action: action.name,
        side: action.side,
        input,
        ok: false,
        ms: now() - started,
        error: { code: err.code ?? "ACTION_FAILED", message: err.message },
      };
    }
  }

  private async *answerStage(
    parts: PromptParts,
    context: AgentContext,
    knowledge: RetrievedChunk[],
    outcomes: ActionOutcome[],
    trace: Trace
  ): AsyncGenerator<AgentEvent> {
    const failed = outcomes.filter((o) => !o.ok);
    if (failed.length && !outcomes.some((o) => o.ok)) {
      const text = `I couldn't complete that: ${failed[0]!.error?.message ?? "the action failed"}.`;
      trace.stages.push({ stage: "answer.deterministic", ms: 0, note: "action failed" });
      yield { type: "answer", text };
      return;
    }

    const facts = buildFacts({
      context,
      knowledge,
      actionResults: outcomes
        .filter((o) => o.ok)
        .map((o) => ({ name: o.action, summary: o.summary, data: o.data })),
    });

    const hasGrounding = knowledge.length > 0 || outcomes.some((o) => o.ok);
    if (!hasGrounding && this.agent.groundedOnly) {
      // Rule 2: no facts, no answer. A tiny model asked to improvise here is
      // exactly how a product ends up asserting things that are not true.
      const text = `I don't have anything in ${this.agent.identity} that answers that. I can only go on this product's own documentation and data.`;
      trace.refused = true;
      trace.stages.push({
        stage: "answer.refused",
        ms: 0,
        note: "no grounding available (groundedOnly)",
      });
      yield { type: "answer", text };
      return;
    }

    // Documentation that fed this answer, emitted before the text so the UI can
    // show provenance early.
    //
    // Only when documentation is what answered: if an action returned the
    // facts, the source is the action, and citing an unrelated page next to it
    // is noise at best and misleading at worst.
    const answeredByAction = outcomes.some((outcome) => outcome.ok);
    if (knowledge.length && !answeredByAction) {
      yield {
        type: "sources",
        sources: knowledge.map((chunk) => ({
          id: chunk.id,
          title: chunk.title,
          source: chunk.source,
          ...(chunk.url ? { url: chunk.url } : {}),
          score: Number(chunk.score.toFixed(3)),
        })),
      };
    }

    const task: ModelTask = outcomes.length ? "explain" : "answer";
    const started = now();

    // A specific question about a record deserves the specific answer, not the
    // record's summary sentence. This is exact, grounded and free.
    const record = outcomes.find((o) => o.ok && o.data !== undefined)?.data;
    const field = answerFromFields(parts.message, record);
    if (field) {
      trace.stages.push({
        stage: "answer.field",
        ms: now() - started,
        note: `answered from ${field.field}`,
      });
      yield { type: "answer", text: `${field.label}: ${field.value}` };
      return;
    }

    // When the application already wrote a one-line result, a weak model adds
    // latency and risk to reword it. Spend the round trip only if the model is
    // good enough to be worth it.
    // Several lookups mean several answers. Reporting only the first would
    // silently drop half of what the user asked for.
    const summaries = outcomes.filter((o) => o.ok && o.summary).map((o) => o.summary!);
    const summary = summaries.length ? summaries.join(". ") : undefined;
    if (summary) {
      const best = (await this.router.candidates(task))[0];
      if (!best || best.capabilities.quality < WORTH_REWORDING) {
        trace.stages.push({
          stage: "explain.skipped",
          ms: now() - started,
          note: best
            ? `${best.provider.id} (quality ${best.capabilities.quality}) is not worth the round trip`
            : "no provider available",
        });
        yield { type: "answer", text: capitalise(summary) };
        return;
      }
    }

    const prompt = explainPrompt(parts, facts, { groundedOnly: this.agent.groundedOnly });
    let text = "";
    let providerId: string | undefined;

    yield { type: "stage", stage: task };

    try {
      for await (const chunk of this.router.streamText({
        task,
        prompt,
        temperature: 0.2,
        maxTokens: 300,
        stage: {
          message: parts.message,
          context,
          facts,
          summaries: outcomes.filter((o) => o.ok && o.summary).map((o) => o.summary!),
          knowledge: knowledge.map((k) => k.text),
        },
      })) {
        providerId = chunk.providerId;
        text += chunk.delta;
        yield { type: "delta", text: chunk.delta };
      }
    } catch (error) {
      // Falling back to deterministic summaries keeps the product usable when
      // no model is reachable at all.
      text = deterministicAnswer(outcomes, knowledge);
      trace.stages.push({
        stage: "answer.fallback",
        ms: now() - started,
        note: (error as Error).message,
      });
      yield { type: "answer", text };
      return;
    }

    // Small models sometimes restate the prompt instead of answering it.
    // That is not an answer, and showing it would leak the runtime's internal
    // instructions to the user, so fall back to the deterministic summary.
    if (isPromptEcho(text, prompt, facts)) {
      const summary = deterministicAnswer(outcomes, knowledge);
      // Evidence beats advertised quality — but benching the only provider for
      // a stage disables that stage for the rest of the process, which is a
      // worse outcome than one poor answer.
      const alternatives = (await this.router.candidates(task)).filter(
        (candidate) => candidate.provider.id !== providerId
      );
      if (providerId && alternatives.length) {
        this.router.bench(providerId, task, "echoed the prompt instead of answering");
      }
      this.recordStage(trace, {
        stage: `${task}.rejected`,
        provider: providerId,
        ms: now() - started,
        note: "provider echoed the prompt; used the deterministic summary",
      });
      yield { type: "answer", text: summary };
      return;
    }

    this.recordStage(trace, {
      stage: task,
      provider: providerId,
      ms: now() - started,
    });
    yield { type: "answer", text: text.trim() };
  }

  /* -------------------------------- helpers -------------------------------- */

  private recordStage(trace: Trace, stage: StageTrace): void {
    trace.stages.push(stage);
    if (stage.provider && this.isCloud(stage.provider)) trace.cloudFallbackUsed = true;
  }

  private isCloud(providerId: string): boolean {
    if (!this.tierCache) {
      this.tierCache = new Map();
      // Populated lazily; capabilities() is async so use a conservative match
      // until the cache warms via describe().
    }
    const cached = this.tierCache.get(providerId);
    if (cached) return cached === "cloud";
    return /cloud|anthropic|openai|gateway/i.test(providerId);
  }

  /** Machine-readable capability surface. Useful for docs and for evals. */
  describeActions(): Array<{
    name: string;
    description: string;
    side: string;
    permission: string;
    fields: string[];
  }> {
    return this.agent.actionList.map((a) => ({
      name: a.name,
      description: a.description,
      side: a.side,
      permission: typeof a.permission === "function" ? "dynamic" : a.permission,
      fields: objectFields(a.input as ZodTypeAny),
    }));
  }
}

/* --------------------------------- utils --------------------------------- */

/**
 * Optional fields still carry meaning — a search filter left empty silently
 * changes the answer — so any unset declared field is worth one extraction
 * pass. Actions with no fields never trigger a model call.
 */
/** The same object schema with every field optional. */
function partialSchema(schema: ZodTypeAny): ZodTypeAny {
  // .partial() exists on object schemas in both zod 3 and zod 4.
  if (schemaTypeName(schema) === "object" && typeof (schema as any).partial === "function") {
    return (schema as any).partial();
  }
  return schema;
}

function needsExtraction(schema: ZodTypeAny, candidate: Record<string, unknown>): boolean {
  const fields = objectFields(schema);
  if (!fields.length) return false;
  return fields.some((field) => candidate[field] === undefined);
}

/**
 * True when the generated text is substantially lifted from the prompt.
 *
 * Checks for a long verbatim window rather than a fixed marker string, so it
 * keeps working if the prompt wording changes.
 */
export function isPromptEcho(text: string, prompt: string, facts = ""): boolean {
  const answer = text.trim();
  if (!answer) return true;
  const window = 48;
  if (answer.length < window) return false;
  // Compare against the instructions only. A grounded answer repeats the
  // FACTS by design; treating that as an echo punishes exactly the behaviour
  // the runtime asks for.
  const instructions = facts ? prompt.split(facts).join(" ") : prompt;
  const haystack = normalizeWhitespace(instructions);
  const needle = normalizeWhitespace(answer);
  for (let i = 0; i + window <= needle.length; i += 12) {
    if (haystack.includes(needle.slice(i, i + window))) return true;
  }
  return false;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function deterministicAnswer(
  outcomes: ActionOutcome[],
  knowledge: RetrievedChunk[]
): string {
  const summaries = outcomes.filter((o) => o.ok && o.summary).map((o) => o.summary!);
  if (summaries.length) return summaries.join(". ");
  const chunk = knowledge[0];
  if (chunk) return plainText(chunk.text).slice(0, 400);
  return "I don't have anything to go on for that.";
}

/** Strips the markdown that documentation is written in. */
function plainText(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}[-*+]\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeResult(raw: unknown): { data?: JsonValue; summary?: string } {
  if (raw === undefined || raw === null) return {};
  if (
    typeof raw === "object" &&
    !Array.isArray(raw) &&
    ("data" in (raw as object) || "summary" in (raw as object))
  ) {
    const shaped = raw as { data?: JsonValue; summary?: string };
    return {
      ...(shaped.data !== undefined ? { data: shaped.data } : {}),
      ...(shaped.summary ? { summary: shaped.summary } : {}),
    };
  }
  return { data: raw as JsonValue };
}

function describeAction(
  action: ActionDefinition,
  input: Record<string, unknown>,
  context: AgentContext
): string {
  if (action.describe) {
    try {
      return action.describe(input, context);
    } catch {
      /* fall through to the generic description */
    }
  }
  const args = Object.entries(input)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join(", ");
  return args ? `${action.description} (${args})` : action.description;
}

function defaultConfirmLabel(action: ActionDefinition): string {
  const words = action.name.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** "eventId" -> "event", "projectId" -> "project". */
/** The application knows how a user is meant to choose; the runtime does not. */
function describeHowToChoose(
  action: ActionDefinition,
  missing: string[],
  context: AgentContext
): string | undefined {
  if (!action.clarify) return undefined;
  try {
    return action.clarify(missing, context);
  } catch {
    return undefined;
  }
}

function capitalise(value: string): string {
  const trimmed = value.trim();
  const text = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

/** An enum member as a person would read it: "member" -> "Member". */
function humaniseValue(value: string): string {
  const spaced = value.replace(/[_-]+/g, " ").replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function humaniseField(field: string): string {
  const withoutId = field.replace(/Id$/, "");
  return withoutId
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .trim();
}

function humanList(items: string[], conjunction = "and"): string {
  const unique = [...new Set(items)];
  if (unique.length <= 1) return unique[0] ?? "";
  return `${unique.slice(0, -1).join(", ")} ${conjunction} ${unique.at(-1)}`;
}

/**
 * Which offered choice the user meant.
 *
 * Deliberately strict: an answer has to name the choice. Guessing between two
 * projects the user might be about to rename is not a place to be helpful.
 */
function matchChoice(message: string, choices: Choice[]): Choice | undefined {
  const said = new Set(
    message
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean)
  );
  if (!said.size) return undefined;

  let best: { choice: Choice; score: number } | undefined;
  let runnerUp = 0;

  for (const choice of choices) {
    if (said.has(choice.value.toLowerCase())) return choice;
    const words = choice.label
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean);
    if (!words.length) continue;
    const hit = words.filter((word) => said.has(word)).length / words.length;
    if (!hit) continue;
    if (!best || hit > best.score) {
      runnerUp = best?.score ?? 0;
      best = { choice, score: hit };
    } else if (hit > runnerUp) runnerUp = hit;
  }

  // Naming half of each of two labels names neither.
  if (!best || best.score < 0.5 || best.score === runnerUp) return undefined;
  return best.choice;
}

/**
 * The user's reply, read as the value of the one field we asked about.
 *
 * Deliberately narrow: only scalar fields, only a short reply. A paragraph is
 * not somebody answering "what should I call it?", and a number field is not
 * satisfied by the word "yes".
 */
function literalAnswer(
  message: string,
  input: ZodTypeAny,
  field: string
): string | number | boolean | undefined {
  const text = message.trim().replace(/^["'“”]|["'“”.!]$/g, "").trim();
  if (!text || text.length > 80) return undefined;

  const options = fieldEnumValues(input, field);
  if (options.length) {
    const said = text.toLowerCase();
    return options.find((o) => o.toLowerCase() === said);
  }

  const kind = schemaTypeName(fieldSchema(input, field) ?? (undefined as any));
  if (kind === "number") {
    const parsed = Number(text.replace(/[^\d.-]/g, ""));
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  if (kind !== "string") return undefined;

  // A whole request is not an answer to "what should I call it?".
  if (/\s/.test(text) && text.split(/\s+/).length > 8) return undefined;
  return text;
}

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}
