/**
 * The text-generation engine behind the local provider.
 *
 * Two implementations: a Web Worker (so token generation never blocks the
 * application's UI thread) and a main-thread fallback for environments where
 * a module worker cannot be constructed.
 */

export interface ChatTurn {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface GenerateOptions {
  maxTokens?: number;
  temperature?: number;
  stop?: string[];
  onDelta?: (text: string) => void;
}

export interface Engine {
  load(): Promise<void>;
  generate(messages: ChatTurn[], options?: GenerateOptions): Promise<string>;
  readonly progress: LoadProgress;
  /** True once weights are resident and generation will start immediately. */
  readonly ready: boolean;
  dispose(): void;
}

export interface LoadProgress {
  status: "idle" | "loading" | "ready" | "failed";
  /** 0..1 across all model files. */
  fraction: number;
  detail?: string;
}

import { workerSource } from "./worker-source.js";

export interface EngineOptions {
  model: string;
  /**
   * Where the inference library is loaded from at runtime.
   *
   * It is deliberately not a static import: bundling transformers.js drags
   * its native Node bindings into the application build, and the whole point
   * of this provider is that it costs nothing until someone opts in. In the
   * browser it defaults to an ESM CDN build; under Node it resolves the
   * installed package.
   */
  transformersUrl?: string;
  /** "webgpu" is much faster; "wasm" is the compatible fallback. */
  device?: "webgpu" | "wasm" | "auto";
  dtype?: string;
  useWorker?: boolean;
  /** Abandon a model load after this long. Defaults to 5 minutes. */
  loadTimeoutMs?: number;
  /**
   * Serve weights from your own origin (R2, S3, any CDN) instead of the
   * Hugging Face hub.
   *
   * Worth doing: the hub sends weights uncompressed, and q4 ONNX compresses to
   * roughly 41% of its size with brotli. Storing a pre-compressed object with
   * `Content-Encoding: br` turns a 174MB download into about 71MB.
   */
  weightsHost?: string;
  /** Path layout under the host. Defaults to the hub's {model}/resolve/{revision}/. */
  weightsPathTemplate?: string;
}

export const DEFAULT_TRANSFORMERS_CDN =
  "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.6/+esm";

/** Points the loader at a self-hosted copy of the weights, when configured. */
export function applyWeightsHost(
  transformers: { env?: Record<string, unknown> },
  options: Pick<EngineOptions, "weightsHost" | "weightsPathTemplate">
): void {
  if (!transformers?.env) return;
  if (options.weightsHost) {
    transformers.env.remoteHost = options.weightsHost.endsWith("/")
      ? options.weightsHost
      : `${options.weightsHost}/`;
  }
  if (options.weightsPathTemplate) {
    transformers.env.remotePathTemplate = options.weightsPathTemplate;
  }
}

export function transformersSpecifier(options: EngineOptions): string {
  if (options.transformersUrl) return options.transformersUrl;
  const inBrowser = typeof window !== "undefined" || typeof importScripts === "function";
  return inBrowser ? DEFAULT_TRANSFORMERS_CDN : "@huggingface/transformers";
}

/** Opaque to bundlers on purpose — see EngineOptions.transformersUrl. */
export async function loadTransformers(specifier: string): Promise<any> {
  return import(/* webpackIgnore: true */ /* @vite-ignore */ specifier);
}

export function createEngine(options: EngineOptions): Engine {
  if (options.useWorker !== false && typeof Worker !== "undefined" && typeof Blob !== "undefined") {
    try {
      return new WorkerEngine(options);
    } catch {
      // Losing the worker costs UI responsiveness, not the feature.
    }
  }
  return new InlineEngine(options);
}

/* ----------------------------- worker engine ----------------------------- */

class WorkerEngine implements Engine {
  private readonly worker: Worker;
  private seq = 0;
  private readonly pending = new Map<
    number,
    { resolve: (v: string) => void; reject: (e: Error) => void; onDelta?: (t: string) => void }
  >();
  private loading?: Promise<void>;
  progress: LoadProgress = { status: "idle", fraction: 0 };

  constructor(private readonly options: EngineOptions) {
    const blob = new Blob([workerSource()], { type: "text/javascript" });
    this.worker = new Worker(URL.createObjectURL(blob), { type: "module" });

    // A worker that fails to start is indistinguishable from a slow model
    // unless we say so explicitly. Reject everything waiting on it.
    const fail = (message: string) => {
      const error = new Error(`Local inference worker failed: ${message}`);
      this.progress = { status: "failed", fraction: 0, detail: error.message };
      for (const [id, entry] of this.pending) {
        this.pending.delete(id);
        entry.reject(error);
      }
    };
    this.worker.addEventListener("error", (event: ErrorEvent) =>
      fail(event.message || "worker script did not load")
    );
    this.worker.addEventListener("messageerror", () => fail("worker message could not be deserialised"));

    this.worker.addEventListener("message", (event: MessageEvent) => {
      const message = event.data as {
        id: number;
        type: "progress" | "delta" | "done" | "error";
        text?: string;
        error?: string;
        fraction?: number;
        detail?: string;
      };
      if (message.type === "progress") {
        this.progress = {
          status: "loading",
          fraction: message.fraction ?? 0,
          detail: message.detail,
        };
        return;
      }
      const entry = this.pending.get(message.id);
      if (!entry) return;
      if (message.type === "delta") entry.onDelta?.(message.text ?? "");
      else if (message.type === "done") {
        this.pending.delete(message.id);
        entry.resolve(message.text ?? "");
      } else if (message.type === "error") {
        this.pending.delete(message.id);
        entry.reject(new Error(message.error ?? "worker failed"));
      }
    });
  }

