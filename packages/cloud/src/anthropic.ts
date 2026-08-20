import {
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

export interface AnthropicProviderOptions {
  apiKey?: string;
  /** Defaults to Claude Opus 5. */
  model?: string;
  /** Stages this provider is allowed to serve. */
  tasks?: ModelTask[];
  maxTokens?: number;
  /**
   * Reasoning effort per stage, sent as output_config.effort.
   * Left unset by default so the request shape stays valid on older SDK and
   * API versions; set it when you want routing cheap and explanations careful.
   */
  effort?: Partial<Record<ModelTask, "low" | "medium" | "high" | "xhigh" | "max">>;
  id?: string;
}

const STRUCTURED_TOOL = "emit_result";

/**
 * Anthropic cloud provider.
 *
 * Structured output is produced with a single forced tool call: the schema is
 * the tool's input schema, so the model is constrained by the API rather than
 * by prompt discipline, and the runtime still validates the result with zod
 * before anything downstream sees it.
 */
export function createAnthropicProvider(
  options: AnthropicProviderOptions = {}
): ModelProvider {
  const model = options.model ?? "claude-opus-5";
  const id = options.id ?? `cloud/anthropic:${model}`;
  const apiKey = options.apiKey ?? readEnv("ANTHROPIC_API_KEY");
  let clientPromise: Promise<any> | undefined;
  let unavailable: string | undefined = apiKey
    ? undefined
    : "ANTHROPIC_API_KEY is not set. Set it, or pass createAnthropicProvider({ apiKey }).";

  async function client(): Promise<any> {
    clientPromise ??= (async () => {
      try {
        const { default: Anthropic } = await import("@anthropic-ai/sdk");
        return new Anthropic({ apiKey });
      } catch (error) {
        unavailable =
          `@anthropic-ai/sdk is not installed. Run: pnpm add @anthropic-ai/sdk\n(${(error as Error).message})`;
        throw new Error(unavailable);
      }
    })();
    return clientPromise;
  }

  const outputConfig = (task: ModelTask) => {
    const effort = options.effort?.[task];
    return effort ? { output_config: { effort } } : {};
  };

  return {
    id,

    async capabilities(): Promise<ModelCapabilities> {
      return {
        id,
        label: `Anthropic ${model}`,
        tier: "cloud",
        structuredOutput: "native",
        streaming: true,
        quality: 0.95,
        privacy: "third-party",
        available: !unavailable,
        unavailableReason: unavailable,
        maxInputTokens: 200_000,
        tasks: options.tasks ?? ["route", "extract", "explain", "answer"],
      };
    },

    async generate(input: GenerateInput): Promise<GenerateResult> {
      const anthropic = await client();
      const response = await anthropic.messages.create({
        model,
        max_tokens: input.maxTokens ?? options.maxTokens ?? 1024,
        ...outputConfig(input.task),
        ...(input.system ? { system: input.system } : {}),
        messages: [{ role: "user", content: input.prompt }],
      });
      const text = (response.content ?? [])
        .filter((block: any) => block.type === "text")
        .map((block: any) => block.text)
        .join("");
      return { text, providerId: id, confidence: 1 };
    },

    async *generateStream(input: GenerateInput) {
      const anthropic = await client();
      const stream = anthropic.messages.stream({
        model,
        max_tokens: input.maxTokens ?? options.maxTokens ?? 1024,
        ...outputConfig(input.task),
        ...(input.system ? { system: input.system } : {}),
        messages: [{ role: "user", content: input.prompt }],
      });
      for await (const event of stream) {
        if (
          event.type === "content_block_delta" &&
          event.delta?.type === "text_delta" &&
          event.delta.text
        ) {
          yield event.delta.text as string;
        }
      }
    },

    async generateStructured<T>(
      input: StructuredGenerateInput<T>
    ): Promise<StructuredResult<T>> {
      const anthropic = await client();
      const schema = toJsonSchema(input.schema as ZodTypeAny);
      const response = await anthropic.messages.create({
        model,
        max_tokens: input.maxTokens ?? 1024,
        ...outputConfig(input.task),
        ...(input.system ? { system: input.system } : {}),
        tools: [
          {
            name: STRUCTURED_TOOL,
            description:
              input.schemaName
                ? `Return the ${input.schemaName} result.`
                : "Return the structured result.",
            input_schema: schema,
          },
        ],
        tool_choice: { type: "tool", name: STRUCTURED_TOOL },
        messages: [{ role: "user", content: input.prompt }],
      });

      const call = (response.content ?? []).find(
        (block: any) => block.type === "tool_use" && block.name === STRUCTURED_TOOL
      );
      if (!call) {
        throw modelOutputInvalidError(
          id,
          JSON.stringify(response.content ?? []),
          "the model did not call the structured-output tool"
        );
      }

      const parsed = input.schema.safeParse(call.input);
      if (!parsed.success) {
        throw modelOutputInvalidError(
          id,
          JSON.stringify(call.input),
          parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
        );
      }

      return {
        value: parsed.data,
        providerId: id,
        // A frontier model under a forced schema is the runtime's last resort:
        // reporting high confidence stops the router escalating past it.
        confidence: 0.95,
        raw: JSON.stringify(call.input),
      };
    },
  };
}

function readEnv(name: string): string | undefined {
  return (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env?.[name];
}
