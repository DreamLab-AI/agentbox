# DeepSeek Reasoning — Install, Configure, Operate

MCP bridge for the DeepSeek special model, invoked directly by Claude Code as the current user.

## Architecture

```
┌─────────────────────────────────────────────────┐
│ Claude Code (devuser)                           │
│ - Detects complex query needing reasoning       │
│ - Invokes MCP tool: deepseek_reason()           │
└─────────────────┬───────────────────────────────┘
                  │ MCP Protocol (stdio)
┌─────────────────▼───────────────────────────────┐
│ DeepSeek MCP Server (devuser)                   │
│ - Receives tool call, validates parameters      │
│ - Spawns deepseek_client.js directly            │
└─────────────────┬───────────────────────────────┘
                  │ node tools/deepseek_client.js (direct spawn, current user)
┌─────────────────▼───────────────────────────────┐
│ DeepSeek Client (devuser)                       │
│ - Loads credentials from config                 │
│ - Constructs reasoning prompt                   │
│ - Calls special endpoint                        │
└─────────────────┬───────────────────────────────┘
                  │ HTTPS
┌─────────────────▼───────────────────────────────┐
│ DeepSeek Special Endpoint (api.deepseek.com)    │
│ - Processes with thinking mode                  │
│ - Returns structured reasoning                  │
└─────────────────────────────────────────────────┘
```

## Files

```
deepseek-reasoning/
├── SKILL.md                # Skill entry (read by Claude Code)
├── references/             # Depth loaded on demand
│   ├── tools.md            # Tool signatures + return schemas
│   ├── workflows.md        # Usage, hybrid workflow, advanced usage
│   └── operations.md       # This file — install/config/ops
├── mcp-server/
│   └── server.js           # MCP protocol server (runs as devuser)
└── tools/
    └── deepseek_client.js  # API client (runs as devuser, spawned directly)
```

## Installation

```bash
# Copy to container
docker cp skills/deepseek-reasoning <host-container>:/home/devuser/.claude/skills/

# Set permissions
docker exec <host-container> bash -c "
  chmod +x /home/devuser/.claude/skills/deepseek-reasoning/mcp-server/server.js
  chmod +x /home/devuser/.claude/skills/deepseek-reasoning/tools/deepseek_client.js
  chown -R devuser:devuser /home/devuser/.claude/skills/deepseek-reasoning
"
```

## Configuration

Credentials live in `$HOME/.config/deepseek/config.json` (typically
`/home/devuser/.config/deepseek/config.json`), mode `0600`, owned by `devuser`:

```json
{
  "apiKey": "${DEEPSEEK_API_KEY}",
  "availableEndpoints": {
    "special": "https://api.deepseek.com/v3.2_speciale_expires_on_20251215"
  },
  "models": {
    "chat": "deepseek-chat"
  }
}
```

Environment-variable form:

```bash
DEEPSEEK_API_KEY=sk-[your deepseek api key]
DEEPSEEK_SPECIAL_ENDPOINT=https://api.deepseek.com/v1
DEEPSEEK_MODEL=deepseek-chat  # Verify current model name at https://platform.deepseek.com/docs — model IDs change with API versions.
```

## Supervisord

Add to `/home/devuser/.config/supervisord.unified.conf`:

```ini
[program:deepseek-reasoning-mcp]
command=/usr/local/bin/node /home/devuser/.claude/skills/deepseek-reasoning/mcp-server/server.js
directory=/home/devuser/.claude/skills/deepseek-reasoning/mcp-server
user=devuser
environment=HOME="/home/devuser"
autostart=true
autorestart=true
priority=530
stdout_logfile=/var/log/deepseek-reasoning-mcp.log
stderr_logfile=/var/log/deepseek-reasoning-mcp.error.log
```

Start the service:

```bash
docker exec <host-container> supervisorctl reread
docker exec <host-container> supervisorctl add deepseek-reasoning-mcp
docker exec <host-container> supervisorctl start deepseek-reasoning-mcp
```

## Manual testing

```bash
# Test client directly
docker exec <host-container> node \
  /home/devuser/.claude/skills/deepseek-reasoning/tools/deepseek_client.js \
  --tool deepseek_reason \
  --params '{"query":"What is 2+2?","format":"steps"}'

# Test MCP server
echo '{"method":"tools/list","params":{},"id":1}' | \
docker exec -i <host-container> \
  /home/devuser/.claude/skills/deepseek-reasoning/mcp-server/server.js
```

## Security

- **Credentials protected:** API key stored in `$HOME/.config/deepseek/config.json` with mode `0600`.
- **Direct spawn:** the MCP server spawns `deepseek_client.js` as the current user — no sudo bridge, no separate OS user.
- **No global exposure:** the config file is readable only by its owner.
- MCP server and API client both run as `devuser`; no workspace separation is required.

## Performance

- **Latency:** 2-5 seconds (includes reasoning time).
- **Token usage:** 200-500 tokens per reasoning query; higher than standard (includes reasoning tokens).
- **Concurrency:** one request at a time (special endpoint).
- **Quality:** superior for multi-step logic, debugging, planning.
- **Cost:** special-endpoint pricing (check DeepSeek docs).

## Limitations

- Requires thinking mode (cannot disable).
- Verify current endpoint availability at https://platform.deepseek.com/docs.
- Higher latency than standard deepseek-chat.
- Reasoning tokens count toward usage.

## Troubleshooting

### "invalid_request_error: non-thinking mode"
- The special endpoint requires reasoning mode (automatic in this skill).

### MCP server won't start
```bash
docker exec <host-container> tail -f /var/log/deepseek-reasoning-mcp.error.log
docker exec <host-container> which node
docker exec <host-container> ls -la /home/devuser/.claude/skills/deepseek-reasoning/
```

### "Permission denied" errors
- Check `$HOME/.config/deepseek/config.json` exists with mode `0600`.
- Confirm the file is owned by `devuser`.

### API / API-key errors
```bash
# Test endpoint directly
docker exec <host-container> curl \
  https://api.deepseek.com/v3.2_speciale_expires_on_20251215/v1/models \
  -H "Authorization: Bearer <your-api-key>"

# Verify config
docker exec <host-container> cat /home/devuser/.config/deepseek/config.json
```
- Check the API key is valid and the special endpoint URL is correct.

### Slow responses
- Normal for a reasoning model (includes thinking time).
- Reduce `max_steps` if too slow.
- Use `format: quick`/`depth: quick` for faster responses.

## See also

- DeepSeek API docs: https://api-docs.deepseek.com/
- MCP protocol: https://github.com/anthropics/mcp
- Claude Code skills: https://docs.claude.ai/code/skills