  get ready(): boolean {
    return this.progress.status === "ready";
  }

  load(): Promise<void> {
    if (this.progress.status === "idle") {
      this.progress = { status: "loading", fraction: 0 };
    }
    this.loading ??= this.send("load", {}).then(
      () => {
        this.progress = { status: "ready", fraction: 1 };
      },
      (error: Error) => {
        this.progress = { status: "failed", fraction: 0, detail: error.message };
        throw error;
      }
    );
    return this.loading;
  }

  async generate(messages: ChatTurn[], options: GenerateOptions = {}): Promise<string> {
    await this.load();
    return this.send("generate", { messages, options: strip(options) }, options.onDelta);
  }

  private send(
    type: string,
    payload: Record<string, unknown>,
    onDelta?: (text: string) => void
  ): Promise<string> {
    const id = ++this.seq;
    const timeoutMs = this.options.loadTimeoutMs ?? 300_000;
    return new Promise<string>((resolve, reject) => {
      // No provider may hang a turn indefinitely; the router needs a failure
      // it can escalate past.
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) {
          reject(new Error(`Local inference timed out after ${Math.round(timeoutMs / 1000)}s`));
        }
      }, timeoutMs);
      const settle = <T extends (value: never) => void>(fn: T) =>
        ((value: never) => {
          clearTimeout(timer);
          fn(value);
        }) as T;
      this.pending.set(id, {
        resolve: settle(resolve as never),
        reject: settle(reject as never),
        onDelta,
      });
      this.worker.postMessage({
        id,
        type,
        model: this.options.model,
        device: this.options.device,
        dtype: this.options.dtype,
        transformersUrl: transformersSpecifier(this.options),
        weightsHost: this.options.weightsHost,
        weightsPathTemplate: this.options.weightsPathTemplate,
        ...payload,
      });
    });
  }

  dispose(): void {
    this.worker.terminate();
    this.pending.clear();
  }
}

/* ----------------------------- inline engine ----------------------------- */

class InlineEngine implements Engine {
  private pipelinePromise?: Promise<any>;
  progress: LoadProgress = { status: "idle", fraction: 0 };

  get ready(): boolean {
    return this.progress.status === "ready";
  }

  constructor(private readonly options: EngineOptions) {}

  async load(): Promise<void> {
    await this.pipeline();
  }

  private pipeline(): Promise<any> {
    this.pipelinePromise ??= (async () => {
      this.progress = { status: "loading", fraction: 0 };
      try {
        const transformers = await loadTransformers(transformersSpecifier(this.options));
        applyWeightsHost(transformers, this.options);
        const generator = await transformers.pipeline(
          "text-generation",
          this.options.model,
          {
            dtype: (this.options.dtype ?? "q4") as never,
            device: await resolveDevice(this.options.device),
            progress_callback: (event: any) => {
              if (event?.status === "progress" && typeof event.progress === "number") {
                this.progress = {
                  status: "loading",
                  fraction: event.progress / 100,
                  detail: event.file,
                };
              }
            },
          }
        );
        this.progress = { status: "ready", fraction: 1 };
        return generator;
      } catch (error) {
        this.progress = {
          status: "failed",
          fraction: 0,
          detail: (error as Error).message,
        };
        throw error;
      }
    })();
    return this.pipelinePromise;
  }

  async generate(messages: ChatTurn[], options: GenerateOptions = {}): Promise<string> {
    const generator = await this.pipeline();
    const output = await generator(messages, {
      max_new_tokens: options.maxTokens ?? 160,
      do_sample: (options.temperature ?? 0) > 0,
      temperature: options.temperature ?? 0,
      return_full_text: false,
    });
    return readAssistant(output);
  }

  dispose(): void {
    this.pipelinePromise = undefined;
  }
}

/* --------------------------------- utils --------------------------------- */

export function readAssistant(output: any): string {
  const first = Array.isArray(output) ? output[0] : output;
  const generated = first?.generated_text;
  if (typeof generated === "string") return generated.trim();
  if (Array.isArray(generated)) {
    const last = generated[generated.length - 1];
    if (typeof last === "string") return last.trim();
    if (last && typeof last.content === "string") return last.content.trim();
  }
  return typeof first === "string" ? first.trim() : "";
}

export async function resolveDevice(
  preference: EngineOptions["device"]
): Promise<"webgpu" | "wasm"> {
  if (preference === "webgpu" || preference === "wasm") return preference;
  return (await hasWebGpu()) ? "webgpu" : "wasm";
}

export async function hasWebGpu(): Promise<boolean> {
  const gpu = (globalThis.navigator as { gpu?: { requestAdapter(): Promise<unknown> } })
    ?.gpu;
  if (!gpu) return false;
  try {
    return Boolean(await gpu.requestAdapter());
  } catch {
    return false;
  }
}

function strip(options: GenerateOptions) {
  const { onDelta, ...rest } = options;
  return rest;
}
