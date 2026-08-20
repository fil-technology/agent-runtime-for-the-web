import type { ZodType } from "zod";
import type {
  ActionDefinition,
  ActionExecutionContext,
  Choice,
  AgentContext,
  PermissionSpec,
} from "./types.js";
import { configError } from "./errors.js";
import { toJsonSchema } from "./schema.js";

export interface ServerActionSpec<I, O> {
  description: string;
  permission: PermissionSpec<I>;
  input: ZodType<I>;
  execute: (input: I, ctx: ActionExecutionContext) => O | Promise<O>;
  fillFromContext?: Record<string, string>;
  confirmLabel?: string;
  describe?: (input: I, context: AgentContext) => string;
  examples?: string[];
  clarify?: (missing: string[], context: AgentContext) => string;
  /** Where the candidates for a field come from; see ActionDefinition.resolve. */
  resolve?: Record<string, (ctx: ActionExecutionContext) => Choice[] | Promise<Choice[]>>;
  authoritative?: boolean;
}

export interface ClientActionSpec<I> {
  description: string;
  permission: PermissionSpec<I>;
  input: ZodType<I>;
  fillFromContext?: Record<string, string>;
  confirmLabel?: string;
  describe?: (input: I, context: AgentContext) => string;
  examples?: string[];
  clarify?: (missing: string[], context: AgentContext) => string;
  /** Where the candidates for a field come from; see ActionDefinition.resolve. */
  resolve?: Record<string, (ctx: ActionExecutionContext) => Choice[] | Promise<Choice[]>>;
}

/**
 * A server action. Executes inside the host application's own authenticated
 * code path. The runtime never sees credentials, and the permission engine is
 * *in addition to* the application's normal authorization.
 */
export function action<I, O>(spec: ServerActionSpec<I, O>): ActionDefinition<I, O> {
  validate(spec.description, spec.input, "action");
  return {
    name: "",
    side: "server",
    description: spec.description,
    permission: spec.permission,
    input: spec.input,
    execute: spec.execute,
    fillFromContext: spec.fillFromContext,
    confirmLabel: spec.confirmLabel,
    describe: spec.describe,
    examples: spec.examples,
    clarify: spec.clarify,
    resolve: spec.resolve,
    authoritative: spec.authoritative ?? false,
  };
}

/**
 * A client action. Executes in the browser (navigation, opening a modal,
 * highlighting an element). It has no server implementation, so it can never
 * touch secrets or the database.
 */
export function clientAction<I>(spec: ClientActionSpec<I>): ActionDefinition<I, void> {
  validate(spec.description, spec.input, "clientAction");
  return {
    name: "",
    side: "client",
    description: spec.description,
    permission: spec.permission,
    input: spec.input,
    fillFromContext: spec.fillFromContext,
    confirmLabel: spec.confirmLabel,
    describe: spec.describe,
    examples: spec.examples,
    clarify: spec.clarify,
    resolve: spec.resolve,
    authoritative: false,
  };
}

function validate(description: string, input: ZodType<any>, fn: string) {
  if (!description || description.trim().length < 3) {
    throw configError(
      `${fn}({ description }) is required and is what the model routes on.`,
      `Write it from the user's point of view, e.g. "Rename a project the user owns".`
    );
  }
  try {
    toJsonSchema(input as any);
  } catch (error) {
    throw configError(
      `${fn}({ input }) schema is not usable as a model-facing schema.\n${
        (error as Error).message
      }`,
      `Keep action inputs to flat objects of primitives, enums and small arrays. Anything the model cannot reliably produce should come from context instead.`
    );
  }
}
