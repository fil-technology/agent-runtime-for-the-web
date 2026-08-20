import type { ZodError, ZodType } from "zod";
import { describeSchema } from "./schema.js";

export type AgentErrorCode =
  | "UNKNOWN_ACTION"
  | "INVALID_ACTION_INPUT"
  | "ACTION_DISABLED"
  | "CONFIRMATION_REQUIRED"
  | "NO_PROVIDER"
  | "MODEL_OUTPUT_INVALID"
  | "ACTION_FAILED"
  | "CONFIG_INVALID"
  | "UNGROUNDED";

/**
 * Errors are developer-facing documentation. Every message says what
 * happened, what was expected, what was received and what to change.
 */
export class AgentError extends Error {
  readonly code: AgentErrorCode;
  readonly details: Record<string, unknown>;
  readonly hint?: string;

  constructor(
    code: AgentErrorCode,
    message: string,
    options: { details?: Record<string, unknown>; hint?: string } = {}
  ) {
    super(options.hint ? `${message}\n\nHint: ${options.hint}` : message);
    this.name = "AgentError";
    this.code = code;
    this.details = options.details ?? {};
    if (options.hint) this.hint = options.hint;
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
      hint: this.hint,
    };
  }
}

function fmt(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

export function unknownActionError(
  name: string,
  available: string[]
): AgentError {
  const suggestion = closest(name, available);
  return new AgentError(
    "UNKNOWN_ACTION",
    [
      `Agent attempted action "${name}", which is not registered.`,
      ``,
      `Registered actions:`,
      available.length
        ? available.map((a) => `  ${a}`).join("\n")
        : "  (none)",
    ].join("\n"),
    {
      details: { name, available },
      hint: suggestion
        ? `Did you mean "${suggestion}"? Actions are only visible to the model when registered in defineAgent({ actions }) and not set to permission: "disabled".`
        : `Register the action in defineAgent({ actions }) to make it available.`,
    }
  );
}

export function invalidActionInputError(
  actionName: string,
  schema: ZodType<any>,
  received: unknown,
  error: ZodError,
  contextKeys: string[]
): AgentError {
  const missing = error.issues
    .filter((i) => i.code === "invalid_type" && (i as any).received === "undefined")
    .map((i) => i.path.join("."));

  const lines = [
    `Agent attempted action "${actionName}".`,
    ``,
    `Expected input:`,
    describeSchema(schema),
    ``,
    `Received:`,
    fmt(received),
    ``,
    ...error.issues.map(
      (i) => `${i.path.length ? i.path.join(".") : "(root)"}: ${i.message}`
    ),
  ];

  const hint = missing.length
    ? `Missing required field${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}. ` +
      `Either expose ${missing
        .map((m) => `"${m}"`)
        .join(", ")} through agent context (available context keys: ${
        contextKeys.length ? contextKeys.join(", ") : "none"
      }) and map it with action({ fillFromContext: { ${missing[0]}: "<contextKey>" } }), ` +
      `or make the model supply it by describing it in the action description.`
    : `Tighten the action description so the model produces values matching the schema, or relax the schema.`;

  return new AgentError("INVALID_ACTION_INPUT", lines.join("\n"), {
    details: { actionName, received, issues: error.issues },
    hint,
  });
}

export function actionDisabledError(actionName: string): AgentError {
  return new AgentError(
    "ACTION_DISABLED",
    `Action "${actionName}" is disabled by the permission engine and cannot be executed.`,
    {
      details: { actionName },
      hint: `permission: "disabled" removes the action from the model's capability surface entirely. If a user should be able to run it, return "auto" or "confirm" from the permission resolver.`,
    }
  );
}

export function confirmationRequiredError(actionName: string): AgentError {
  return new AgentError(
    "CONFIRMATION_REQUIRED",
    `Action "${actionName}" requires explicit user confirmation and was not confirmed.`,
    {
      details: { actionName },
      hint: `The runtime proposes; the user authorizes. Send a { kind: "confirm", approved: true } request carrying the proposal, or lower the permission to "auto" if the action is genuinely safe.`,
    }
  );
}

export function noProviderError(task: string, tried: string[]): AgentError {
  return new AgentError(
    "NO_PROVIDER",
    [
      `No model provider was able to handle stage "${task}".`,
      tried.length ? `Tried: ${tried.join(", ")}` : `No providers registered.`,
    ].join("\n"),
    {
      details: { task, tried },
      hint: `Register a provider (e.g. createFakeProvider() for tests, createLocalProvider() in the browser, or createAnthropicProvider() on the server) and make sure models.cloudFallback is enabled if local inference is unavailable.`,
    }
  );
}

export function modelOutputInvalidError(
  providerId: string,
  raw: string,
  reason: string
): AgentError {
  return new AgentError(
    "MODEL_OUTPUT_INVALID",
    [
      `Provider "${providerId}" returned output that did not match the required schema.`,
      ``,
      `Reason: ${reason}`,
      ``,
      `Raw output:`,
      raw.slice(0, 2000),
    ].join("\n"),
    {
      details: { providerId, reason },
      hint: `Structured output is validated before it can reach the permission engine. Small models often need a smaller schema: reduce the number of fields, or let the runtime fill fields from context.`,
    }
  );
}

export function configError(message: string, hint?: string): AgentError {
  return new AgentError("CONFIG_INVALID", message, hint ? { hint } : {});
}

function closest(name: string, options: string[]): string | undefined {
  let best: string | undefined;
  let bestScore = Infinity;
  const target = name.toLowerCase();
  for (const option of options) {
    const score = distance(target, option.toLowerCase());
    if (score < bestScore) {
      bestScore = score;
      best = option;
    }
  }
  return bestScore <= Math.max(3, target.length / 2) ? best : undefined;
}

function distance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d: number[] = new Array(rows * cols).fill(0);
  for (let i = 0; i < rows; i++) d[i * cols] = i;
  for (let j = 0; j < cols; j++) d[j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i * cols + j] = Math.min(
        d[(i - 1) * cols + j]! + 1,
        d[i * cols + j - 1]! + 1,
        d[(i - 1) * cols + j - 1]! + cost
      );
    }
  }
  return d[rows * cols - 1]!;
}
