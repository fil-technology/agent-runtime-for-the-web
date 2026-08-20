import {
  describeSchema,
  extractJson,
  tokenize,
  type GenerateInput,
  type GenerateResult,
  type ModelCapabilities,
  type ModelProvider,
  type ModelTask,
  type StageHints,
  type StructuredGenerateInput,
  type StructuredResult,
} from "@agent-runtime/core";
import type { ZodTypeAny } from "zod";
import { createEngine, hasWebGpu, type ChatTurn, type Engine } from "./engine.js";

export interface LocalProviderOptions {
  /** Hugging Face model id, ONNX weights. */
  model?: string;
  /** Rough download size, checked against the agent's localBudgetMB. */
  approxSizeMB?: number;
  device?: "webgpu" | "wasm" | "auto";
  dtype?: string;
  /**
   * Stages this model is trusted with. Small models are good at choosing from
   * a list and filling a schema, and much weaker at prose.
   */
  tasks?: ModelTask[];
  label?: string;
  id?: string;
  useWorker?: boolean;
  /** Override where transformers.js is loaded from. */
  transformersUrl?: string;
  /** Serve weights from your own origin (R2/S3/CDN) instead of the hub. */
  weightsHost?: string;
  weightsPathTemplate?: string;
  /** Require WebGPU. Without it a 360M model is usable but slow. */
  requireWebGpu?: boolean;
  /**
   * Permit running under Node (onnxruntime-node, CPU). Off by default because
   * this provider exists to keep inference on the user's device; the
   * evaluation harness turns it on to benchmark the same code path headlessly.
   */
  allowNode?: boolean;
}

// Repos verified to serve ONNX weights. The onnx-community/SmolLM2-* mirrors
// do not exist and return 401, which is a silent hang if you never surface it.
const KNOWN_SIZES: Record<string, number> = {
  "HuggingFaceTB/SmolLM2-360M-Instruct": 280,
  "HuggingFaceTB/SmolLM2-135M-Instruct": 110,
  "onnx-community/Qwen2.5-0.5B-Instruct": 380,
  // Flat slugs used when the weights are self-hosted (uncompressed on the wire).
  "smollm2-360m": 372,
  "smollm2-135m": 176,
};

/**
 * A small model running in the browser.
 *
 * It is never asked to know the product or to reason freely. Each stage gets
 * the smallest possible question:
 *
 *   route   -> "reply with one name from this list"
 *   extract -> "fill these fields from this sentence"
 *   explain -> "rewrite these facts as a sentence"
 *
 * Confidence is reported honestly so the router can escalate instead of the
 * product quietly getting worse.
 */
