/**
 * The inference worker, as source text.
 *
 * It is deliberately self-contained and built into a Blob URL at runtime
 * rather than shipped as a module the bundler has to understand. A worker
 * emitted by a bundler keeps its relative imports, which then 404 from
 * wherever the asset lands — and a worker that fails to load looks exactly
 * like a model that is taking a long time.
 *
 * The two helpers below are duplicated from engine.ts on purpose: this string
 * cannot import anything except the inference library itself.
 */
export function workerSource(): string {
  return `
const state = { generator: null, transformers: null, files: new Map() };

async function resolveDevice(preference) {
  if (preference === "webgpu" || preference === "wasm") return preference;
  if (!navigator.gpu) return "wasm";
  try {
    return (await navigator.gpu.requestAdapter()) ? "webgpu" : "wasm";
  } catch {
    return "wasm";
  }
}

function readAssistant(output) {
  const first = Array.isArray(output) ? output[0] : output;
  const generated = first && first.generated_text;
  if (typeof generated === "string") return generated.trim();
  if (Array.isArray(generated)) {
    const last = generated[generated.length - 1];
    if (typeof last === "string") return last.trim();
    if (last && typeof last.content === "string") return last.content.trim();
  }
  return typeof first === "string" ? first.trim() : "";
}

async function getGenerator(model, device, dtype, url, hosting, onProgress) {
  if (!state.generator) {
    state.generator = (async () => {
      const transformers = await import(url);
      state.transformers = transformers;
      if (transformers.env && hosting) {
        if (hosting.host) {
          transformers.env.remoteHost = hosting.host.endsWith("/") ? hosting.host : hosting.host + "/";
        }
        if (hosting.template) transformers.env.remotePathTemplate = hosting.template;
      }
      return transformers.pipeline("text-generation", model, {
        dtype: dtype || "q4",
        device: await resolveDevice(device),
        // Aggregate across files by bytes. Reporting each file's own progress
        // makes the bar hit 100% on a 3KB config while a 370MB weight file has
        // not started, which is worse than no bar at all.
        progress_callback: (event) => {
          if (!event || event.status !== "progress") return;
          if (typeof event.total === "number" && event.total > 0) {
            state.files.set(event.file, { loaded: event.loaded || 0, total: event.total });
            let loaded = 0, total = 0;
            for (const f of state.files.values()) { loaded += f.loaded; total += f.total; }
            if (total > 0) onProgress(loaded / total, event.file);
          } else if (typeof event.progress === "number") {
            onProgress(event.progress / 100, event.file);
          }
        },
      });
    })();
  }
  return state.generator;
}

self.addEventListener("message", async (event) => {
  const { id, type, model, device, dtype, transformersUrl, weightsHost, weightsPathTemplate, messages, options } = event.data;
  const post = (payload) => self.postMessage(Object.assign({ id }, payload));
  try {
    const generator = await getGenerator(model, device, dtype, transformersUrl, { host: weightsHost, template: weightsPathTemplate }, (fraction, detail) =>
      self.postMessage({ id, type: "progress", fraction, detail })
    );
    if (type === "load") {
      post({ type: "done", text: "" });
      return;
    }
    // Stream tokens as they are produced. Waiting for a whole answer from a
    // small model is most of why on-device inference feels slow, even when
    // total time is fine.
    let streamer;
    const Streamer = state.transformers && state.transformers.TextStreamer;
    if (Streamer && generator.tokenizer) {
      streamer = new Streamer(generator.tokenizer, {
        skip_prompt: true,
        skip_special_tokens: true,
        callback_function: (text) => {
          if (text) self.postMessage({ id, type: "delta", text });
        },
      });
    }

    const output = await generator(messages || [], {
      max_new_tokens: (options && options.maxTokens) || 160,
      do_sample: Boolean(options && options.temperature),
      temperature: (options && options.temperature) || 0,
      return_full_text: false,
      streamer,
    });
    post({ type: "done", text: readAssistant(output) });
  } catch (error) {
    post({ type: "error", error: String((error && error.message) || error) });
  }
});
`;
}
