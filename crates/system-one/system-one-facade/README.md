# system-one-facade

The capacity-adapting Sovereign System One façade: a Jev-compatible ingress over
a local laya engine (SSO contract §1–§3, §10). Internal to this repository —
`publish = false`.

The protocol, the budget arithmetic and the two adaptations are
[`system-one-core`](../system-one-core)'s: this crate holds no second copy of
`fit_options`, `window_state`, the `aggregate_*` family or `expand_choice`, and
it hands its finished response back to `validate_response` so the standard
judges the server's own output. The one deliberate divergence is rubric
compression — see `src/compress.rs`, which states the measurement that justifies
it and the change to core that would retire it.

```
consumer (skill-route.cjs / jev-compaction)
   │  POST /v1/systemone     Jev wire format, Bearer auth when SSO_API_KEY is set
   ▼
system-one-facade  :8097          ← the sole ingress
   ├─ rubric compression   ≤ the engine's per-option ceiling, discriminative clause first
   ├─ option shortlisting  115 options → k that fits head_max_len
   ├─ state windowing      25k-token states → window_k windows, aggregated
   └─ embeddings           bge-small, SHA-256-keyed on-disk cache
   │  POST /predict
   ▼
laya-engine  127.0.0.1:8098       ← loopback only
```

## Routes

| route | purpose |
|---|---|
| `POST /v1/systemone` | the frozen wire format; answers are always expressed in the caller's own option keys |
| `GET /health` | 200 when the engine answers, **503 when it does not** (compose healthcheck) |
| `GET /v1/models` | the engine's real `max_len` / `head_max_len` / `option_max_len`, never a hard-coded guess |

## Configuration

Every variable, its default and its meaning is documented in the module
rustdoc: `cargo doc --no-deps -p system-one-facade`, module `config`. The ones
that change behaviour rather than plumbing:

| variable | default | effect |
|---|---|---|
| `SSO_SHORTLIST_K` | `8` | options kept when the full set will not fit |
| `SSO_SHORTLIST_ALWAYS` | `none,other` | keys never shortlisted away, so the judge can decline |
| `SSO_WINDOW_K` | `2` | state windows evaluated per question |
| `SSO_OPTION_MAX_TOKENS` | `48` | per-option ceiling assumed when the engine reports none |
| `SSO_OPTION_TOKEN_SAFETY` | `4` | margin held back, because core estimates chars/4 while the engine tokenises WordPiece |
| `SSO_API_KEY` | unset | when set, `Authorization: Bearer` is enforced |

## Two properties that are structural, not configurable

* **No cloud path.** `config::assert_lan` refuses a non-LAN engine or embeddings
  URL at startup, so `https://api.typesafe.ai/...` cannot be configured even by
  accident. There is no fallback branch anywhere in the binary.
* **No fabricated answers.** Every failure leaves as
  `{"error":{"code","message"}}`. The consumer owns fail-open; a consumer that
  cannot tell it is failing open is just returning a wrong answer.

## Operational notes measured on this estate

* laya's default `head_max_len = 192` fits only **two** compressed options, not
  eight. The façade logs a warning whenever the shortlist collapses below
  `shortlist_k`; `head_max_len = 512` is what k=8 needs (contract §10.4), and
  raising it is a *measured* choice — run `system-one-eval` at the setting.
* The `sso` honesty block follows core's shape: compression accounting rides
  inside `sso.shortlisted.<question>.compressed_option_tokens` as `max` and
  `mean`, and `shortlisted` is reported for every choice — `from == to` is how
  it says nothing was dropped.
* The estate's Xinference `/v1/embeddings` numbers its `index` field globally
  when it merges concurrent requests, so a 32-input request can come back
  indexed 4..35. The embeddings client trusts those numbers only when they form
  a genuine permutation of the batch, and otherwise falls back to input order.