export function createLocalProvider(options: LocalProviderOptions = {}): ModelProvider {
  const model = options.model ?? "HuggingFaceTB/SmolLM2-360M-Instruct";
  const id = options.id ?? `local/${model.split("/").pop()}`;
  const approxSizeMB = options.approxSizeMB ?? KNOWN_SIZES[model] ?? 300;
  let engine: Engine | undefined;
  let unavailable: string | undefined;

  const getEngine = (): Engine => {
    engine ??= createEngine({
      model,
      useWorker: options.useWorker ?? typeof Worker !== "undefined",
      device: options.device,
      dtype: options.dtype,
      transformersUrl: options.transformersUrl,
      weightsHost: options.weightsHost,
      weightsPathTemplate: options.weightsPathTemplate,
    });
    return engine;
  };

  return {
    id,

    async capabilities(): Promise<ModelCapabilities> {
      const inBrowser = typeof window !== "undefined" || typeof self !== "undefined";
      if (!inBrowser && !options.allowNode) {
        unavailable =
          "Local models run in the browser. Pass allowNode: true to benchmark them under Node.";
      }
      else if (options.requireWebGpu && !(await hasWebGpu())) {
        unavailable = "WebGPU is unavailable in this browser.";
      }
      const progress = engine?.progress;
      // A load that failed must not keep reporting "loading". Spinning forever
      // is the worst possible answer to "what is it doing?".
      const failed = progress?.status === "failed";
      return {
        id,
        label: options.label ?? `${model} (on-device)`,
        tier: "local",
        structuredOutput: "prompted",
        streaming: true,
        quality: approxSizeMB > 200 ? 0.35 : 0.2,
        privacy: "on-device",
        available: !unavailable && !failed,
        unavailableReason: unavailable ?? (failed ? progress?.detail : undefined),
        // Until the weights are resident this provider is a promise, not an
        // option. The router routes around it instead of making the user wait,
        // and picks it up on the next request once it is warm.
        readyNow: engine?.ready ?? false,
        loadProgress: progress?.fraction ?? 0,
        approxSizeMB,
        maxInputTokens: 2048,
        tasks: options.tasks ?? ["route", "extract", "explain", "answer"],
      };
    },

    async preload() {
      await getEngine().load();
    },

    async generate(input: GenerateInput): Promise<GenerateResult> {
      const text = await getEngine().generate(chat(input, explainSystem), {
        maxTokens: input.maxTokens ?? 120,
        temperature: input.temperature ?? 0,
      });
      return { text: clean(text), providerId: id, confidence: 1 };
    },

    /** Tokens reach the UI as they are produced, not when the answer is done. */
    async *generateStream(input: GenerateInput) {
      const queue: string[] = [];
      let notify: (() => void) | undefined;
      let finished = false;

      const done = getEngine()
        .generate(chat(input, explainSystem), {
          maxTokens: input.maxTokens ?? 120,
          temperature: input.temperature ?? 0,
          onDelta: (delta) => {
            queue.push(delta);
            notify?.();
          },
        })
        .finally(() => {
          finished = true;
          notify?.();
        });

      while (!finished || queue.length) {
        if (!queue.length) {
          await new Promise<void>((resolve) => {
            notify = resolve;
          });
          notify = undefined;
          continue;
        }
        yield queue.shift()!;
      }
      // Surface a generation failure rather than ending the stream silently.
      await done;
    },

    async generateStructured<T>(
      input: StructuredGenerateInput<T>
    ): Promise<StructuredResult<T>> {
      if (input.task === "route" && input.stage?.actions) {
        return routeLocally(id, getEngine(), input);
      }
      return extractLocally(id, getEngine(), input);
    },
  };
}

/* -------------------------------- routing -------------------------------- */

/**
 * Classification by name, not by JSON. A 360M model produces a bare label far
 * more reliably than a nested object, and the label is then matched against
 * the allow-list rather than trusted.
 */
async function routeLocally<T>(
  id: string,
  engine: Engine,
  input: StructuredGenerateInput<T>
): Promise<StructuredResult<T>> {
  const stage = input.stage as StageHints;
  const actions = stage.actions ?? [];
  const options = [...actions.map((a) => a.name), "ANSWER", "CLARIFY"];

  const prompt = [
    `Pick the single best option for the user's request.`,
    ``,
    `Options:`,
    ...actions.map((a) => `${a.name} — ${a.description}`),
    `ANSWER — the question is about documentation or the current page`,
    `CLARIFY — the request is too vague to act on`,
    ``,
    `Request: ${stage.message ?? ""}`,
    ``,
    `Reply with one option name and nothing else.`,
  ].join("\n");

  const raw = clean(
    await engine.generate(
      [
        { role: "system", content: "You are a router. You reply with exactly one label." },
        { role: "user", content: prompt },
      ],
      { maxTokens: 12, temperature: 0 }
    )
  );

  const match = matchOption(raw, options);
  let value: unknown;
  let confidence: number;

  if (!match) {
    value = { type: "clarification", question: "Could you say a bit more about that?" };
    confidence = 0.15;
  } else if (match.name === "ANSWER") {
    value = { type: "answer" };
    confidence = match.exact ? 0.7 : 0.45;
  } else if (match.name === "CLARIFY") {
    value = { type: "clarification", question: "Could you say a bit more about that?" };
    confidence = match.exact ? 0.6 : 0.4;
  } else {
    value = { type: "action", action: match.name };
    confidence = match.exact ? 0.75 : 0.5;
  }

  const parsed = input.schema.safeParse(value);
  return parsed.success
    ? { value: parsed.data, providerId: id, confidence, raw }
    : { value: value as T, providerId: id, confidence: 0, raw };
}

