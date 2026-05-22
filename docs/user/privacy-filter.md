# Privacy filter

Agentbox can run a local PII redaction sidecar (an auxiliary process that runs alongside the main container on a loopback port and is called as middleware before writes) that scrubs personally identifiable information from agent I/O before it is written to durable storage or returned to the user. The model is
[`openai/privacy-filter`](https://huggingface.co/openai/privacy-filter) —
a 1.5-billion-parameter mixture-of-experts classifier (50M active), Apache-2.0
licensed, released 2026-04-22. The routing contract that decides where the
sidecar sits in the request flow is specified in
[ADR-008](../reference/adr/ADR-008-privacy-filter-routing.md).

**When to skip this**: if nothing sensitive ever touches your agents, or you already redact upstream at the orchestrator, leave `enabled = false`. The sidecar adds ~3 GB of weights and a GPU/CPU footprint.

## Why this exists

Three places in agentbox handle user text that might contain private data:

1. **Inbound prompts** from a host orchestrator when agentbox is federated.
2. **Model output** on its way back to the user or to a durable store.
3. **Adapter writes** — anything you persist through pods, memory, events,
   beads or the orchestrator slot. **Vector memory writes are the most
   dangerous class**: an embedding encodes PII into a latent representation
   you cannot later extract — you can only delete the whole row.

A regex library handles obvious emails and phone numbers well enough, but
misses dates, private addresses, secrets and person identifiers that
appear in natural language. openai/privacy-filter scores F1 ≈ 96% across
all eight entity classes on the PII-Masking-300k benchmark. Good enough
to put in front of durable state; small enough to run locally.

## What gets redacted

Eight entity classes, each toggleable independently:

| Class | Examples caught |
|-------|-----------------|
| `account_number` | card PANs, IBANs, NHS numbers, utility account IDs |
| `private_address` | street address strings including partial matches |
| `private_email` | email addresses including uncommon TLDs |
| `private_person` | full names inside a sentence context, not public figures |
| `private_phone` | phone numbers in any common format, international prefixes |
| `private_url` | URLs that carry session tokens, personal hosts |
| `private_date` | dates tied to a person (DOBs, appointments) |
| `secret` | API keys, tokens, passwords in plain text |

## When to enable it

The setup wizard (`scripts/start-agentbox.sh`) includes a Privacy Filter
section. Hardware requirements:

- **GPU path** — if `nvidia-smi` or `rocm-smi` is available, `local-gpu`
  mode is offered by default. Inference is trivial at BF16.
- **CPU path** — viable iff `nproc >= 4` **and** `MemAvailable >= 6 GB`.
  The MoE keeps all 128 experts resident (~3 GB BF16) even though only four
  fire per token, so the floor is memory, not cores.
- **Neither** — the feature can still be force-enabled via manual manifest
  edit, but the sidecar's `/health` will report `unavailable` and `strict`
  policies will fail-closed.

## Policy presets

You'll be asked which preset to apply:

| Preset | What it does | Best for |
|--------|--------------|----------|
| **balanced** (default) | `pods=strict`, `memory=strict`, `events=soft`, `beads=soft`, `orchestrator=off` | most operators |
| **lockdown** | every slot `strict` (fail-closed everywhere) | regulated environments |
| **custom** | per-slot checklist | you know exactly what you want |

The difference between `strict` and `soft` is how the middleware behaves
when the sidecar is unreachable:

- `strict` — reject the write, surface a 503 to the caller, bump
  `opf_fail_closed_total`. Correct for durable surfaces you cannot
  retract data from.
- `soft` — log at `warn`, bump `opf_fail_open_total`, let the original
  payload through. Correct for audit trails and ephemeral events where
  losing the row is worse than a temporary redaction gap.
- `off` — the middleware doesn't call the sidecar for that slot at all.
  The default for `orchestrator` because those messages are internal
  control-plane traffic.

## Manifest reference

```toml
[privacy_filter]
enabled = true
mode    = "local-gpu"           # off | local-gpu | local-cpu
port    = 9092                  # loopback-only
dtype   = "bf16"                # bf16 | f32 | q4   (q4 is CPU-only)
model   = "openai/privacy-filter"

[privacy_filter.policy]
pods         = "strict"         # strict | soft | off
memory       = "strict"
events       = "soft"
beads        = "soft"
orchestrator = "off"
inbound      = "soft"
outbound     = "soft"

[privacy_filter.entities]
enabled = []                    # empty = all eight
```

Validator rules that watch this section:

| Code | Condition |
|------|-----------|
| **E022** | `enabled=true` requires `mode ∈ {local-gpu, local-cpu}` (not `off`). |
| **E023** | `mode="local-gpu"` requires `gpu.backend != "none"`. |
| **E024** | `dtype="q4"` requires `mode="local-cpu"`. |
| **E025** | `port` must not collide with `observability.metrics_port` or any reserved port. |

## How to tell it's working

The sidecar runs as `[program:opf-router]` on loopback port `9092`.

```sh
# Health
curl -s http://localhost:9092/health | jq
# {
#   "status":  "ready",
#   "mode":    "local-gpu",
#   "model":   "openai/privacy-filter",
#   "device":  "cuda:0/bf16",
#   "dtype":   "bf16"
# }

# Try a classification directly
curl -s -X POST http://localhost:9092/redact \
  -H 'content-type: application/json' \
  -d '{"text":"Alice (alice@example.com) paid on 2026-01-02"}' | jq

# Metrics
curl -s http://localhost:9092/metrics
```

The management-api emits its own metrics as adapter middleware runs:

```sh
curl -s http://localhost:9091/metrics | grep '^opf_'
# opf_requests_total{slot="memory",op="redact"} 142
# opf_redactions_total{slot="memory",entity="private_email"} 37
# opf_latency_ms_sum{slot="memory",op="redact"} 3221.4
# opf_latency_ms_count{slot="memory",op="redact"} 142
# opf_fail_open_total{slot="events"} 0
# opf_fail_closed_total{slot="memory"} 0
```

## Common gotchas

- **First request is slow.** The model takes ~5 s to load on GPU and ~15 s
  on CPU. The bootstrap seal doesn't wait for it, so the very first agent
  write after `docker compose up` can take a few seconds extra. Subsequent
  writes are <20 ms (GPU) or 40-100 ms (CPU, 4-core).
- **Weights cache.** The first build pulls ~3 GB of weights into
  `/workspace/.cache/huggingface`. That cache persists across restarts;
  delete it to force a fresh download.
- **`local-gpu` with `gpu.backend=ollama-cuda`.** The sidecar itself runs
  inside the agentbox container, so it needs CUDA libraries available
  there — not just in the ollama sidecar. Use `gpu.backend=local-cuda` if
  you want the sidecar to actually hit the GPU; with `ollama-cuda` the
  sidecar will fall back to CPU (and `/health` will show `device=cpu`).
- **Mid-size CPU hosts.** 4 cores / 6 GB is the floor, not the sweet
  spot. On a 4-core laptop the p95 can push 150 ms for long prompts.
  If you're latency-sensitive, use GPU or drop `memory` to `soft`.

## Disabling it

Edit the manifest:

```toml
[privacy_filter]
enabled = false
mode    = "off"
```

Rebuild. The middleware reverts to pass-through and the supervisor block
stops being emitted entirely. The feature adds nothing to your image
when disabled.

## Further reading

- [ADR-008 — Privacy filter routing layer](../reference/adr/ADR-008-privacy-filter-routing.md)
- [ADR-005 — Pluggable adapter architecture](../reference/adr/ADR-005-pluggable-adapter-architecture.md) (why the middleware sits where it does)
- [openai/privacy-filter model card](https://huggingface.co/openai/privacy-filter)
- [openai/privacy-filter GitHub repo](https://github.com/openai/privacy-filter)
