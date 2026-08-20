# model-bundle

Builds an upload-ready folder of on-device model weights, laid out exactly as
transformers.js requests them, with the large files pre-compressed.

```bash
node build.mjs --model HuggingFaceTB/SmolLM2-360M-Instruct --dtype q4 --out out
```

| Flag | Default | Meaning |
| --- | --- | --- |
| `--model` | `HuggingFaceTB/SmolLM2-360M-Instruct` | Hub repo id. Must publish ONNX weights. |
| `--dtype` | `q4` | `q4`, `q4f16`, `int8`, `uint8`, `fp16`, `bnb4`, `quantized` |
| `--quality` | `5` | brotli quality. Above 5 buys nothing measurable on these files. |
| `--out` | `out` | Output folder. |
| `--bucket` | `YOUR_BUCKET` | Pre-fills the generated `upload.sh`. |

Produces:

```
out/
  <model>/resolve/main/…      the files, brotli-compressed where it helps
  upload.sh                   wrangler commands with the right headers
  cors.json                   R2 CORS rules (edit the origins first)
  manifest.json               every key, its type, encoding and both sizes
```

Then:

```bash
cd out && ./upload.sh your-bucket-name
wrangler r2 bucket cors put your-bucket-name --rules ./cors.json
```

And point the runtime at it:

```ts
createLocalProvider({
  model: "HuggingFaceTB/SmolLM2-360M-Instruct",
  weightsHost: "https://models.example.com/",
})
```

In the playground you can test a bucket without editing code:

```
http://localhost:3000/notes/n1?engine=download&weights=https://models.example.com/
```

Measured sizes, why `q4` beats `q4f16` once compressed, and the two gotchas
(CORS, and unconditional `Content-Encoding`) are in
[../../docs/ON-DEVICE-MODELS.md](../../docs/ON-DEVICE-MODELS.md).
