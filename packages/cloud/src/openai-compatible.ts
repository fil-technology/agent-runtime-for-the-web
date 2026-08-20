import {
  extractJson,
  modelOutputInvalidError,
  toJsonSchema,
  type GenerateInput,
  type GenerateResult,
  type ModelCapabilities,
  type ModelProvider,
  type ModelTask,
  type StructuredGenerateInput,
  type StructuredResult,
} from "@agent-runtime/core";
import type { ZodTypeAny } from "zod";

export interface OpenAiCompatibleOptions {
  /** e.g. https://api.openai.com/v1, an AI gateway, or http://localhost:11434/v1 */
  baseUrl: string;
  apiKey?: string;
  model: string;
  id?: string;
  label?: string;
  tier?: "cloud" | "local";
  quality?: number;
  tasks?: ModelTask[];
  maxTokens?: number;
  headers?: Record<string, string>;
}

/**
 * Any OpenAI-compatible chat completions endpoint: OpenAI, an AI gateway, a
 * self-hosted server, Ollama, LM Studio.
 *
 * This exists mostly to keep the runtime honest — the model layer must not be
 * shaped around one vendor's API.
 */
export function createOpenAiCompatibleProvider(
  options: OpenAiCompatibleOptions
): ModelProvider {
  const id = options.id ?? `cloud/openai-compatible:${options.model}`;
  const tier = options.tier ?? "cloud";

  async function chat(body: Record<string, unknown>, signal?: AbortSignal) {
    const response = await fetch(`${options.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {}),
        ...options.headers,
      },
      body: JSON.stringify({ model: options.model, ...body }),
      signal,
    });
    if (!response.ok) {
      throw new Error(
        `${id} responded ${response.status}: ${(await response.text()).slice(0, 300)}`
      );
    }
    return response.json() as Promise<any>;
  }

  return {
    id,

    async capabilities(): Promise<ModelCapabilities> {
      return {
        id,
        label: options.label ?? options.model,
        tier,
        structuredOutput: "json-mode",
        streaming: false,
        quality: options.quality ?? 0.8,
        privacy: tier === "cloud" ? "third-party" : "on-device",
        available: true,
        tasks: options.tasks ?? ["route", "extract", "explain", "answer"],
      };
    },

    async generate(input: GenerateInput): Promise<GenerateResult> {
      const body = await chat(
        {
          max_tokens: input.maxTokens ?? options.maxTokens ?? 512,
          temperature: input.temperature ?? 0.2,
          messages: messagesFor(input),
        },
        input.signal
      );
      return {
        text: body.choices?.[0]?.message?.content ?? "",
        providerId: id,
        confidence: 1,
      };
    },

    async generateStructured<T>(
      input: StructuredGenerateInput<T>
    ): Promise<StructuredResult<T>> {
      const schema = toJsonSchema(input.schema as ZodTypeAny);
      const body = await chat(
        {
          max_tokens: input.maxTokens ?? 512,
          temperature: 0,
          messages: messagesFor(input),
          response_format: {
            type: "json_schema",
            json_schema: {
              name: input.schemaName ?? "result",
              strict: true,
              schema,
            },
          },
        },
        input.signal
      );

      const raw = body.choices?.[0]?.message?.content ?? "";
      let value: unknown;
      try {
        value = extractJson(raw);
      } catch (error) {
        throw modelOutputInvalidError(id, raw, (error as Error).message);
      }
      const parsed = input.schema.safeParse(value);
      if (!parsed.success) {
        throw modelOutputInvalidError(
          id,
          raw,
          parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
        );
      }
      return { value: parsed.data, providerId: id, confidence: 0.9, raw };
    },
  };
}

function messagesFor(input: GenerateInput) {
  return [
    ...(input.system ? [{ role: "system", content: input.system }] : []),
    { role: "user", content: input.prompt },
  ];
}
