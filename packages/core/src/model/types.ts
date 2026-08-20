import type { ZodType } from "zod";

/**
 * Pipeline stages. Stages are separate so that a tiny local model can do the
 * constrained work (classification, extraction) while a larger model is only
 * involved when it is actually needed.
 */
export type ModelTask =
  | "route" // which action, or answer, or clarify
  | "extract" // fill an action's input schema
  | "explain" // rewrite supplied facts into natural language
  | "answer"; // grounded answer from retrieved knowledge

export type ProviderTier = "local" | "browser" | "cloud";

export interface ModelCapabilities {
  id: string;
  label: string;
  tier: ProviderTier;
  /** How the provider produces schema-conformant output. */
  structuredOutput: "native" | "json-mode" | "prompted" | "none";
  streaming: boolean;
  /** Coarse ordering signal only. Not a benchmark. */
  quality: number;
  privacy: "on-device" | "third-party";
  available: boolean;
  unavailableReason?: string;
  /**
   * Whether this provider can answer *right now*, as opposed to eventually.
   *
   * A model that still has 200MB to download is available but not ready, and
   * making someone wait for it when another provider could have answered
   * instantly is the difference between a product that feels fast and one that
   * feels broken. Defaults to true.
   */
  readyNow?: boolean;
  /** Load progress 0..1, for providers that have to fetch weights. */
  loadProgress?: number;
  approxSizeMB?: number;
  maxInputTokens?: number;
  /** Stages this provider is willing to serve. */
  tasks: ModelTask[];
}

/**
 * Structured description of the stage, alongside the rendered prompt.
 *
 * Real language-model providers ignore this and use `prompt`. Deterministic
 * providers (tests, rule-based routing, evaluation baselines) use it so they
 * do not have to parse prose back out of a prompt.
 */
export interface StageHints {
  message?: string;
  context?: Record<string, unknown>;
  actions?: Array<{ name: string; description: string; examples?: string[] }>;
  actionName?: string;
  /**
   * How this action describes itself — its description and examples.
   *
   * Words the action already uses are not evidence about its arguments:
   * "add a new member to my team" contains "member", which is also a role,
   * but the sentence is how you *ask* for the action, not a choice of role.
   */
  actionPhrases?: string[];
  /** Actions already tried this turn, so a second step looks somewhere new. */
  attempted?: string[];
  /**
   * The previous choice could not be completed at all. This is a retry after a
   * dead end, not an attempt to gather more, so route normally.
   */
  retrying?: boolean;
  prefilled?: Record<string, unknown>;
  facts?: string;
  /** Deterministic, application-authored one-line results. */
  summaries?: string[];
  /** Retrieved documentation text, best match first. */
  knowledge?: string[];
  hasKnowledge?: boolean;
}

export interface GenerateInput {
  task: ModelTask;
  stage?: StageHints;
  system?: string;
  prompt: string;
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}

export interface GenerateResult {
  text: string;
  providerId: string;
  /** 0..1 self-reported. Providers that cannot estimate report 1 for text. */
  confidence?: number;
}

export interface StructuredGenerateInput<T> extends GenerateInput {
  schema: ZodType<T>;
  schemaName?: string;
}

export interface StructuredResult<T> {
  value: T;
  providerId: string;
  /** 0..1. Drives escalation. */
  confidence: number;
  raw: string;
}

/**
 * The only thing the runtime knows about a model.
 *
 * Rule 1: the model is replaceable. Nothing above this interface may name a
 * specific model family.
 */
export interface ModelProvider {
  readonly id: string;
  capabilities(): Promise<ModelCapabilities>;
  generate(input: GenerateInput): Promise<GenerateResult>;
  generateStructured<T>(input: StructuredGenerateInput<T>): Promise<StructuredResult<T>>;
  /** Optional token streaming for the explain/answer stages. */
  generateStream?(input: GenerateInput): AsyncIterable<string>;
  /** Optional warm-up (model download, worker boot). */
  preload?(): Promise<void>;
}
