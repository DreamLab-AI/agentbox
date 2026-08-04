# tab0-bridge — voice/nostr meta-controller for the tmux plane

Canonical source for the bridge that fronts the coordinator Claude Code session
to every remote surface: the Unmute voice loop (OpenAI-compatible
`/v1/chat/completions`), the browser voice console (`/feed` websocket,
`/tab0/send`, read-only `/tabs/:n` captures, `/aoe/sessions` status list), and
the Nostr plane (`/nostr/status`, `/nostr/events`, `/nostr/send`).

## Injection seam — repointed onto Agent of Empires (ADR-044)

The single write path is repointed off raw `tmux send-keys -t agentbox:0` onto
the Agent of Empires interaction plane ([ADR-044](../../docs/reference/adr/ADR-044-voice-plane-aoe-repoint.md),
WS5 of [PRD-021](../../docs/reference/prd/PRD-021-interaction-surface-consolidation.md)):

- `sendToTab0()` POSTs the intent to `POST /api/sessions/{id}/send` on the
  loopback AoE daemon (`AGENTBOX_INTERACTION_PLANE_PORT`, default `:9095`),
  which honours the per-agent paste-burst delay and **serialises** concurrent
  callers so voice and nostr injections cannot interleave keystrokes (D1).
- The coordinator session id is **resolved at start** via `GET /api/sessions`,
  matching the seed title `AOE_COORDINATOR_TITLE` (default `coordinator`,
  case-insensitive), pinned for the process lifetime, and **re-resolved on a
  404** (session drift after a daemon restart/reseed) (D2). A 30s interval
  re-resolves while unpinned so the id is picked up if AoE starts after the
  bridge.
- **FAIL-OPEN (D3):** when AoE is unreachable (refused, 404, transient) the seam
  degrades to the byte-identical legacy `tmux send-keys` path and logs the
  degradation — a down daemon never mutes the voice loop. The fallback is the
  degraded path (unaccounted, races AoE's watcher), never the steady state.
- The meta-controller's Bash allowlist (`metaAllowedTools()`) migrates from
  tmux send-keys to **curl against the AoE API**, with `send`/`output` pinned to
  the resolved coordinator id (send never targets an arbitrary session); the
  read-only `tmux list-windows`/`capture-pane` commands stay for legacy windows
  on the shared socket (D6).
- Loopback, no token: the daemon runs `--auth none --behind-proxy`, so a
  same-host POST needs no auth (D8 route 2, direct-loopback break-glass). The
  NIP-98 reverse proxy that is the sole ingress to `:9095` (ADR-043 D6) is a
  deployment concern in front of the bridge, not implemented here.
- **Untouched (D9):** the Unmute `/v1/chat/completions` + `/v1/models` LLM
  contract, the `/hook/turn` sink, `/feed`/`/turns`, and the `/nostr/*` surface.

**Deploy target is the workspace volume, not this directory.** The bridge
runs from `~/workspace/tab0-bridge` (persistent volume, survives image
rebuilds) so its Claude CLI OAuth cwd and `node_modules` stay stable.

**Lifecycle is automated — edit HERE, never the workspace copy.**
`deploy.sh` reconciles the workspace copy from this canonical source
(md5 compare — the image has no cmp/diff), installs deps on a fresh volume,
and (re)starts the bridge when it is down or its code changed. It is invoked
fire-and-forget by `config/hooks/fleet-session-start.sh` (job 3) on every
Claude SessionStart, same belt-and-braces pattern as the Nostr gateway.
Off switch: `AGENTBOX_TAB0_BRIDGE=0`. Manual run is always safe:

```sh
bash config/tab0-bridge/deploy.sh   # idempotent; restarts only on change
```

Claude Code hooks (`Stop`/`UserPromptSubmit` → `turn-sink.cjs` at the
workspace path) are registered idempotently by `entrypoint-unified.sh` at
boot, alongside the mirror and fleet hooks.

Key behaviours (see server.mjs header for the full surface list):

- LLM backend is headless `claude -p` on the subscription OAuth; an empty
  `ANTHROPIC_API_KEY` poisons the SDK credential chain, so the child env
  deletes it.
- The meta-controller relays intents into window 0 only, and is prompt- and
  code-gated to stay **quiet unless called upon**: the voice backend's `"..."`
  silence-marker turns short-circuit to an empty reply without an LLM call.
- Outbound Nostr rides `config/nostr-gateway/nostr-send.cjs` (fail-open);
  inbound audit is read from `~/.claude/nostr-inbox/commands.jsonl`.
