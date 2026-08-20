import type { ZodType } from "zod";

/* ------------------------------------------------------------------ *
 * JSON
 * ------------------------------------------------------------------ */

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonObject = { [key: string]: JsonValue };

/* ------------------------------------------------------------------ *
 * Context
 *
 * The host application explicitly tells the runtime what the user is
 * looking at. The runtime never inspects the DOM to discover facts the
 * application already knows.
 * ------------------------------------------------------------------ */

/** Page state supplied by the browser (untrusted: it comes from the client). */
export interface PageState {
  /** Stable logical page id, e.g. "project.settings". */
  id?: string;
  /** Current route/pathname, e.g. "/projects/abc123/settings". */
  route?: string;
  /** Arbitrary semantic state the page chooses to expose. */
  [key: string]: JsonValue | undefined;
}

/** Session/user information resolved on the server. Never client supplied. */
export interface SessionState {
  user?: JsonObject | null;
  [key: string]: JsonValue | undefined | null;
}

export interface ContextInput {
  user: JsonObject | null;
  page: PageState;
  session: SessionState;
}

/**
 * The semantic context handed to retrieval, the model and actions.
 * Undefined values are dropped before anything sees them, so a resolver can
 * return optional fields without ceremony.
 */
export type AgentContext = { [key: string]: JsonValue | undefined };

export type ContextResolver = (
  input: ContextInput
) => AgentContext | Promise<AgentContext>;

/* ------------------------------------------------------------------ *
 * Permissions
 * ------------------------------------------------------------------ */

export type Permission = "auto" | "confirm" | "disabled";

export interface PermissionInput<I = unknown> {
  input: I;
  context: AgentContext;
  user: JsonObject | null;
}

export type PermissionResolver<I = unknown> = (
  input: PermissionInput<I>
) => Permission;

export type PermissionSpec<I = unknown> = Permission | PermissionResolver<I>;

/* ------------------------------------------------------------------ *
 * Actions
 * ------------------------------------------------------------------ */

export interface ActionExecutionContext {
  /** Semantic context produced by agent.context(). */
  context: AgentContext;
  /** Server-resolved user. `null` for anonymous. */
  user: JsonObject | null;
  /** Server-resolved session. */
  session: SessionState;
  /** Correlation id for tracing. */
  requestId: string;
  signal?: AbortSignal;
}

export interface ActionResultShape {
  /** Facts handed to the model. Must be safe to show the user. */
  data?: JsonValue;
  /** One-line deterministic summary. Preferred over model prose. */
  summary?: string;
}

export type ActionSide = "server" | "client";

/** One value the user could have meant, offered as a choice. */
export interface Choice {
  /** The value that goes into the action input. */
  value: string;
  /** What the user sees and can say back. */
  label: string;
  /** Optional disambiguator shown beside the label. */
  hint?: string;
}

export interface ActionDefinition<I = any, O = any> {
  /** Assigned by defineAgent() from the actions record key. */
  name: string;
  description: string;
  permission: PermissionSpec<I>;
  input: ZodType<I>;
  side: ActionSide;
  /** Server actions only. Client actions run in the browser. */
  execute?: (input: I, ctx: ActionExecutionContext) => O | Promise<O>;
  /**
   * Fields the runtime fills from context before the model is asked.
   * Maps input field name -> context key.
   * e.g. { projectId: "currentProjectId" }
   */
  fillFromContext?: Record<string, string>;
  /** Human label for the confirm button, e.g. "Delete project". */
  confirmLabel?: string;
  /** Deterministic one-line description of what will happen. */
  describe?: (input: I, context: AgentContext) => string;
  /** Example phrasings; used for routing hints and evaluation. */
  examples?: string[];
  /**
   * What to say when the runtime cannot work out a required argument.
   * The application knows how the user is supposed to choose; the runtime
   * does not.
   */
  clarify?: (missing: string[], context: AgentContext) => string;
  /**
   * Where the candidates for a field come from when the runtime cannot work
   * one out. Maps input field name -> a function returning what the user
   * could pick.
   *
   * This is what stops the assistant from answering "open it from the sidebar
   * and ask again". The application already knows the two projects the user
   * owns; making the user go and navigate to one is the product failing to
   * say so. One candidate is used directly; several become a question with
   * the answers attached; none falls back to `clarify`.
   *
   * Resolvers must return only what this user may act on — the runtime
   * offers whatever it is given, and permission is still evaluated after.
   */
  resolve?: Record<
    string,
    (ctx: ActionExecutionContext) => Choice[] | Promise<Choice[]>
  >;
  /** Marks the result as authoritative product truth (never paraphrased away). */
  authoritative?: boolean;
}

export type ActionMap = Record<string, ActionDefinition<any, any>>;

/* ------------------------------------------------------------------ *
 * Knowledge
 * ------------------------------------------------------------------ */

export interface KnowledgeChunk {
  id: string;
  title: string;
  text: string;
  source: string;
  /** Optional stable link the UI can show. */
  url?: string;
}

export type KnowledgeSource =
  | { kind: "docs"; dir: string; extensions?: string[] }
  | { kind: "inline"; chunks: KnowledgeChunk[] };

export interface RetrievedChunk extends KnowledgeChunk {
  /** Score relative to the best match in this result set, 0..1. */
  score: number;
  /** Absolute BM25 score. */
  rawScore: number;
  /**
   * Fraction of the query's content words this chunk actually contains.
   *
   * Relevance ranking cannot tell you that the best match is still a bad
   * match, and BM25 magnitude depends on corpus size. Coverage does neither,
   * so it is what grounding thresholds on.
   */
  coverage: number;
}

/* ------------------------------------------------------------------ *
 * Agent
 * ------------------------------------------------------------------ */

export interface ModelPolicy {
  /** "auto" routes per stage; "local-only" and "cloud-only" pin a tier. */
  strategy?: "auto" | "local-only" | "cloud-only";
  /** Max local model download budget in megabytes. */
  localBudgetMB?: number;
  /** Allow escalation to a cloud provider. */
  cloudFallback?: boolean;
  /** Minimum structured-output confidence before escalating. 0..1 */
  confidenceThreshold?: number;
}

export interface AgentDefinition {
  identity: string;
  /** Extra grounding instructions. Kept short: this is not a system-prompt product. */
  instructions?: string;
  knowledge?: KnowledgeSource[];
  context?: ContextResolver;
  actions: ActionMap;
  models?: ModelPolicy;
  /**
   * Refuse to answer from model memory when no action result and no
   * knowledge chunk grounds the answer. Defaults to true.
   */
  groundedOnly?: boolean;
  /**
   * How many safe actions may run in one turn while gathering an answer.
   *
   * 1 (the default) means a single action, then answer. Higher values let the
   * runtime fetch what it is missing — "what depth, and is there a warning?"
   * needs two lookups. Only "auto" server actions ever chain: anything
   * requiring confirmation stops the turn and asks, and a client action hands
   * back to the browser. This is a bounded gathering loop, not an autonomous
   * agent: no self-set goals, no capabilities beyond those registered, and a
   * hard step ceiling.
   */
  maxSteps?: number;
}

export interface Agent extends AgentDefinition {
  readonly __brand: "agent-runtime/agent";
  actionList: ActionDefinition[];
  models: Required<ModelPolicy>;
  groundedOnly: boolean;
  maxSteps: number;
}

/* ------------------------------------------------------------------ *
 * Conversation
 * ------------------------------------------------------------------ */

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}
