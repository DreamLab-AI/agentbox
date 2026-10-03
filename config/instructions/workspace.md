# Agentbox workspace — container environment facts

Tool-neutral facts about this container for every coding agent. Behaviour and style belong to the global tier; project rules to each project's `AGENTS.md`.

## Discovery

`claude-flow doctor` (diagnostics) · `supervisorctl status` (services) · `AGENTS.md` in the agentbox checkout is the authoritative container/runtime reference.

## RuVector memory (single home for the environment rules)

```
conn       = ruvector-postgres:5432, db ruvector, $RUVECTOR_PG_CONNINFO
access     = memory MCP tools only (Claude: mcp__claude-flow__memory_*; Codex: agentbox-memory) — CLI and raw SQL INSERT bypass the embedding pipeline
             (bge-small-en-v1.5 via Xinference, 384-dim, client-side) → rows invisible to HNSW search
search     = plain memory_search (~100ms); namespace "*" = global cross-namespace
avoid      = memory_hybrid_search on large namespaces (materialises the namespace; ~72s on ruvnet-kb)
low-recall = ruvnet-kb / knowledge-* namespaces (scoped R@10 ~9-11%)
index-law  = after bulk ingest/delete: non-concurrent AND serial HNSW rebuild (m=16, ef_construction=128,
             max_parallel_maintenance_workers=0, ~8 min); parallel builds leave ~20% of rows unreachable.
             NEVER CREATE INDEX CONCURRENTLY on the ruvector HNSW AM (double-insertion)
embed-cap  = only the first ~2,500 chars of a value are embedded: keep values <~2,000 chars, front-load facts,
             split long detail into linked entries (retrieve-by-key still returns the whole value)
reference  = ~/workspace/docs/ruvector-system-reference.md
```

Namespaces: `personal-context` (index key `personal-context-portfolio-index`), `project-state` (index key `project-state-current-focus`).

## Agent sessions (Agent of Empires)

```
launch  = from any shell WITHOUT its own terminal (an agent's tool shell, a hook, cron): `aoe add … --launch --no-attach`,
          or `aoe add …` then `aoe session start <title>`, or plain `tmux new-session -d`
why     = `--launch`/`session attach` hand the CALLER's terminal to the session via `tmux switch-client`; with TMUX merely
          inherited that is the operator's client, every tab included, and their next prefix-d detaches it. The baked aoe
          refuses to attach from a non-tty shell and starts detached instead; the flag/env make the intent explicit
env     = AOE_NO_ATTACH=1 forces detached on every attach path
watch   = `aoe` TUI in tmux tab 8, `tmux attach -t <aoe_session>` from a terminal you own, or `aoe session capture`
```

## Host access & Docker builds

The host Docker socket makes builds launched in here *look* like they work, but bind paths resolve against the **host** filesystem, so they silently bake stale code. Edit sources here; launch the host project's builds from the host shell (its tmux tab), and monitor from here with `tmux capture-pane` and `docker exec`. Do not SSH to the host.

Under `[security].role_isolation = true` (ADR-2122; off by default, staged), `docker exec` is no longer a monitoring path from in here. `DOCKER_HOST` points at the GET-only proxy `/run/docker-ro.sock`: `docker ps`, `logs` and `inspect` work, while `exec`, `run` and `cp` get 403. Monitor with `tmux capture-pane` and `docker logs`, and run anything that needs `exec` from the host shell. Under the flag, role secrets sit in the root-owned `/run/secrets/<role>/` and are unreadable to devuser. Signing goes through the identity port, `/run/secrets/ab-identity-port/identity.sock` (`nostr-pod-bridge sign-request <op>`).

## Claude Cowork

`cowork start|stop|status|restart|logs` — Claude Desktop Cowork on VNC :1. `claude-desktop --devtools|--doctor`.
