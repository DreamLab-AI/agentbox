# DeepSeek Reasoning — Operations

The real wiring is much simpler than a bespoke bridge would be: `consultant-deepseek`
is one of five uniform consultant MCP servers baked into the image and registered
declaratively in `skills/mcp.json`. There is no bundled server in this skill, no
credential file, and no supervisord program — the MCP client launches the server
on demand.

## Architecture

```
Claude Code
  ↓ MCP tool call: consult / health / cost_estimate
consultant-deepseek (stdio MCP server)
  /opt/agentbox/mcp/consultants/package/deepseek/server.js
  ↓ HTTPS
api.deepseek.com  (or $DEEPSEEK_BASE_URL)
```

## Registration (`skills/mcp.json`)

```json
"consultant-deepseek": {
  "command": "node",
  "args": ["/opt/agentbox/mcp/consultants/package/deepseek/server.js"],
  "type": "stdio",
  "env": { "AGENTBOX_DEEPSEEK_MODEL": "${AGENTBOX_DEEPSEEK_MODEL:-deepseek-v4-flash}" },
  "x-agentbox-gate": "env:AGENTBOX_CONSULTANTS_ENABLED",
  "x-agentbox-requires": [
    { "envset": "DEEPSEEK_API_KEY" },
    { "file": "/opt/agentbox/mcp/consultants/package/deepseek/server.js" }
  ]
}
```

The `agentbox-manifest` projector writes this entry at boot when
`AGENTBOX_CONSULTANTS_ENABLED` is set. There is nothing to install, symlink, or
`chmod` — the server ships baked in the image.

## Configuration

Environment variables only, read directly by the server process:

| Variable | Required | Default | Description |
|----------|----------|---------|--------------|
| `DEEPSEEK_API_KEY` | Yes | — | DeepSeek API key, inherited from session env |
| `DEEPSEEK_BASE_URL` | No | `https://api.deepseek.com` | Override the API endpoint |
| `AGENTBOX_DEEPSEEK_MODEL` | No | `deepseek-v4-flash` | Model id (`agentbox.toml` `[consultants.deepseek] model`) |

Configuration is environment variables only — there is no on-disk credential
file and no supervisord program. Documentation describing either predates
this MCP-launched-on-demand design and does not apply to this container.

## Manual testing

Check liveness without spending a paid call:

```
Use the health tool on consultant-deepseek (MCP), or from a shell with the
key exported:
curl -s https://api.deepseek.com/v1/models -H "Authorization: Bearer $DEEPSEEK_API_KEY"
```

Exercise a real consult from Claude Code by calling the `consult` tool with a
short `question` and checking the returned `tokens`/`cost_usd`.

## Security

- **Credentials**: `DEEPSEEK_API_KEY` is read from session environment only —
  no credential file on disk to protect or leak.
- **No workspace separation needed**: the server runs under the current
  profile, not a separate OS user (the historical pseudo-user model is
  retired estate-wide).
- Requests go straight to `api.deepseek.com` over HTTPS; no local proxy.

## Performance

- **Latency:** 2-5 seconds (includes reasoning time).
- **Concurrency:** the MCP client serialises calls per session; DeepSeek's own
  API has its own rate limits.
- **Quality:** strong for multi-step logic, debugging, planning; DeepSeek
  returns its chain-of-thought explicitly (see `references/tools.md`).
- **Cost:** call `cost_estimate` before a large `consult`; current baked
  pricing is $0.00055/1K prompt tokens and $0.00219/1K completion tokens.

## Troubleshooting

### `health` returns `ok: false`

- `last_error: "DEEPSEEK_API_KEY is not set"` — export `DEEPSEEK_API_KEY` in
  the session environment before the MCP server starts.
- `last_error: "HTTP 401"` or similar — the key is invalid or revoked; check
  the DeepSeek dashboard.
- Any other `last_error` — usually a transient network or endpoint issue;
  retry, then check `DEEPSEEK_BASE_URL` if you have overridden it.

### The tool doesn't appear at all

- Confirm the consultants gate is on: `AGENTBOX_CONSULTANTS_ENABLED` must be
  set for `agentbox-manifest` to project the `consultant-deepseek` entry into
  `skills/mcp.json` at boot.
- Confirm the file exists in the image:
  `ls /opt/agentbox/mcp/consultants/package/deepseek/server.js`.

### Slow responses

- Normal for a reasoning model (includes thinking time).
- Ask for a shorter or more scoped answer in `question` if latency matters —
  there is no `max_steps`/`depth` parameter to tune; the model decides how
  much reasoning to show.

## See also

- DeepSeek API docs: https://api-docs.deepseek.com/
- MCP protocol: https://github.com/anthropics/mcp
- `/opt/agentbox/mcp/consultants/shared/consultant-base.js` — the shared
  scaffolding every consultant server (codex, deepseek, perplexity,
  antigravity, zai) is built on.
