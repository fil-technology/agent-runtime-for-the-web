import { z } from "zod";
import type {
  Choice,
  JsonValue,
  PageState,
  ChatMessage,
  Permission,
  ActionSide,
} from "../types.js";
import type { RouteAttempt } from "../model/router.js";
import type { ModelCapabilities } from "../model/types.js";

/**
 * What a model is allowed to hand back to the runtime.
 *
 * Nothing else the model produces is ever interpreted as an instruction.
 * Prose is only ever displayed, never parsed for consequences.
 */
export const AgentDecisionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("answer") }),
  z.object({
    type: z.literal("action"),
    action: z.string(),
    arguments: z.record(z.unknown()).optional(),
  }),
  z.object({ type: z.literal("clarification"), question: z.string().max(300) }),
]);

export type AgentDecision = z.infer<typeof AgentDecisionSchema>;

/**
 * The decision schema narrowed to the capabilities this user can reach right
 * now.
 *
 * The action name is an enum, not a string: a model that invents a capability
 * fails validation and the router escalates, instead of the runtime having to
 * catch an unknown name after the fact. The set of actions is per-request
 * because permissions are — this is the product teaching the model exactly
 * what exists, for this person, on this page.
 */
export function agentDecisionSchema(actionNames: string[]) {
  const clarification = z.object({
    type: z.literal("clarification"),
    question: z.string().max(300),
  });
  const answer = z.object({ type: z.literal("answer") });
  if (!actionNames.length) {
    return z.discriminatedUnion("type", [answer, clarification]);
  }
  return z.discriminatedUnion("type", [
    answer,
    z.object({
      type: z.literal("action"),
      action: z.enum(actionNames as [string, ...string[]]),
      arguments: z.record(z.unknown()).optional(),
    }),
    clarification,
  ]);
}

/**
 * An action the runtime wanted to take but could not complete, because a
 * required argument was missing.
 *
 * It travels back to the client and returns with the user's reply, so the next
 * message is understood as an answer to the question rather than as an
 * unrelated new request.
 */
export interface PendingClarification {
  action: string;
  /** Arguments already established, from context or the first message. */
  known: Record<string, unknown>;
  missing: string[];
  question: string;
  /** Guards against asking the same question forever. */
  attempts: number;
  /**
   * The answers to the question, when the application could enumerate them.
   *
   * Carried on the pending rather than held server-side: the next turn
   * matches what the user says against these labels, so clicking a choice and
   * typing its name are the same act, and the runtime stays stateless.
   */
  options?: { field: string; choices: Choice[] };
}

/**
 * The last thing an action returned, carried into the next turn.
 *
 * Follow-ups like "what depth?" or "and the magnitude?" are about the record
 * already on screen. Re-running the action would be wasteful and, for anything
 * with a side effect, wrong — the data is already here.
 */
export interface RecallState {
  action: string;
  data: JsonValue;
  summary?: string;
  /**
   * The application context this data described. When it changes — a different
   * project, a different earthquake — the recall is stale and is dropped.
   */
  contextSignature: string;
}

/**
 * Where an answer came from.
 *
 * A grounded answer can always name its source, because the runtime knows
 * exactly which chunks it used. Showing them turns "trust me" into "here is
 * the page", and gives the reader somewhere to go next.
 */
export interface AnswerSource {
  id: string;
  title: string;
  source: string;
  url?: string;
  /** Relevance relative to the best match in the same answer, 0..1. */
  score: number;
}

/** A validated, permission-evaluated action the runtime is willing to run. */
export interface ActionProposal {
  id: string;
  action: string;
  side: ActionSide;
  input: Record<string, unknown>;
  permission: Permission;
  /** Deterministic sentence describing exactly what will happen. */
  description: string;
  confirmLabel: string;
}

export interface ActionOutcome {
  proposalId: string;
  action: string;
  side: ActionSide;
  /** The validated input the action actually ran with. */
  input?: Record<string, unknown>;
  ok: boolean;
  summary?: string;
  data?: JsonValue;
  error?: { code: string; message: string };
  ms: number;
}

