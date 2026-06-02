---
name: email-search
description: >-
  Answer questions about the owner's private personal email archive via the local
  Private Email MCP Gateway. TRIGGER when the user asks anything that requires looking
  in their personal email — "did I get an invoice from X", "when did Y email me about Z",
  "find the thread about my flight", "what's my account number with the bank", "summarize
  what HMRC sent me", "search for anyone called <name> in my email". The gateway runs
  locally, reasons over the mail archive with a local model, and returns ONLY
  privacy-sanitized, schema-abstracted results — never raw mail.
  SKIP for sending email, calendar, or non-personal/work mailboxes.
---

# Private Email Search (on-demand MCP gateway)

## What this is
A local, self-contained MCP gateway that searches the owner's personal email archive.
All reading and reasoning happen **locally** (abliterated Qwen + bge-m3 retrieval); an
on-box privacy filter (gpt-oss-safeguard) **sanitizes every response to a fixed schema**
before it reaches you. You receive abstractions, never verbatim mail.

> Privacy contract: you (Claude) are an *untrusted* consumer here. The gateway deliberately
> withholds raw email text. Do not ask for, infer around, or try to reconstruct redacted
> content. Work with the abstracted evidence you are given.

## Connection
The gateway is an external **streamable-HTTP** MCP server with bearer auth, running on the
LAN host that holds the mail/index. Transport is **plain HTTP + bearer over the trusted LAN**
(no TLS unless a reverse proxy is put in front — use `http://`, not `https://`).

In agentbox it is auto-registered by the entrypoint when the skill is enabled and the
gateway env vars are present (mirrors the browser-gpu sidecar pattern):

- `agentbox.toml` → `[skills.email_search] enabled = true` and `gateway_url = "http://<host>:8765"`
- env → `AGENTBOX_EMAIL_GATEWAY_TOKEN` (the bearer token; **never** committed to the repo)

The entrypoint health-checks `GET <gateway_url>/health` (auth-exempt, returns 200 with
`{"status":"ok","index_ok":true,...}`) and, if reachable, patches `.mcp.json` with:

```json
{
  "type": "http",
  "url": "http://<host>:8765/mcp",
  "headers": { "Authorization": "Bearer <token>" }
}
```

To register manually from any LAN client:

```
claude mcp add --transport http email-gateway http://<host>:8765/mcp \
  --header "Authorization: Bearer <token>"
```

The first query may be slow (models lazy-load). Subsequent queries are fast until idle TTL.

## The only tool: `ask_email`
Use it for ANY personal-email question. Do not fabricate email contents — if `ask_email`
is unavailable or returns nothing, say so.

**Input**
- `query` (required): the natural-language question.
- `date_from`, `date_to` (optional, ISO): bound the search window.
- `sender` (optional): narrow by sender (matched server-side).
- `folder` (optional): e.g. inbox, archive, sent.
- `top_k` (optional): max evidence items (default server-side).

**Output (schema-abstracted — NOT raw mail)**
```json
{
  "answer": "natural-language answer, already sanitized",
  "evidence": [
    {
      "ref_id": "opaque-hash",
      "sender_role": "bank | employer | family | vendor | unknown",
      "period": "2024-Q1",
      "topic": "invoice | travel | medical | legal | ...",
      "abstract": "1-2 sentence sanitized gist, PII masked",
      "policy_label": "ok | redacted | dropped"
    }
  ],
  "dropped_count": 0
}
```

## How to use the result
- Lead with `answer`. Cite supporting `evidence` by `topic` + `period` + `sender_role`
  (e.g. "a vendor invoice from 2024-Q1"). Never present `ref_id` as if it were a real message ID.
- If `dropped_count > 0` or items are `dropped`/`redacted`, tell the user some matches were
  withheld by the privacy policy — do not speculate about their contents.
- If `answer` is empty / `evidence` is empty, report no matching mail was found; offer to
  refine the query or widen the date range. Do not invent details.

## Good vs bad

✅ "Find any invoices from my electricity supplier last winter, with amounts."
→ `ask_email({query:"electricity supplier invoices and amounts", date_from:"2024-11-01", date_to:"2025-03-01"})`

✅ "When did the bank last email me about the mortgage?"
→ `ask_email({query:"mortgage correspondence from the bank", sender:"bank"})`

✅ "Search for anyone called Steven in my email."
→ `ask_email({query:"emails from or mentioning someone named Steven"})`

❌ Do not call `ask_email` to fetch raw email bodies to paste back verbatim — the gateway
will not return them and that defeats the privacy design.
❌ Do not use this for work email, calendar, or to send mail.

## Failure handling
- Tool missing → instruct user to enable `[skills.email_search]` + set the token env, or
  register manually (see Connection). On the LAN, confirm the host can route to the gateway.
- Auth/401 → bearer token is wrong or expired; ask the user to re-provision.
- Timeout on first call → model warming up; retry once.
