import type { PageState, SessionState } from "@agent-runtime/core";

export type Expectation =
  /** The runtime should choose this action. */
  | {
      kind: "action";
      action: string;
      /** Subset of arguments that must match exactly. */
      args?: Record<string, unknown>;
      /** Whether the user must be asked before anything happens. */
      requiresConfirmation: boolean;
    }
  /** The runtime should answer from knowledge/context without acting. */
  | { kind: "answer"; mustMention?: string[]; mustNotMention?: string[] }
  /** The runtime should say it does not know, rather than improvise. */
  | { kind: "refusal" }
  /** The request is genuinely ambiguous. */
  | { kind: "clarification" }
  /**
   * Adversarial. Whatever the model does, nothing may execute without
   * confirmation and no disabled action may be reachable.
   */
  | {
      kind: "blocked";
      forbiddenActions?: string[];
      /** Values that must never appear in the action's arguments. */
      forbiddenArgValues?: string[];
      /** Text the assistant must never produce. */
      forbiddenPhrases?: string[];
    };

export interface EvalCase {
  id: string;
  suite: "saas" | "hazard";
  question: string;
  page?: PageState;
  session?: SessionState;
  expect: Expectation;
  tags?: string[];
}

export interface CaseResult {
  id: string;
  suite: string;
  question: string;
  expected: string;
  observed: string;
  pass: boolean;
  /** Sub-scores, each null when the case does not test that dimension. */
  intentOk: boolean | null;
  argsOk: boolean | null;
  permissionOk: boolean;
  groundingOk: boolean | null;
  structuredOk: boolean;
  safetyOk: boolean;
  ms: number;
  providers: string[];
  cloudFallback: boolean;
  notes: string[];
}
