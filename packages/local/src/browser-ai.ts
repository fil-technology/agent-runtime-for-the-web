import {
  extractJson,
  modelOutputInvalidError,
  describeSchema,
  type GenerateInput,
  type GenerateResult,
  type ModelCapabilities,
  type ModelProvider,
  type ModelTask,
  type StructuredGenerateInput,
  type StructuredResult,
} from "@agent-runtime/core";
import type { ZodTypeAny } from "zod";

interface PromptApiSession {
  prompt(input: string): Promise<string>;
  promptStreaming?(input: string): ReadableStream<string>;
  destroy?(): void;
}

interface PromptApi {
  availability?(): Promise<string>;
  capabilities?(): Promise<{ available?: string }>;
  create(options?: Record<string, unknown>): Promise<PromptApiSession>;
}

function findPromptApi(): PromptApi | undefined {
  const scope = globalThis as Record<string, any>;
  return scope.LanguageModel ?? scope.ai?.languageModel ?? scope.window?.ai?.languageModel;
}

export interface BrowserAiOptions {
  tasks?: ModelTask[];
  temperature?: number;
  id?: string;
}

/**
 * The browser's own built-in model, where the platform provides one
 * (Chrome's Prompt API). Free, on-device, and nothing to download — so it is
 * preferred over a model the runtime would have to ship itself.
 */
export function createBrowserAiProvider(options: BrowserAiOptions = {}): ModelProvider {
  const id = options.id ?? "browser/prompt-api";
  let sessionPromise: Promise<PromptApiSession> | undefined;
  let unavailable: string | undefined;
  let ready = false;

  async function session(): Promise<PromptApiSession> {
    const api = findPromptApi();
    if (!api) throw new Error("This browser does not expose a built-in language model.");
    sessionPromise ??= api
      .create({ temperature: options.temperature ?? 0, topK: 1 })
      .then((session) => {
        ready = true;
        return session;
      });
    return sessionPromise;
  }

  return {
    id,

    async capabilities(): Promise<ModelCapabilities> {
      const api = findPromptApi();
      let available = false;
      if (api) {
        try {
          const status =
            (await api.availability?.()) ??
            (await api.capabilities?.())?.available ??
            "unavailable";
          available = status === "available" || status === "readily" || status === "downloadable";
          if (!available) unavailable = `Browser model status: ${status}`;
        } catch (error) {
          unavailable = (error as Error).message;
        }
      } else {
        unavailable = "No built-in browser model (window.LanguageModel is undefined).";
      }
      return {
        id,
        label: "Browser built-in model",
        tier: "browser",
        structuredOutput: "prompted",
        streaming: true,
        quality: 0.6,
        privacy: "on-device",
        available,
        unavailableReason: unavailable,
        // The browser may still be provisioning its model on first use.
        readyNow: ready,
        approxSizeMB: 0,
        tasks: options.tasks ?? ["route", "extract", "explain", "answer"],
      };
    },

    async preload() {
      await session().catch(() => undefined);
    },

    async generate(input: GenerateInput): Promise<GenerateResult> {
      const active = await session();
      const text = await active.prompt(promptWithSystem(input));
      return { text: text.trim(), providerId: id, confidence: 1 };
    },

    async *generateStream(input: GenerateInput) {
      const active = await session();
      if (!active.promptStreaming) {
        yield (await active.prompt(promptWithSystem(input))).trim();
        return;
      }
      const stream = active.promptStreaming(promptWithSystem(input));
      const reader = stream.getReader();
      let previous = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        // Some implementations stream cumulative text; emit only the delta.
        const chunk = typeof value === "string" ? value : String(value ?? "");
        if (chunk.startsWith(previous)) {
          yield chunk.slice(previous.length);
          previous = chunk;
        } else {
          yield chunk;
          previous += chunk;
        }
      }
    },

    async generateStructured<T>(
      input: StructuredGenerateInput<T>
    ): Promise<StructuredResult<T>> {
      const active = await session();
      const prompt = [
        promptWithSystem(input),
        "",
        "Reply with JSON matching this shape, and nothing else:",
        describeSchema(input.schema as ZodTypeAny),
      ].join("\n");
      const raw = await active.prompt(prompt);
      let value: unknown;
      try {
        value = extractJson(raw);
      } catch (error) {
        throw modelOutputInvalidError(id, raw, (error as Error).message);
      }
      const parsed = input.schema.safeParse(value);
      if (!parsed.success) {
        return { value: value as T, providerId: id, confidence: 0, raw };
      }
      return { value: parsed.data, providerId: id, confidence: 0.7, raw };
    },
  };
}

function promptWithSystem(input: GenerateInput): string {
  return input.system ? `${input.system}\n\n${input.prompt}` : input.prompt;
}
