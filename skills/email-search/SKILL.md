---
name: email-search
description: >-
  Search and answer questions about the owner's private personal email archive via the
  local Private Email MCP Gateway. Use when the user asks anything that needs looking in
  their personal mail — "did I get an invoice from X", "when did Y email me about Z", "find
  the thread about my flight", "what's my account number with the bank", "summarize what
  HMRC sent me", "search for anyone called <name> in my email" — or wants new mail pulled in
  now (password resets, one-time codes, verification links). Defaults to privacy-sanitized
  answers; verbatim raw mail is an owner-authorised break-glass tier (see body). Skip for
  sending email, calendar, or work/non-personal mailboxes.
---

# Private Email Search (on-demand MCP gateway)

## What this is
A local, self-contained MCP gateway that searches the owner's personal email archive. All
reading and reasoning happen **locally** (Qwen3.8-27B dense + bge-m3 retrieval). The gateway
exposes **three tools across two access tiers**:

| Tool | Returns | Egress filter |
|------|---------|---------------|
| `ask_email` | sanitized gist + abstracted evidence (roles, date buckets, opaque `ref_id`) | **applied** (gpt-oss-safeguard) |
| `fetch_email_raw` | raw matches: real headers, sender, subject, date, full text | **bypassed** (break-glass) |
| `fetch_email_by_ref` | the full raw source message behind a `ref_id` | **bypassed** (break-glass) |
| `refresh_inbox` | pull new mail **now** (don't wait for the ~4h crawl); returns newest messages | n/a (ingest) |

Confirm capability at runtime: `GET <gateway_url>/health` reports
`"tools": ["ask_email","fetch_email_raw","fetch_email_by_ref","refresh_inbox"]` and `"raw_access":"enabled"`
when the allow-list is populated.

> **Default posture:** prefer `ask_email`. Reach for the raw tools only when the task genuinely
> needs verbatim content/metadata (exact dates, links, real senders) AND the caller is the
> owner. `ask_email` always sanitizes regardless of any pubkey you pass it — raw data comes
> only from the raw tools.

## Two-tier auth model
1. **Transport — bearer token.** Gates *any* call. Hard secret, sent as
   `Authorization: Bearer <token>`. Lives in `AGENTBOX_EMAIL_GATEWAY_TOKEN`. **Never** committed.
2. **Capability — Nostr pubkey.** Gates the *raw* tools on top of tier 1. Passed as the
   `nostr_pubkey` **argument**. Only keys on the server allow-list (`PRIVILEGED_NOSTR_PUBKEYS`)
   unlock raw data; everyone else gets `{"authorized": false}` and no data. Every attempt is
   logged with an 8-char fingerprint.

A Nostr **public** key is, by definition, the publishable half — an identity/capability token,
**not a secret**. Passing it in a tool argument is the intended design, not a leak. The thing
that "never leaves the box" is the **bearer token** and the Nostr **private** key — neither is
the pubkey. Read the operator pubkey from runtime env (**`AGENTBOX_X_ONLY_PUBKEY_HEX`**) at call
time; do not hardcode the literal hex into committed skill source.

## Connection
**Streamable-HTTP** MCP server with bearer auth on the host that holds the mail/index.
It now runs as the **`email-mcp-gateway`** container on the shared `visionclaw_network`,
so the canonical endpoint is `http://email-mcp-gateway:8765` — reached by docker service
name (survives IP reassignment), not a fixed LAN IP. Plain HTTP + bearer over the trusted
network (`http://`, not `https://`). Auto-registered in agentbox by the entrypoint when
`[skills.email_search] enabled = true`, `gateway_url` and `AGENTBOX_EMAIL_GATEWAY_TOKEN`
are set; it health-checks `GET <gateway_url>/health` and patches `.mcp.json`. Manual register:

```
claude mcp add --transport http email-gateway http://email-mcp-gateway:8765/mcp \
  --header "Authorization: Bearer <token>"
```

First query may be slow (models lazy-load); subsequent queries are fast until idle TTL.

### Backend model endpoint — the Ontology Loom façade (load-bearing, Aug 2026)
The gateway reasons **locally**, and as of Aug 2026 it reasons **through the Ontology Loom**, not a
raw model port. The Loom (VisionClaw PRD-025 / ADR-135; agentbox ADR-051) is a portable node with a
stable, **model-swappable façade** that adds ontology grounding and keeps email content on the LAN.

- **`REASONER_BASE_URL` = `http://192.168.2.132:8084/v1`** — the Loom façade, **colocated with
  the model on HP-Desktop** (Deployment A: `~/githubs/loom` docker container on `:8084`,
  delegating to the `loom-model` container on `:8085`). Reached over the LAN via the existing ml DNAT — the
  SAME endpoint value the gateway historically used, but `:8084` is now the **Loom façade**, not a
  raw model port. It scaffold-injects ontology context, then delegates to the local model. (A
  Deployment-B sidecar — `http://loom:8080` on `visionclaw_network`, compose profile `loom` — is
  the alternative topology when you want the Loom colocated with consumers instead of the model.)
- **Why the façade, not the model port** — the deployed model changes based on benchmark results and
  plans (Muse ↔ Gemma ↔ next), and swapping it must be **invisible to email**. The Loom is that
  indirection: consumers hold a stable endpoint; the model is a URL behind it. This is the
  "no technical debt on upgrade" guarantee — the same reason a stale raw-model URL used to hang the
  gateway (see the Aug-2026 bullet in [Failure handling](#failure-handling)).
- **Privacy + grounding as one subunit** — routing through the Loom means email prompts are
  ontology-grounded (benchmark: static scaffold lifts grounded recall ~3.5×, and ~3–6× faster than
  cold parametric reasoning) AND never leave the LAN: the Loom delegates only to the LAN/local model
  behind `DISTILL_BACKEND_URL`, never to a cloud endpoint. The Loom is the email privacy system.
- **Current model behind the Loom** — **Qwen3.8-27B** (cutover 2026-08-14; runs inside the Loom
  stack as the `loom-model` container on `:8085`). This is a **swappable** choice behind the Loom
  façade — earlier deployments (Muse, Gemma) sat here before it, and the next will sit here after,
  with **zero change to the gateway**. Reached by the Loom over the LAN rail; HP is downstream of
  machinelearn with **no LAN IP** (`hp-nat.service` DNAT over the 25 G rail; old `192.168.2.48` is <!-- lint-ok -->
  **dead**). To change the model, change the Loom's backend — **the gateway config does not change.**
  - **Backend-swap runbook** (verified 2026-08-25, Gemma↔Qwen). The serving model is a host-network
    `loom-model` container binding `:8085`; alternates are parked as `loom-model-<name>bak`
    (`Exited`). Only one can hold `:8085`, so swap by stop-park-promote-start over `ssh john@10.10.10.1`:
    `docker stop loom-model` → `docker rename loom-model loom-model-<old>bak` →
    `docker rename loom-model-<new>bak loom-model` → `docker start loom-model`. Both carry
    `restart-policy=unless-stopped`, so a manually-stopped alternate stays down and won't fight for
    the port. Confirm the target's GGUF first (`docker inspect <c> --format '{{range .Config.Env}}…'`
    — check `MAIN_GGUF`/`ALIAS`) so you promote the right one. Verify:
    `curl -s :8084/v1/models` shows the new alias and `/health` shows `backend_reachable:true`, then
    smoke-test a real `/v1/chat/completions` (reasoning models need `max_tokens≥2048` or they return
    empty). Gotcha: HP's login shell is fish — `set -e` in the SSH heredoc errors harmlessly; the
    `docker` lines still run. Swap is reversible: the parked `<old>bak` container restores the same way.
- **Embeddings** — served on **machinelearn** at **`:9997`** (bge models on xinference), unchanged.

The gateway container is on the `visionclaw_network` bridge at `email-mcp-gateway:8765`. A stale
`REASONER_BASE_URL` (anything pointing at a raw model port or `192.168.2.48`) is the top suspect for <!-- lint-ok -->
hangs — point it at `http://loom:8080/v1` and let the Loom own the model path.

## Tier 1 — `ask_email` (default, sanitized)
**Input:** `query` (required); optional `date_from`, `date_to` (ISO), `sender`, `folder`, `top_k`.

**Output (schema-abstracted — NOT raw mail):**
```json
{
  "answer": "natural-language answer, already sanitized",
  "evidence": [
    { "ref_id": "opaque-hash", "sender_role": "bank|employer|family|vendor|unknown",
      "period": "2024-Q1", "topic": "invoice|travel|medical|legal|...",
      "abstract": "1-2 sentence sanitized gist, PII masked",
      "policy_label": "ok|redacted|dropped" }
  ],
  "dropped_count": 0
}
```
Lead with `answer`; cite evidence by `topic`+`period`+`sender_role`. If `dropped_count > 0` or
items are `dropped`/`redacted`, tell the user some matches were withheld; don't speculate. If
empty, report no match and offer to widen the window. The `ref_id` here is the handle you pass
to `fetch_email_by_ref` to pull the full message.

## Tier 2 — raw / break-glass (owner-authorised)

### `fetch_email_raw(query, nostr_pubkey, date_from?, date_to?, sender?, folder?, top_k?)`
Semantic search → raw matches. Use when you have a topic but no `ref_id`.
- `nostr_pubkey` — operator pubkey from env. Accepts bare 64-char hex, `0x…`, or `nostr:…`;
  case-insensitive. **`npub1…` bech32 is NOT accepted — use hex.**
- `top_k` defaults to `RAW_TOP_K` (12). Authorised response: `{"authorized":true,"mode":"raw",
  "answer":"…","results":[{ref_id,message_id,sender,sender_domain,date_iso,folder,subject,text,
  chunk_idx,score}],"count":N}`.

### `fetch_email_by_ref(ref_id, nostr_pubkey)`
Resolve an `ask_email` `ref_id` back to the whole source message (all chunks, real headers,
joined text). Authorised response: `{"authorized":true,"found":true,"ref_id":"…",
"message":{…headers…},"text":"full text","chunks":[…]}`.

### `refresh_inbox(nostr_pubkey, full?)` — pull new mail NOW
On-demand IMAP pull from Proton Bridge instead of waiting for the ~4h scheduled crawl. Use when the
mail you need **just arrived** and is time-sensitive: **password resets, one-time codes, verification
links, expected replies from Simplilearn**. `full=false` (default) fetches only new mail from the saved
watermark (seconds); `full=true` re-crawls everything (minutes — avoid). Runs server-side; nothing is
written to any repo. Returns `{status, mode, new_chunks, indexed_chunks, newest_date_iso,
newest:[{ref_id,sender,sender_domain,date_iso,folder,subject}...]}`.
Handle `status`: `ok` · `busy` (a crawl is running — wait a few s, retry) · `error` (transient; retry
or fall back to the existing index) · `unconfigured` (IMAP creds unset; index still searchable).

**Reset / expected-reply pattern (pull → read):**
`refresh_inbox(nostr_pubkey)` → scan `newest[]` for the sender/subject → `fetch_email_by_ref(ref_id,
nostr_pubkey)` to read the code/link verbatim. Don't search a stale index for mail sent seconds ago.

### Unauthorised response (either raw tool)
`{"authorized": false, "error": "Nostr pubkey not authorized for raw (unfiltered) access. Use
ask_email …"}` → the pubkey isn't on the allow-list: check you sent the operator's power-user
pubkey **in hex** (not `npub`, not empty).

### Recommended workflow
Cheap discovery, then targeted raw pull:
1. `ask_email(query)` → read sanitized `evidence[]`, pick the `ref_id`(s) that matter.
2. `fetch_email_by_ref(ref_id, nostr_pubkey)` → pull the full message for those.

Or pull raw hits directly: `fetch_email_raw("Simplilearn schedule dates", nostr_pubkey,
date_from="2026-05-01")`. Large pulls can exceed the tool output cap — the harness saves them to
a results file; process big pulls in a subagent so verbatim bodies stay out of the main context.

## Data handling for raw output
Authorisation to **read** is settled by the allow-list (the owner put their key there). What
remains is **where the output goes**:
- Default: use raw mail to answer the owner's own question, then treat it as private — **do not**
  write raw message text into committed files/repos/logs, and **do not** forward it to any
  external service.
- **Project override:** a project's `CLAUDE.md` may issue a standing order that authorises storing
  raw mail inside that project's own (private) repo for ongoing work. Honour such an order *for
  that project only*; it does not relax the default elsewhere. Keep the repo private.

## Don'ts
❌ Don't expect raw bodies from `ask_email` — it always sanitizes; use the raw tools.
❌ Don't pass an `npub` to the raw tools — hex only.
❌ Don't bake the literal pubkey or bearer token into committed source.
❌ Don't use this for work mailboxes, calendar, or sending mail.

## Failure handling
- Tool missing → enable `[skills.email_search]` + set token env, or register manually; confirm
  LAN routing to the gateway.
- **Gateway hangs / `refresh_inbox` 180 s timeouts / whole-session unreachability *after the Aug
  2026 network rework*** → the **reasoning-LLM route moved**, not the gateway. **Confirmed + fixed
  10 Aug 2026:** the gateway's **`REASONER_BASE_URL`** was still `http://192.168.2.48:8084/v1` — <!-- lint-ok -->
  HP's dead old LAN IP — so every synthesis black-holed while `GET /health` still answered (container
  healthy on `visionclaw_network`, safeguard + embedder ready). Symptom fingerprint is exactly that
  split: health green, all reasoning calls stall to timeout. **Fix:** set
  `REASONER_BASE_URL=http://192.168.2.132:8084/v1` (ml DNATs to the Loom façade on HP, which
  delegates to the current `loom-model` container on `:8085` over the rail) and recreate the
  container. **Verify** from the gateway host / `visionclaw_network`:
  `curl -s http://192.168.2.132:8084/v1/models` should return the real model list — currently
  Qwen3.8-27B (`{"models":[{"name":"Qwen3.8-27B"…}]}`); the exact name tracks whatever model is
  deployed behind the Loom, so match it to the current backend rather than a fixed string. Ref:
  `dreamlab-cumbria/infrastructure/network/experiments/deployed/hp-nat.sh` (DNAT + MSS-clamp) and
  `/compute/README.md`.
- Auth/401 (transport) → bearer token wrong/expired; re-provision.
- `{"authorized": false}` (capability) → wrong/empty pubkey, or `npub` instead of hex, or key not
  on the gateway allow-list (`PRIVILEGED_NOSTR_PUBKEYS`).
- Timeout on first call → models warming; retry once (don't hammer with parallel calls).
- **Tools absent for the whole session, but the gateway is healthy** → Claude Code's MCP client
  disables an HTTP/SSE server for the entire session if its startup `initialize` handshake exceeds
  `MCP_TIMEOUT`, and it does **not** retry HTTP servers after boot. The gateway reasons with a local
  LLM (30s+ per call) and holds SSE streams open, so a cold backend at session start trips this.
  Durable fix (in the build, applied on next nix buildout): container env `MCP_TIMEOUT=60000` +
  `MCP_TOOL_TIMEOUT=180000` (set in `flake.nix`, tunable via `[skills.email_search]
  .mcp_startup_timeout_ms / .mcp_tool_timeout_ms`), plus a detached boot warm-up in
  `config/entrypoint-unified.sh` that primes the backend so the first session's handshake is fast.
- **Mid-session recovery when the client link is already down** (can't wait for a rebuild): drive the
  gateway directly over JSON-RPC. It is a streamable-HTTP MCP server — POST to `$AGENTBOX_EMAIL_GATEWAY_URL/mcp`
  with `Authorization: Bearer $AGENTBOX_EMAIL_GATEWAY_TOKEN`, `Accept: application/json, text/event-stream`,
  do `initialize` → capture the `Mcp-Session-Id` response header → `notifications/initialized` →
  `tools/call`. Verified working when the harness tools were disconnected (2026-07-06). The container
  itself never went down; only the harness client link did.
