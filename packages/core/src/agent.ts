import type {
  Agent,
  AgentDefinition,
  ActionDefinition,
  KnowledgeChunk,
  KnowledgeSource,
  ModelPolicy,
} from "./types.js";
import { configError } from "./errors.js";

const DEFAULT_MODELS: Required<ModelPolicy> = {
  strategy: "auto",
  localBudgetMB: 400,
  cloudFallback: true,
  confidenceThreshold: 0.55,
};

/**
 * defineAgent() is the entire integration surface for an application.
 * It is data, not behaviour: it can be inspected, diffed and generated.
 */
export function defineAgent(definition: AgentDefinition): Agent {
  if (!definition.identity) {
    throw configError(
      `defineAgent({ identity }) is required.`,
      `Use the product's own name, e.g. "Acme Assistant". It appears in the chat UI and grounds the model's self-description.`
    );
  }

  const actionList: ActionDefinition[] = [];
  for (const [name, action] of Object.entries(definition.actions ?? {})) {
    if (!action || typeof action !== "object" || !("input" in action)) {
      throw configError(
        `defineAgent({ actions: { ${name} } }) is not an action.`,
        `Wrap it: ${name}: action({ description, permission, input, execute }) — or clientAction({...}) for browser-side behaviour.`
      );
    }
    if (action.side === "server" && !action.execute) {
      throw configError(
        `Action "${name}" is a server action without an execute() implementation.`,
        `Add execute(input, ctx), or declare it with clientAction() if it runs in the browser.`
      );
    }
    for (const [field, key] of Object.entries(action.fillFromContext ?? {})) {
      if (typeof key !== "string") {
        throw configError(
          `Action "${name}" has an invalid fillFromContext entry for "${field}".`,
          `fillFromContext maps an input field to a context key: { projectId: "currentProjectId" }.`
        );
      }
    }
    action.name = name;
    actionList.push(action);
  }

  return {
    ...definition,
    __brand: "agent-runtime/agent",
    actionList,
    models: { ...DEFAULT_MODELS, ...(definition.models ?? {}) },
    groundedOnly: definition.groundedOnly ?? true,
    // Bounded on purpose, and low by default: chaining is a capability the
    // application opts into, never something the runtime assumes.
    maxSteps: Math.max(1, Math.min(definition.maxSteps ?? 1, 5)),
  };
}

/** Build-time documentation source. Loaded on the server. */
export function docs(dir: string, options: { extensions?: string[] } = {}): KnowledgeSource {
  return { kind: "docs", dir, extensions: options.extensions ?? [".md", ".mdx", ".txt"] };
}

/** Inline knowledge, safe in any runtime. */
export function inline(chunks: Array<Omit<KnowledgeChunk, "source"> & { source?: string }>): KnowledgeSource {
  return {
    kind: "inline",
    chunks: chunks.map((c) => ({ ...c, source: c.source ?? "inline" })),
  };
}
