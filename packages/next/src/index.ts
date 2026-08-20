import { loadDocs } from "@agent-runtime/core/node";
import {
  AgentRuntime,
  registerDocsLoader,
  buildManifest,
  loadKnowledgeChunks,
  type AgentManifest,
  type Agent,
  type AgentEvent,
  type AgentTurn,
  type ModelProvider,
  type RuntimeRequest,
  type SessionState,
  type Trace,
} from "@agent-runtime/core";

// Server-side integration: this is where the runtime gains the ability to
// read docs() directories from disk.
registerDocsLoader(loadDocs);

export interface AgentRouteOptions {
  agent: Agent;
  /**
   * Server-side providers. Called once per process.
   * Browser-side providers are registered separately in <AgentProvider>.
   */
  providers: ModelProvider[] | (() => ModelProvider[]);
  /**
   * Resolves the authenticated user from the incoming request. This is the
   * only source of identity: anything the browser sends about the user is
   * ignored.
   */
  session?: (request: Request) => SessionState | Promise<SessionState>;
  /**
   * Ship knowledge chunks to the browser in the manifest, enabling on-device
   * retrieval. Only enable this when the documentation is public.
   */
  exposeKnowledge?: boolean;
  /** Include provider capabilities in traces. Defaults to NODE_ENV !== production. */
  debug?: boolean;
  onTrace?: (trace: Trace) => void;
}

export interface AgentRoute {
  POST: (request: Request) => Promise<Response>;
  GET: (request: Request) => Promise<Response>;
  runtime: AgentRuntime;
}

/**
 * Wires the runtime into a Next.js App Router route handler.
 *
 * app/api/agent/route.ts:
 *   export const { POST, GET } = createAgentRoute({ agent, providers: [...] })
 *
 * This file is the only place Next.js is mentioned in the whole runtime.
 */
export function createAgentRoute(options: AgentRouteOptions): AgentRoute {
  const providers =
    typeof options.providers === "function" ? options.providers() : options.providers;

  const runtime = new AgentRuntime({
    agent: options.agent,
    providers,
    debug: options.debug ?? process.env.NODE_ENV !== "production",
    onTrace: options.onTrace,
  });

  async function POST(request: Request): Promise<Response> {
    let body: RuntimeRequest & { stream?: boolean };
    try {
      body = (await request.json()) as RuntimeRequest & { stream?: boolean };
    } catch {
      return json({ error: "Request body must be JSON." }, 400);
    }
    if (!body || typeof body !== "object" || !("kind" in body)) {
      return json(
        {
          error:
            'Request body must be a runtime request: { kind: "message" | "confirm" | "client-result", ... }',
        },
        400
      );
    }

    const session = (await options.session?.(request)) ?? {};

    // Resolved application context, for a reasoning loop running in the
    // browser. The server decides what it is willing to describe.
    if ((body as { kind: string }).kind === "context") {
      const page = body.page ?? {};
      const context = options.agent.context
        ? await options.agent.context({
            user: (session.user ?? null) as never,
            page,
            session,
          })
        : page;
      return json({ context });
    }

    if (body.stream === false) {
      const turn: AgentTurn = await runtime.handle(body, { session });
      return json(turn);
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (event: AgentEvent) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        };
        try {
          for await (const event of runtime.stream(body, { session })) {
            send(event);
          }
        } catch (error) {
          send({
            type: "error",
            error: { code: "STREAM_FAILED", message: (error as Error).message },
          });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      },
    });
  }

  let manifestPromise: Promise<AgentManifest> | undefined;

  async function manifest(): Promise<AgentManifest> {
    manifestPromise ??= (async () =>
      buildManifest(options.agent, {
        knowledge: options.exposeKnowledge
          ? await loadKnowledgeChunks(options.agent.knowledge ?? [])
          : undefined,
      }))();
    return manifestPromise;
  }

  /**
   * `?manifest=1` returns everything a browser-side runtime needs to teach a
   * local model about this product. Without it, the capability surface, which
   * doubles as generated integration documentation.
   */
  async function GET(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.searchParams.has("manifest")) return json(await manifest());
    return json({
      identity: options.agent.identity,
      actions: runtime.describeActions(),
      models: options.agent.models,
    });
  }

  return { POST, GET, runtime };
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export { AgentRuntime } from "@agent-runtime/core";
