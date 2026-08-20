import {
  modelOutputInvalidError,
  type GenerateInput,
  type GenerateResult,
  type ModelCapabilities,
  type ModelProvider,
  type ModelTask,
  type ProviderTier,
  type StructuredGenerateInput,
  type StructuredResult,
} from "@agent-runtime/core";

/**
 * Any model reachable through the Vercel AI SDK.
 *
 * The AI SDK solves provider integration — 25+ vendors behind one interface,
 * with `generateObject` giving schema-constrained output from the same zod
 * schemas this runtime already uses. That is a large amount of adapter code we
 * have no reason to write ourselves.
 *
 * What it does not solve, and what stays here, is everything above the model:
 * the capability surface, the permission engine, confirmation, grounding and
 * the trace. The model layer is an implementation detail (Rule 1); this makes
 * that literally true.
 *
 *   import { anthropic } from "@ai-sdk/anthropic";
 *
 *   createAiSdkProvider({ model: anthropic("claude-opus-5") })
 */
export interface AiSdkProviderOptions {
  /** An AI SDK LanguageModel, e.g. anthropic("claude-opus-5"). */
  model: unknown;
  id?: string;
  label?: string;
  tier?: ProviderTier;
  quality?: number;
  tasks?: ModelTask[];
  maxTokens?: number;
  /** Passed straight through, e.g. { thinking: { type: "adaptive" } }. */
  providerOptions?: Record<string, unknown>;
}

export function createAiSdkProvider(options: AiSdkProviderOptions): ModelProvider {
  const named = options.model as { modelId?: string; provider?: string };
  const id =
    options.id ?? `cloud/ai-sdk:${named?.provider ?? "model"}:${named?.modelId ?? "unknown"}`;
  const tier = options.tier ?? "cloud";
  let unavailable: string | undefined;

  async function sdk(): Promise<any> {
    try {
      return await import("ai");
    } catch (error) {
      unavailable = `The "ai" package is not installed. Run: pnpm add ai\n(${(error as Error).message})`;
      throw new Error(unavailable);
    }
  }

  const shared = (input: GenerateInput) => ({
    model: options.model as never,
    maxOutputTokens: input.maxTokens ?? options.maxTokens ?? 1024,
    temperature: input.temperature,
    abortSignal: input.signal,
    ...(input.system ? { system: input.system } : {}),
    ...(options.providerOptions
      ? { providerOptions: options.providerOptions as never }
      : {}),
  });

  return {
    id,

    async capabilities(): Promise<ModelCapabilities> {
      return {
        id,
        label: options.label ?? `${named?.provider ?? "AI SDK"} ${named?.modelId ?? ""}`.trim(),
        tier,
        structuredOutput: "native",
        streaming: true,
        quality: options.quality ?? 0.95,
        privacy: tier === "cloud" ? "third-party" : "on-device",
        available: !unavailable,
        unavailableReason: unavailable,
        tasks: options.tasks ?? ["route", "extract", "explain", "answer"],
      };
    },

    async generate(input: GenerateInput): Promise<GenerateResult> {
      const { generateText } = await sdk();
      const result = await generateText({ ...shared(input), prompt: input.prompt });
      return { text: result.text ?? "", providerId: id, confidence: 1 };
    },

    async *generateStream(input: GenerateInput) {
      const { streamText } = await sdk();
      const result = streamText({ ...shared(input), prompt: input.prompt });
      for await (const delta of result.textStream) yield delta as string;
    },

    async generateStructured<T>(
      input: StructuredGenerateInput<T>
    ): Promise<StructuredResult<T>> {
      const { generateObject } = await sdk();
      // The schema this runtime validates with is the schema the model is
      // constrained by — no second representation to drift out of sync.
      const result = await generateObject({
        ...shared(input),
        schema: input.schema as never,
        prompt: input.prompt,
      });

      const parsed = input.schema.safeParse(result.object);
      if (!parsed.success) {
        throw modelOutputInvalidError(
          id,
          JSON.stringify(result.object),
          parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
        );
      }
      return {
        value: parsed.data,
        providerId: id,
        confidence: 0.95,
        raw: JSON.stringify(result.object),
      };
    },
  };
}