/* ----------------------------- transport ----------------------------- */

export interface BaseRequest {
  /** Client-generated, used to correlate traces. */
  requestId?: string;
  page?: PageState;
  history?: ChatMessage[];
}

export interface MessageRequest extends BaseRequest {
  kind: "message";
  message: string;
  /** Echoed back from the previous turn when that turn asked a question. */
  pending?: PendingClarification;
  /** Echoed back so follow-ups can be answered from data already fetched. */
  recall?: RecallState;
}

export interface ConfirmRequest extends BaseRequest {
  kind: "confirm";
  /**
   * The proposal is echoed back by the client rather than stored server-side.
   * It is re-validated and re-authorized from scratch, so a tampered proposal
   * can only ever reach an action the user was already allowed to run.
   */
  proposal: ActionProposal;
  approved: boolean;
  /** The message that produced the proposal, for the grounded answer. */
  message: string;
}

export interface ClientResultRequest extends BaseRequest {
  kind: "client-result";
  proposal: ActionProposal;
  ok: boolean;
  result?: JsonValue;
  error?: string;
  message: string;
}

/**
 * Direct execution of a single action, used when the reasoning loop runs in
 * the browser and only the *effect* needs the server. The server performs the
 * full validation -> permission -> authorization sequence regardless of what
 * the client believes it already decided.
 */
export interface ExecuteRequest extends BaseRequest {
  kind: "execute";
  action: string;
  arguments: Record<string, unknown>;
  /** Set by the confirmation UI once the user has approved. */
  confirmed?: boolean;
}

export type RuntimeRequest =
  | MessageRequest
  | ConfirmRequest
  | ClientResultRequest
  | ExecuteRequest;

/* ------------------------------- events ------------------------------ */

export interface StageTrace {
  stage: string;
  provider?: string;
  ms: number;
  confidence?: number;
  reason?: string;
  note?: string;
  attempts?: RouteAttempt[];
  output?: unknown;
}

export interface Trace {
  requestId: string;
  message: string;
  context: Record<string, unknown>;
  knowledge: Array<{
    id: string;
    title: string;
    source: string;
    score: number;
    coverage: number;
  }>;
  visibleActions: string[];
  /** What the routing stage concluded. */
  decision?: "answer" | "action" | "clarification";
  /** True when the runtime declined to answer for lack of grounding. */
  refused?: boolean;
  stages: StageTrace[];
  proposal?: ActionProposal;
  permission?: { action: string; permission: Permission; reason: string; source: string };
  outcomes: ActionOutcome[];
  cloudFallbackUsed: boolean;
  ms: number;
  providers?: ModelCapabilities[];
}

export type AgentEvent =
  | { type: "stage"; stage: string; provider?: string; reason?: string }
  | { type: "delta"; text: string }
  | { type: "answer"; text: string }
  | { type: "proposal"; proposal: ActionProposal }
  | { type: "pending"; pending: PendingClarification }
  | { type: "recall"; recall: RecallState }
  | { type: "sources"; sources: AnswerSource[] }
  | { type: "outcome"; outcome: ActionOutcome }
  | {
      type: "error";
      error: {
        code: string;
        message: string;
        hint?: string;
        /**
         * The runtime handled this and produced a useful answer anyway. It is
         * developer diagnostics, not something to show the user as a failure.
         */
        recoverable?: boolean;
      };
    }
  | { type: "trace"; trace: Trace }
  | { type: "done" };

export interface AgentTurn {
  requestId: string;
  answer?: string;
  /** Set when the runtime asked for a missing argument. */
  pending?: PendingClarification;
  /** The latest action result, to send back with the next message. */
  recall?: RecallState;
  /** Documentation the answer was drawn from. */
  sources?: AnswerSource[];
  /** Present when the turn is waiting on the user or on the browser. */
  proposal?: ActionProposal;
  outcomes: ActionOutcome[];
  error?: { code: string; message: string; hint?: string; recoverable?: boolean };
  trace: Trace;
}

export function newId(prefix: string): string {
  const random =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${random}`;
}
