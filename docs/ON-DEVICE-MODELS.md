# Shipping an on-device model

Measured 2026-08-20 against the real files. Sizes come from the hub's headers; compression
figures come from compressing the **whole file**, because 20MB samples proved misleading —
they suggested 41% where the true figure is 57%.

## What actually gets downloaded

```
onnx/model_q4.onnx        173.6 MB (135M)  /  370.0 MB (360M)   ← essentially the whole cost
tokenizer.json            2.0 MB
config.json               < 1 KB
generation_config.json    < 1 KB
tokenizer_config.json     < 1 KB
special_tokens_map.json   < 1 KB
```

It is downloaded **once per device**. transformers.js stores every file in a persistent
`transformers-cache` Cache API bucket, so reloads and later visits start warm. "Preparation" is a
first-visit cost, not a per-session one.

## Quantisation and compression, measured end to end

Raw sizes are from the hub's `content-length`. Compressed sizes are **whole-file brotli -q5**,
not extrapolated from samples — sampling a 20MB slice of the middle of these files suggested 41%,
and the real figure is 56–63%. The middle of a weight file is more compressible than the file.

**SmolLM2-135M-Instruct**

| Variant | Raw | Stored (brotli) | Ratio |
| --- | ---: | ---: | ---: |
| `q4` **(default)** | 173.6 MB | **98.4 MB** | 57% |
| `q4f16` | 112.2 MB | ~95 MB | 85% |
| `int8` / `uint8` | 130.8 MB | — | — |
| `fp16` | 257.7 MB | — | — |
| `fp32` | 515.3 MB | — | — |

**SmolLM2-360M-Instruct**

| Variant | Raw | Stored (brotli) | Ratio |
| --- | ---: | ---: | ---: |
| `q4` **(default)** | 370.0 MB | **~230 MB** | 62% |
| `q4f16` | 260.1 MB | ~238 MB | 91% |

Two things follow:

- **Compression is worth roughly 1.6–1.8×** on q4 weights, and the hub collects none of it —
  it serves them with no `content-encoding` and `cache-control: no-store` on the redirect.
- **The best variant depends on who serves the file.** On the hub, `q4f16` wins outright
  (112 MB vs 174 MB on the 135M). Self-hosted and compressed, `q4` wins (98 MB vs ~95 MB is a
  wash on the 135M, and 230 MB vs 238 MB on the 360M) — and `q4` runs without needing WebGPU
  fp16 support. Brotli quality above 5 buys nothing measurable here: q5 and q9 both land at the
  same ratio.

Tokenizer JSON is a different story and does compress well: 2.0 MB → 0.5 MB.

## Building the bundle

```bash
node tools/model-bundle/build.mjs \
  --model HuggingFaceTB/SmolLM2-360M-Instruct \
  --dtype q4 \
  --out out
```

It writes the exact key layout transformers.js requests, plus `upload.sh`, `cors.json` and a
`manifest.json`:

```
out/HuggingFaceTB/SmolLM2-360M-Instruct/resolve/main/
  config.json
  generation_config.json
  special_tokens_map.json
  tokenizer.json            (brotli)
  tokenizer_config.json
  onnx/model_q4.onnx        (brotli)
```

```bash
cd out && ./upload.sh your-bucket-name
wrangler r2 bucket cors put your-bucket-name --rules ./cors.json
```

`upload.sh` sets `Content-Encoding: br` on the compressed objects and
`cache-control: public, max-age=31536000, immutable` on everything. R2 will not compress a
370 MB binary on the fly, so it is stored pre-compressed and the browser decompresses
transparently.

Then point the runtime at it:

```ts
createLocalProvider({
  model: "HuggingFaceTB/SmolLM2-360M-Instruct",
  weightsHost: "https://models.example.com/",
})
```

Two things that will cost you an afternoon if missed:

- **CORS is required.** The fetch is cross-origin from your app. `cors.json` allows `GET`/`HEAD`
  and exposes `content-length`, `content-encoding`, `content-range` and `etag`; edit the origins
  before applying it.
- **`Content-Encoding: br` is served unconditionally.** An object stored that way goes to every
  client, including one that did not send `Accept-Encoding: br`. Every current browser does. If
  you need strict negotiation, put a Worker in front that picks the `.br` object or a raw copy
  based on the request header.

## Cheaper than any of this: don't download a model

The runtime splits work into stages precisely so the small ones need no model:

| Stage | What it needs | Cost |
| --- | --- | --- |
| retrieval | BM25 over your docs | 1–8 ms, 0 bytes |
| route | pick one label from a list | rule-based: 0 ms, 0 bytes |
| arguments | fill a small schema | rule-based: 0 ms, 0 bytes |
| explain | reword supplied facts | this is the part that wants a model |

The deterministic provider already scores **89.5% intent accuracy and 100% argument accuracy**
on the evaluation suite at 0 ms and 0 bytes. And when an action returns a developer-written
`summary`, the runtime skips the explain stage entirely.

So the honest ordering for a fast first visit is:

1. **Use the browser's built-in model** where it exists — no download at all.
2. **Ship nothing** and let the rule-based provider route while a cloud tier handles prose.
3. **Then** self-host compressed weights, if on-device inference is a requirement.

Measured evidence for steps 1 and 2 beating step 3 is in the eval suite: SmolLM2-135M routes at
~0.15 confidence on-device and cannot reliably pick from a five-item list, so a 98 MB download
buys very little over a rule-based router that scores 89.5%. 360M is the realistic floor, and it
is a ~230 MB download.
