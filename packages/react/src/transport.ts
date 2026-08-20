import type { AgentEvent, AgentManifest, RuntimeRequest } from "@agent-runtime/core";

export interface TransportOptions {
  endpoint: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

/** Reads the runtime's server-sent event stream into typed events. */
export async function* streamAgent(
  request: RuntimeRequest,
  options: TransportOptions
): AsyncGenerator<AgentEvent> {
  const response = await fetch(options.endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", ...options.headers },
    body: JSON.stringify(request),
    signal: options.signal,
  });

  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => "");
    yield {
      type: "error",
      error: {
        code: "TRANSPORT_FAILED",
        message: `Agent endpoint ${options.endpoint} responded ${response.status}. ${text.slice(0, 300)}`,
      },
    };
    yield { type: "done" };
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const line = frame.trim();
      if (!line.startsWith("data:")) continue;
      try {
        yield JSON.parse(line.slice(5).trim()) as AgentEvent;
      } catch {
        /* ignore malformed frame */
      }
    }
  }
}

/** One-shot, non-streaming call. Used for direct action execution. */
export async function callAgent(
  request: RuntimeRequest,
  options: TransportOptions
): Promise<{ outcomes: any[]; error?: { code: string; message: string } }> {
  const response = await fetch(options.endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", ...options.headers },
    body: JSON.stringify({ ...request, stream: false }),
    signal: options.signal,
  });
  if (!response.ok) {
    throw new Error(
      `Agent endpoint ${options.endpoint} responded ${response.status} for ${request.kind}.`
    );
  }
  return response.json();
}

export async function fetchManifest(
  endpoint: string,
  signal?: AbortSignal
): Promise<AgentManifest> {
  const response = await fetch(`${endpoint}?manifest=1`, { signal });
  if (!response.ok) {
    throw new Error(
      `Could not load the agent manifest from ${endpoint}. Local-first mode needs the route created by createAgentRoute().`
    );
  }
  return response.json();
}

/**
 * Resolved application context for a browser-side loop.
 *
 * The server runs the context resolver, so identity and plan information stay
 * server-derived even when the reasoning happens on the device.
 */
export async function fetchContext(
  endpoint: string,
  page: Record<string, unknown>,
  options: { headers?: Record<string, string>; signal?: AbortSignal } = {}
): Promise<Record<string, unknown>> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", ...options.headers },
    body: JSON.stringify({ kind: "context", page }),
    signal: options.signal,
  });
  if (!response.ok) return page;
  const body = (await response.json()) as { context?: Record<string, unknown> };
  return body.context ?? page;
}
