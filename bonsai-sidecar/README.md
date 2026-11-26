# bonsai-sidecar — Ternary Bonsai 2.5 27B LLM server (optional)

An optional sidecar that serves **Ternary Bonsai 2.5 27B Uncensored** (AtomicChat, PTQ1_0,
~6 GB) as an OpenAI-compatible endpoint on one GPU. The ternary PTQ1_0 type is only
understood by PrismML's llama.cpp fork, so the image builds that fork at the tag named on
the model card (`prism-b12128-d7b2896`).

## Run

```bash
hf download AtomicChat/Ternary-Bonsai-2.5-27B-Uncensored-GGUF \
    Ternary-Bonsai-2.5-27B-Uncensored-PTQ1_0.gguf --local-dir /mnt/mldata/models/bonsai
./agentbox.sh bonsai up        # build (first run ~15 min) and start
./agentbox.sh bonsai health
```

## Configuration (environment, all optional)

| Variable | Default | Meaning |
|---|---|---|
| `BONSAI_GPU` | `0` | GPU index (machinelearn: GPU 0 is the A6000, mostly idle). HP: use `1` |
| `BONSAI_CUDA_ARCH` | `86;89` | Build arch: 75 Turing (HP RTX 6000), 86 Ampere (A6000), 89 Ada. Changing it needs `bonsai rebuild` |
| `BONSAI_MODEL_DIR` | `/mnt/mldata/models/bonsai` | Host dir holding the GGUF (mounted read-only) |
| `BONSAI_MODEL_FILE` | `Ternary-Bonsai-2.5-27B-Uncensored-PTQ1_0.gguf` | |
| `AGENTBOX_SIDECAR_BIND` | `127.0.0.1` | Host address of the publish on port 8086 (fixed). The shared sidecar knob (ADR-2013): setting it moves every sidecar port to that address. agentbox containers use `http://bonsai:8086/v1` on `visionclaw_network` |
| `BONSAI_CTX` | `131072` | Context; model supports 262144 |
| `BONSAI_ALIAS` | `ternary-bonsai-2.5-27b-uncensored` | Model id clients send |

## Connect pi

`~/.pi/agent/models.json` provider `local-bonsai`, `baseUrl` `http://127.0.0.1:8086/v1` (on this host),
`thinkingFormat: qwen-chat-template`, model id as `BONSAI_ALIAS`.

## Notes

- Thinking mode is on by default; give it `max_tokens` of 16k or more.
- No MTP head in the Atomic file, so no speculative decoding.
- The "Uncensored" variant edits layers 27 to 44 to suppress refusals. Treat output
  accordingly and keep it off any unsupervised public surface.
- Tools: `./agentbox.sh bonsai shell` opens a shell; `llama-cli` is in the image.
