import { z, type ZodTypeAny } from "zod";
import type {
  ActionDefinition,
  Agent,
  AgentContext,
  KnowledgeChunk,
  ModelPolicy,
  Permission,
} from "./types.js";
import { toJsonSchema, type JsonSchema } from "./schema.js";
import { defineAgent } from "./agent.js";
import { configError } from "./errors.js";

/**
 * The serializable description of an agent: everything the model needs to be
 * taught about the product, and nothing the server must keep to itself.
 *
 * execute() implementations, permission resolvers and the context resolver
 * never cross this boundary.
 */
export interface ActionManifest {
  name: string;
  description: string;
  side: "server" | "client";
  /** "dynamic" means the server decides; clients must treat it as "confirm". */
  permission: Permission | "dynamic";
  inputSchema: JsonSchema;
  fillFromContext?: Record<string, string>;
  confirmLabel?: string;
  examples?: string[];
}

export interface AgentManifest {
  identity: string;
  instructions?: string;
  actions: ActionManifest[];
  models: Required<ModelPolicy>;
  groundedOnly: boolean;
  /** Included only when the knowledge is safe to ship to the browser. */
  knowledge?: KnowledgeChunk[];
}

export function buildManifest(
  agent: Agent,
  options: { knowledge?: KnowledgeChunk[] } = {}
): AgentManifest {
  return {
    identity: agent.identity,
    ...(agent.instructions ? { instructions: agent.instructions } : {}),
    models: agent.models,
    groundedOnly: agent.groundedOnly,
    ...(options.knowledge ? { knowledge: options.knowledge } : {}),
    actions: agent.actionList.map((action) => ({
      name: action.name,
      description: action.description,
      side: action.side,
      permission:
        typeof action.permission === "function" ? "dynamic" : action.permission,
      inputSchema: toJsonSchema(action.input as ZodTypeAny),
      ...(action.fillFromContext ? { fillFromContext: action.fillFromContext } : {}),
      ...(action.confirmLabel ? { confirmLabel: action.confirmLabel } : {}),
      ...(action.examples ? { examples: action.examples } : {}),
    })),
  };
}

export type RemoteExecutor = (input: {
  action: string;
  arguments: Record<string, unknown>;
  context: AgentContext;
}) => Promise<unknown>;

export type ClientActionHandlers = Record<
  string,
  (input: any, ctx: { context: AgentContext }) => unknown | Promise<unknown>
>;

/**
 * Rebuilds a runnable agent from a manifest, for running the loop in the
 * browser.
 *
 * Two properties hold by construction:
 *  - server actions execute through the remote executor, so the server still
 *    performs schema validation, permission evaluation and authorization;
 *  - "dynamic" permissions degrade to "confirm", never to "auto".
 */
export function agentFromManifest(
  manifest: AgentManifest,
  options: { execute: RemoteExecutor; clientActions?: ClientActionHandlers }
): Agent {
  const actions: Record<string, ActionDefinition> = {};

  for (const entry of manifest.actions) {
    const input = jsonSchemaToZod(entry.inputSchema, `${entry.name}.input`);
    const permission: Permission =
      entry.permission === "dynamic" ? "confirm" : entry.permission;

    const base = {
      name: entry.name,
      description: entry.description,
      permission,
      input,
      fillFromContext: entry.fillFromContext,
      confirmLabel: entry.confirmLabel,
      examples: entry.examples,
      authoritative: false,
    };

    if (entry.side === "client") {
      const handler = options.clientActions?.[entry.name];
      actions[entry.name] = {
        ...base,
        side: "client",
        execute: handler
          ? async (args: unknown, ctx) => handler(args, { context: ctx.context })
          : undefined,
      };
    } else {
      actions[entry.name] = {
        ...base,
        side: "server",
        execute: async (args: Record<string, unknown>, ctx) =>
          options.execute({
            action: entry.name,
            arguments: args,
            context: ctx.context,
          }),
      };
    }
  }

  return defineAgent({
    identity: manifest.identity,
    instructions: manifest.instructions,
    actions,
    models: manifest.models,
    groundedOnly: manifest.groundedOnly,
    knowledge: manifest.knowledge?.length
      ? [{ kind: "inline", chunks: manifest.knowledge }]
      : [],
  });
}

/** Inverse of toJsonSchema(), over the same deliberately small subset. */
export function jsonSchemaToZod(schema: JsonSchema, path = "input"): ZodTypeAny {
  if (!schema || typeof schema !== "object") return z.unknown();
  if (Array.isArray(schema.enum)) {
    const values = schema.enum.filter((v: unknown) => typeof v === "string") as string[];
    if (values.length) return z.enum(values as [string, ...string[]]);
  }
  if ("const" in schema) return z.literal(schema.const);
  if (Array.isArray(schema.anyOf)) {
    const options = schema.anyOf.map((s: JsonSchema, i: number) =>
      jsonSchemaToZod(s, `${path}|${i}`)
    );
    if (options.length >= 2) {
      return z.union(options as [ZodTypeAny, ZodTypeAny, ...ZodTypeAny[]]);
    }
    return options[0] ?? z.unknown();
  }

  switch (schema.type) {
    case "string":
      return z.string();
    case "number":
    case "integer":
      return z.number();
    case "boolean":
      return z.boolean();
    case "array":
      return z.array(jsonSchemaToZod(schema.items ?? {}, `${path}[]`));
    case "object": {
      const properties = schema.properties ?? {};
      const required: string[] = schema.required ?? [];
      if (!Object.keys(properties).length && schema.additionalProperties) {
        return z.record(z.unknown());
      }
      const shape: Record<string, ZodTypeAny> = {};
      for (const [key, value] of Object.entries(properties)) {
        const field = jsonSchemaToZod(value as JsonSchema, `${path}.${key}`);
        shape[key] = required.includes(key) ? field : field.optional();
      }
      return z.object(shape);
    }
    case undefined:
      return z.unknown();
    default:
      throw configError(
        `Manifest schema at ${path} uses unsupported type "${String(schema.type)}".`,
        `Manifests are produced by buildManifest(). If you hand-wrote one, keep it to object/string/number/boolean/array/enum.`
      );
  }
}
