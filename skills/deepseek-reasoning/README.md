# DeepSeek Reasoning Skill

MCP bridge for DeepSeek special model reasoning, connecting Claude Code (devuser) to isolated deepseek-user.

## Quick Start

### 1. Installation

```bash
# Copy to container
docker cp skills/deepseek-reasoning agentic-workstation:/home/devuser/.claude/skills/

# Set permissions
docker exec agentic-workstation bash -c "
  chmod +x /home/devuser/.claude/skills/deepseek-reasoning/mcp-server/server.js
  chmod +x /home/devuser/.claude/skills/deepseek-reasoning/tools/deepseek_client.js
  chown -R devuser:devuser /home/devuser/.claude/skills/deepseek-reasoning
"
```

### 2. Configuration

Already configured in `/home/deepseek-user/.config/deepseek/config.json`:

```json
{
  "apiKey": "sk-d76e012d700a4cd3983f93c056aafee0",
  "availableEndpoints": {
    "special": "https://api.deepseek.com/v3.2_speciale_expires_on_20251215"
  },
  "models": {
    "chat": "deepseek-chat"
  }
}
```

### 3. Add to Supervisord

Add to `/home/devuser/.config/supervisord.unified.conf`:

```ini
[program:deepseek-reasoning-mcp]
command=/usr/local/bin/node /home/devuser/.claude/skills/deepseek-reasoning/mcp-server/server.js
directory=/home/devuser/.claude/skills/deepseek-reasoning/mcp-server
user=devuser
environment=HOME="/home/devuser",DEEPSEEK_USER="deepseek-user"
autostart=true
autorestart=true
priority=530
stdout_logfile=/var/log/deepseek-reasoning-mcp.log
stderr_logfile=/var/log/deepseek-reasoning-mcp.error.log
```

### 4. Start Service

```bash
docker exec agentic-workstation supervisorctl reread
docker exec agentic-workstation supervisorctl add deepseek-reasoning-mcp
docker exec agentic-workstation supervisorctl start deepseek-reasoning-mcp
```

## Usage from Claude Code

Once MCP server is running, tools are available:

```javascript
// Complex reasoning
const reasoning = await deepseek_reason({
  query: "Why does binary search achieve O(log n)?",
  format: "structured"
});

// Code analysis
const analysis = await deepseek_analyze({
  code: readFileSync('app.js', 'utf8'),
  issue: "Memory leak in event handlers",
  depth: "deep"
});

// Task planning
const plan = await deepseek_plan({
  goal: "Implement rate limiter",
  constraints: "Redis-backed, 1000 req/s",
  granularity: "medium"
});
```

## Manual Testing

Test individual components:

```bash
# Test client directly as deepseek-user
docker exec -u deepseek-user agentic-workstation node \
  /home/devuser/.claude/skills/deepseek-reasoning/tools/deepseek_client.js \
  --tool deepseek_reason \
  --params '{"query":"What is 2+2?","format":"steps"}'

# Test MCP server
echo '{"method":"tools/list","params":{},"id":1}' | \
docker exec -i agentic-workstation \
  /home/devuser/.claude/skills/deepseek-reasoning/mcp-server/server.js
```

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
│ - Receives tool call                            │
│ - Validates parameters                          │
│ - Bridges to deepseek-user                      │
└─────────────────┬───────────────────────────────┘
                  │ sudo -u deepseek-user
┌─────────────────▼───────────────────────────────┐
│ DeepSeek Client (deepseek-user)                 │
│ - Loads credentials from config                 │
│ - Constructs reasoning prompt                   │
│ - Calls special endpoint                        │
└─────────────────┬───────────────────────────────┘
                  │ HTTPS
┌─────────────────▼───────────────────────────────┐
│ DeepSeek Special Endpoint                       │
│ api.deepseek.com/v3.2_speciale_...              │
│ - Processes with thinking mode                  │
│ - Returns structured reasoning                  │
└─────────────────────────────────────────────────┘
```

## Files

```
deepseek-reasoning/
├── SKILL.md                # Skill documentation (read by Claude Code)
├── README.md               # Installation and usage
├── mcp-server/
│   └── server.js          # MCP protocol server (runs as devuser)
└── tools/
    └── deepseek_client.js # API client (runs as deepseek-user)
```

## Security

- **Credentials isolated:** API key only accessible to deepseek-user
- **User bridge:** MCP server uses sudo to execute as deepseek-user
- **No credential exposure:** devuser never sees API key
- **Workspace isolation:** `/home/deepseek-user/workspace` separate

## Hybrid Workflow

**Best practice:** Use DeepSeek for planning, Claude for execution

1. Complex problem arrives
2. Claude recognizes need for reasoning
3. Calls `deepseek_reason()` or `deepseek_plan()`
4. DeepSeek provides structured chain-of-thought
5. Claude synthesizes into polished code/response

**Example:**
```
User: "Build a distributed lock manager"
  ↓
Claude: [Detects complexity] → deepseek_plan()
  ↓
DeepSeek: Returns 15-step plan with reasoning
  ↓
Claude: Implements each step with clean code
  ↓
Result: Production-ready implementation with tests
```

## Troubleshooting

### MCP server won't start
```bash
# Check logs
docker exec agentic-workstation tail -f /var/log/deepseek-reasoning-mcp.error.log

# Verify Node.js
docker exec agentic-workstation which node

# Check permissions
docker exec agentic-workstation ls -la /home/devuser/.claude/skills/deepseek-reasoning/
```

### "sudo: deepseek-user: command not found"
```bash
# Verify deepseek-user exists
docker exec agentic-workstation id deepseek-user

# Check sudo config
docker exec agentic-workstation grep deepseek-user /etc/sudoers
```

### API errors
```bash
# Test endpoint directly
docker exec -u deepseek-user agentic-workstation curl \
  https://api.deepseek.com/v3.2_speciale_expires_on_20251215/v1/models \
  -H "Authorization: Bearer sk-d76e012d700a4cd3983f93c056aafee0"

# Verify config
docker exec agentic-workstation cat /home/deepseek-user/.config/deepseek/config.json
```

## Performance

- **Latency:** 2-5 seconds (includes reasoning time)
- **Token usage:** 200-500 tokens per reasoning query
- **Concurrency:** 1 request at a time (special endpoint)
- **Quality:** Excellent for multi-step logic

## See Also

- Main skill docs: `SKILL.md`
- Setup guide: `/DEEPSEEK_SETUP_COMPLETE.md`
- API verification: `/DEEPSEEK_API_VERIFIED.md`
