# laya-engine

The local typed-decision engine behind the Sovereign System One façade
(ADR-2094). One responsibility: **load the laya checkpoints and answer
`POST /predict`**. It binds container-loopback only; `system-one-facade` is the
sole ingress, and the shortlisting/windowing that makes a 15,000-token prompt
fit a 1,024-token context is the façade's job, never this one's.

```
consumer ──► systemone:8097  system-one-facade (Rust)
                   └──────►  127.0.0.1:8098    laya-engine (this service)
```

## Endpoints

| Route | Purpose |
|---|---|
| `GET /health` | Per-checkpoint load state, CUDA state, and the SDK's CPU fallback surfaced as data. 200 while anything can answer, 503 when nothing can. |
| `GET /v1/models` | The **real** `max_len` / `head_max_len` of each loaded checkpoint, plus whether the value came from the checkpoint or from an env override. |
| `POST /predict` | `{state, questions}` → `{answers, usage, ms, engine}`. Every question is batched into one forward pass. |

`POST /predict` body:

```jsonc
{
  "model": "laya-typed-decisions",      // optional; laya-latest/jev-latest/"" ⇒ the default
  "state": {"user_request": "..."},     // string, object or turn list
  "max_len": 1024,                      // optional per-request budget override
  "head_max_len": 256,
  "truncate_left": false,               // keep the TAIL of the state instead of the head
  "questions": {
    "route":   {"type": "choice", "instructions": "...", "criteria": {"a": "rubric", "b": "rubric"}},
    "urgency": {"type": "score",  "instructions": "...", "criteria": ["low", "mid", "high"]},
    "tools":   {"type": "noul",   "instructions": "...", "truncate_left": true}
  }
}
```

Answers are laya's own shapes, `action` metadata included. `usage.input_tokens`
is what the engine actually consumed — the number the façade reports upward.

## The `engine` block is the honesty channel

Every response carries per-question token accounting, because two of laya's
behaviours are silent and both change the answer:

* **Every option is hard-truncated to 48 tokens** (`build_sequence`,
  unconditional). `option_tokens` lists the real cost and `option_tokens_capped`
  counts how many hit the ceiling — the façade is expected to compress rubrics
  deliberately rather than let the tokeniser amputate them.
* **Below 16 tokens of remaining head budget the SDK squeezes every option to
  `max(4, (head_max_len - 16) // n)` tokens** and says nothing. `squeezed: true`
  is that path. Measured here at 116 options against `head_max_len = 256`: 2,536
  head tokens required, all options squeezed, and the model still answered —
  confidently, and meaninglessly. The façade must never reach it.

When markers are genuinely lost the request fails as a structured **422
`options_unfittable`** naming the question id, the option count, the markers
that survived and the head cost — never a guess, and never a stringly-typed
`ValueError` the caller has to parse.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `LAYA_MODELS` | `laya-typed-decisions=convaiinnovations/laya:typed-decisions,laya=convaiinnovations/laya` | `name=repo[:subfolder]` pairs; a local path is also accepted |
| `LAYA_DEFAULT_MODEL` | first entry | Model used when the request names none |
| `LAYA_DEVICE` | auto (`cuda` when available) | Passed to the SDK |
| `LAYA_MODEL_DIR` | `/models` | Where checkpoints are materialised (a volume) |
| `LAYA_MAX_LEN`, `LAYA_HEAD_MAX_LEN` | unset | Override the checkpoint budget. **A measured choice**: raising them leaves the training distribution (ADR-2094 addendum §4) |
| `LAYA_BIND_HOST`, `LAYA_PORT` | `127.0.0.1`, `8098` | A non-loopback bind logs a warning; it is an ingress decision |
| `LAYA_MAX_QUESTIONS` | `64` | Per-request question cap (413 above it) |
| `LAYA_REQUEST_LOG` | `0` | Per-request log line and uvicorn access log |
| `HF_TOKEN` | unset | Only needed for gated repos |

Checkpoint budgets are **not** uniform, which is the whole reason `/v1/models`
exists: `laya` is 512/192, `laya-typed-decisions` is 1024/256.

## Build and run

The image is built from `services/laya-engine/Dockerfile` with two build
contexts (`.` here, `crates` → `crates/system-one`) and ships both processes.
The Python engine alone is buildable and runnable for development:

```bash
docker build --target engine -t agentbox/laya-engine:dev .
docker run --rm --gpus all -v systemone-models:/models agentbox/laya-engine:dev
```

Full sidecar lifecycle: `./agentbox.sh systemone <up|down|status|health|models|eval|logs>`.

## Notes that cost time to learn

* The base image is `pytorch/pytorch:2.7.1-cuda12.8-cudnn9-runtime` — **Ubuntu
  22.04, glibc 2.35**. The Rust builder stage must therefore be *older* glibc
  (bullseye, 2.31); a bookworm builder compiles cleanly and then fails at exec.
  The cu128 wheels cover sm_86 (RTX A6000, Ampere) and sm_89 (RTX 6000 Ada) —
  this estate has no Blackwell card, whatever the upstream benchmarks used.
* Checkpoints are downloaded with `local_dir` and an explicit `allow_patterns`
  list. `huggingface_hub` matches with `fnmatch`, where `*` also matches `/`, so
  a `*.json` pattern would drag the multilingual checkpoint along with it; and
  `laya.agent._fix_tokenizer_config` rewrites `tokenizer_config.json` **in
  place**, which through a blob symlink would corrupt the shared cache entry.
* A missing or broken checkpoint degrades `/health`; it never crash-loops the
  container. The container exits only when a process it supervises dies.
