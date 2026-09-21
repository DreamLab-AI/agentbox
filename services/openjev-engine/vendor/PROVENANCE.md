# Vendored upstream code — `modeling_openjev.py`

| Field | Value |
|---|---|
| Upstream | `https://huggingface.co/AlexWortega/openjev` |
| Path | `modeling_openjev.py` (repository root) |
| **Pinned revision** | `4395b29714015162db6112de91c35688e6e42717` |
| **sha256** | `071670d0879963ee69600ed31f0f3d5a37bee314461709477e8ac0e25f33fd97` |
| Size | 13,789 bytes |
| Licence | MIT (repository-wide; see the model card) |
| Modified? | **No.** Byte-for-byte the upstream file, so the digest above is checkable. |
| Vendored | 2026-09-21 |

## Why this file is vendored rather than fetched

`OpenJevCrossEncoder` is *helper* code, not the model: the checkpoint's
`config.json` declares `architectures: ["Qwen3_5ForSequenceClassification"]`
with **no `auto_map`**, so `AutoModelForSequenceClassification.from_pretrained`
resolves a class that is native to `transformers` and needs **no
`trust_remote_code`**. What does need care is this wrapper, because the
documented way to get it is `from modeling_openjev import OpenJevCrossEncoder`
after downloading it from a repository whose default branch moves.

The repository is four days old and actively changing (the 4B v2 checkpoint,
the 35B MoE checkpoint and the `mlp_heads_35b/` heads all landed inside a
week). Code that is re-downloaded from `main` at image-build or container-start
time is code that can be replaced under us between two identical `docker
compose up` invocations, with no diff to review and no signature to check —
the ordinary remote-code supply-chain hazard, made sharper by the repository's
age. Two independent mitigations are applied:

1. **The helper is vendored here at a pinned revision** with its digest
   recorded, so it is reviewable in `git log -p` like any other source file and
   cannot change without a commit in this repository.
   `tests/test_vendor.py` fails if the bytes drift from the digest above.
2. **The weights are fetched with `revision=` pinned to the same commit SHA**
   (`openjev_engine/config.py:PINNED_REVISION`), never `main`. An unpinned
   model spec is refused at load time unless `OPENJEV_ALLOW_UNPINNED=1` is set
   deliberately.

## Refreshing the pin

Upstream changes are adopted explicitly, never implicitly:

```bash
REV=<new-commit-sha>
curl -fsSL "https://huggingface.co/AlexWortega/openjev/resolve/$REV/modeling_openjev.py" \
    -o services/openjev-engine/vendor/modeling_openjev.py
sha256sum services/openjev-engine/vendor/modeling_openjev.py
# update PINNED_REVISION + VENDORED_MODELING_SHA256 in openjev_engine/config.py,
# update this table, review the diff, re-run the eval before trusting it.
```

Re-running the eval is part of the refresh: the primitive mapping in
`runtime.py` depends on `predict_hypotheses` returning one
`[contradiction, entailment, neutral]` row per hypothesis in that order, and on
the shared-prefix path being entered at three or more hypotheses. Both are
properties of this file, not of the contract.
