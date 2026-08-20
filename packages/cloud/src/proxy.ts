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

export interface ProxyProviderOptions {
  /** Server route created with createModelProxyRoute(). */
  endpoint?: string;
  id?: string;
  label?: string;
  tasks?: ModelTask[];
  quality?: number;
  headers?: Record<string, string>;
}

/**
 * Browser-side handle on a server-side cloud provider.
 *
 * Lets a page whose reasoning runs on-device still escalate to a large model
 * without the API key ever reaching the browser.
 */
export function createProxyProvider(options: ProxyProviderOptions = {}): ModelProvider {
  const endpoint = options.endpoint ?? "/api/agent/model";
  const id = options.id ?? "cloud/proxy";

  async function post(body: unknown, signal?: AbortSignal): Promise<any> {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", ...options.headers },
      body: JSON.stringify(body),
      signal,
    });
    if (!response.ok) {
      throw new Error(
        `Model proxy ${endpoint} responded ${response.status}. ` +
          `Create it with createModelProxyRoute({ provider: createAnthropicProvider() }).`
      );
    }
    return response.json();
  }

  return {
    id,
    async capabilities(): Promise<ModelCapabilities> {
      return {
        id,
        label: options.label ?? "Cloud (via server proxy)",
        tier: "cloud",
        structuredOutput: "native",
        streaming: false,
        quality: options.quality ?? 0.95,
        privacy: "third-party",
        available: true,
        tasks: options.tasks ?? ["route", "extract", "explain", "answer"],
      };
    },
    async generate(input: GenerateInput): Promise<GenerateResult> {
      const body = await post(
        { mode: "text", task: input.task, prompt: input.prompt, system: input.system, maxTokens: input.maxTokens },
        input.signal
      );
      return { text: body.text ?? "", providerId: id, confidence: 1 };
    },
    async generateStructured<T>(
      input: StructuredGenerateInput<T>
    ): Promise<StructuredResult<T>> {
      const body = await post(
        {
          mode: "structured",
          task: input.task,
          prompt: input.prompt,
          system: input.system,
          maxTokens: input.maxTokens,
          schema: toJsonSchema(input.schema as ZodTypeAny),
          schemaName: input.schemaName,
        },
        input.signal
      );
      const parsed = input.schema.safeParse(body.value);
      if (!parsed.success) {
        throw modelOutputInvalidError(
          id,
          JSON.stringify(body.value),
          parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
        );
      }
      return {
        value: parsed.data,
        providerId: id,
        confidence: body.confidence ?? 0.95,
        raw: JSON.stringify(body.value),
      };
    },
  };
}

export interface ModelProxyRouteOptions {
  provider: ModelProvider;
  /** Guard the proxy: rate limiting, auth, quotas. */
  authorize?: (request: Request) => boolean | Promise<boolean>;
}

/**
 * Server half of the proxy. Framework-agnostic: it takes a Request and returns
 * a Response, so it drops into a Next.js route handler unchanged.
 */
export function createModelProxyRoute(options: ModelProxyRouteOptions) {
  return async function POST(request: Request): Promise<Response> {
    if (options.authorize && !(await options.authorize(request))) {
      return new Response(JSON.stringify({ error: "Not allowed" }), {
        status: 403,
        headers: { "content-type": "application/json" },
      });
    }

    const body = (await request.json()) as {
      mode: "text" | "structured";
      task: ModelTask;
      prompt: string;
      system?: string;
      maxTokens?: number;
      schema?: Record<string, unknown>;
      schemaName?: string;
    };

    try {
      if (body.mode === "structured") {
        const { jsonSchemaToZod } = await import("@agent-runtime/core");
        const schema = jsonSchemaToZod(body.schema ?? {});
        const result = await options.provider.generateStructured({
          task: body.task,
          prompt: body.prompt,
          system: body.system,
          maxTokens: body.maxTokens,
          schema,
          schemaName: body.schemaName,
        });
        return json({ value: result.value, confidence: result.confidence });
      }
      const result = await options.provider.generate({
        task: body.task,
        prompt: body.prompt,
        system: body.system,
        maxTokens: body.maxTokens,
      });
      return json({ text: result.text });
    } catch (error) {
      return json({ error: (error as Error).message }, 502);
    }
  };
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}