function matchOption(
  raw: string,
  options: string[]
): { name: string; exact: boolean } | undefined {
  const cleaned = raw.replace(/["'`.,:]/g, " ").trim();
  for (const option of options) {
    if (cleaned.toLowerCase() === option.toLowerCase()) return { name: option, exact: true };
  }
  for (const option of options) {
    if (new RegExp(`\\b${escapeRegExp(option)}\\b`, "i").test(cleaned)) {
      return { name: option, exact: false };
    }
  }
  // Last resort: token overlap against the option names.
  const tokens = new Set(tokenize(cleaned));
  let best: { name: string; score: number } | undefined;
  for (const option of options) {
    const optionTokens = tokenize(option.replace(/([a-z0-9])([A-Z])/g, "$1 $2"));
    if (!optionTokens.length) continue;
    const overlap = optionTokens.filter((t) => tokens.has(t)).length / optionTokens.length;
    if (!best || overlap > best.score) best = { name: option, score: overlap };
  }
  return best && best.score >= 0.5 ? { name: best.name, exact: false } : undefined;
}

/* ------------------------------- extraction ------------------------------ */

async function extractLocally<T>(
  id: string,
  engine: Engine,
  input: StructuredGenerateInput<T>
): Promise<StructuredResult<T>> {
  const stage = (input.stage ?? {}) as StageHints;
  const shape = describeSchema(input.schema as ZodTypeAny);

  const ask = (extra?: string): ChatTurn[] => [
    {
      role: "system",
      content: "You extract structured data. You reply with JSON only, no prose.",
    },
    {
      role: "user",
      content: [
        `Fill this JSON shape from the request.`,
        shape,
        stage.prefilled && Object.keys(stage.prefilled).length
          ? `Already known: ${JSON.stringify(stage.prefilled)}`
          : "",
        stage.context ? `Application state: ${JSON.stringify(stage.context)}` : "",
        `Request: ${stage.message ?? input.prompt}`,
        extra ?? "",
        `JSON:`,
      ]
        .filter(Boolean)
        .join("\n"),
    },
  ];

  for (const [attempt, messages] of [ask(), ask("Your previous reply was not valid JSON. Reply with JSON only.")].entries()) {
    const raw = await engine.generate(messages, { maxTokens: 160, temperature: 0 });
    let value: unknown;
    try {
      value = extractJson(raw);
    } catch {
      continue;
    }
    const merged =
      value && typeof value === "object" && !Array.isArray(value)
        ? { ...(value as object), ...(stage.prefilled ?? {}) }
        : value;
    const parsed = input.schema.safeParse(merged);
    if (parsed.success) {
      return {
        value: parsed.data,
        providerId: id,
        confidence: attempt === 0 ? 0.7 : 0.5,
        raw,
      };
    }
  }

  return {
    value: (stage.prefilled ?? {}) as T,
    providerId: id,
    confidence: 0,
    raw: "",
  };
}

/* --------------------------------- shared -------------------------------- */

const explainSystem =
  "You restate given facts in one or two plain sentences. You never add facts that were not given.";

function chat(input: GenerateInput, system: string): ChatTurn[] {
  return [
    { role: "system", content: input.system ?? system },
    { role: "user", content: input.prompt },
  ];
}

function clean(text: string): string {
  return text
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .replace(/<\|[^>]*\|>/g, "")
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
