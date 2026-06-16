---
name: email-search
description: >-
  Answer questions about the owner's private personal email archive via the local
  Private Email MCP Gateway. TRIGGER when the user asks anything that requires looking
  in their personal email — "did I get an invoice from X", "when did Y email me about Z",
  "find the thread about my flight", "what's my account number with the bank", "summarize
  what HMRC sent me", "search for anyone called <name> in my email". The gateway runs
  locally and reasons over the mail archive with a local model. It exposes TWO access tiers:
  `ask_email` returns privacy-sanitized, schema-abstracted results (default, safe); and the
  break-glass pair `fetch_email_raw` / `fetch_email_by_ref` return RAW verbatim mail (real
  senders, subjects, dates, links, full text) and are gated by an owner-allow-listed Nostr
  pubkey capability token. SKIP for sending email, calendar, or non-personal/work mailboxes.
---

# Private Email Search (on-demand MCP gateway)

## What this is
A local, self-contained MCP gateway that searches the owner's personal email archive. All
reading and reasoning happen **locally** (abliterated Qwen + bge-m3 retrieval). The gateway
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
External **streamable-HTTP** MCP server with bearer auth on the LAN host that holds the
mail/index. Plain HTTP + bearer over the trusted LAN (`http://`, not `https://`). Auto-registered
in agentbox by the entrypoint when `[skills.email_search] enabled = true`, `gateway_url` and
`AGENTBOX_EMAIL_GATEWAY_TOKEN` are set; it health-checks `GET <gateway_url>/health` and patches
`.mcp.json`. Manual register:

```
claude mcp add --transport http email-gateway http://<host>:8765/mcp \
  --header "Authorization: Bearer <token>"
```

First query may be slow (models lazy-load); subsequent queries are fast until idle TTL.

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
- Auth/401 (transport) → bearer token wrong/expired; re-provision.
- `{"authorized": false}` (capability) → wrong/empty pubkey, or `npub` instead of hex, or key not
  on the gateway allow-list (`PRIVILEGED_NOSTR_PUBKEYS`).
- Timeout on first call → models warming; retry once (don't hammer with parallel calls).
