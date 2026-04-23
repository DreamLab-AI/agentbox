#!/bin/bash
# AGENTBOX ALIASES v11 (Enhanced with upstream improvements)
# Source this file or add to your shell profile: source agentbox-aliases.sh

# === CLAUDE CODE ===
alias claude-hierarchical="claude --dangerously-skip-permissions"
alias dsp="claude --dangerously-skip-permissions"

# === CLAUDE FLOW (orchestration) ===
alias cf="npx -y @claude-flow/cli@latest"
alias cf-init="npx -y @claude-flow/cli@latest init --force"
alias cf-swarm="npx -y @claude-flow/cli@latest swarm"
alias cf-hive="npx -y @claude-flow/cli@latest hive-mind spawn"
alias cf-spawn="npx -y @claude-flow/cli@latest hive-mind spawn"
alias cf-status="npx -y @claude-flow/cli@latest hive-mind status"
alias cf-help="npx -y @claude-flow/cli@latest --help"
alias cf-memory="npx -y @claude-flow/cli@latest memory"
alias cf-hooks="npx -y @claude-flow/cli@latest hooks"
alias cf-doctor="npx -y @claude-flow/cli@latest doctor --fix"
alias cf-daemon="npx -y @claude-flow/cli@latest daemon start"

cf-fix() {
    echo "🔧 Fixing claude-flow better-sqlite3 dependency..."
    NPX_CF_DIR=$(find ~/.npm/_npx -type d -name "claude-flow" 2>/dev/null | head -1)
    if [ -n "$NPX_CF_DIR" ]; then
        echo "📁 Found: $NPX_CF_DIR"
        (cd "$NPX_CF_DIR" && npm install better-sqlite3) && echo "✅ Fixed!" || echo "❌ Failed"
    else
        echo "⚠️ claude-flow not in cache. Running: npx -y @claude-flow/cli@latest --version"
        npx -y @claude-flow/cli@latest --version || true
        NPX_CF_DIR=$(find ~/.npm/_npx -type d -name "claude-flow" 2>/dev/null | head -1)
        if [ -n "$NPX_CF_DIR" ]; then
            (cd "$NPX_CF_DIR" && npm install better-sqlite3) && echo "✅ Fixed!" || echo "❌ Failed"
        fi
    fi
}

cf-task() { npx -y @claude-flow/cli@latest swarm "$@"; }

# === AGENTIC FLOW ===
alias af="npx -y agentic-flow"
alias af-run="npx -y agentic-flow --agent"
alias af-coder="npx -y agentic-flow --agent coder"
alias af-help="npx -y agentic-flow --help"

af-task() { npx -y agentic-flow --agent "$1" --task "$2" --stream; }

# === AGENTIC QE (testing) ===
alias aqe="npx -y agentic-qe"
alias aqe-init="npx -y agentic-qe init"
alias aqe-generate="npx -y agentic-qe generate"
alias aqe-flaky="npx -y agentic-qe flaky"
alias aqe-gate="npx -y agentic-qe gate"
alias aqe-mcp="npx -y aqe-mcp"

# === AGENTIC JUJUTSU (git) ===
alias aj="npx -y agentic-jujutsu"
alias aj-status="npx -y agentic-jujutsu status"
alias aj-analyze="npx -y agentic-jujutsu analyze"

# === CLAUDE USAGE ===
alias cu="claude-usage"
alias claude-usage="npx -y claude-usage-cli"

# === SPEC-KIT ===
alias sk="specify"
alias sk-init="specify init"
alias sk-check="specify check"
alias sk-here="specify init . --ai claude"
alias sk-const="specify constitution"
alias sk-spec="specify spec"
alias sk-plan="specify plan"
alias sk-tasks="specify tasks"
alias sk-impl="specify implement"

# === OPENSPEC (Fission-AI) ===
alias os="openspec"
alias os-init="openspec init"
alias os-list="openspec list"
alias os-view="openspec view"
alias os-show="openspec show"
alias os-validate="openspec validate"
alias os-archive="openspec archive"
alias os-update="openspec update"

# === AGTRACE (Agent Observability) ===
alias agt="agtrace"
alias agt-init="agtrace init"
alias agt-watch="agtrace watch"
alias agt-sessions="agtrace session list"
alias agt-grep="agtrace lab grep"
alias agt-mcp="agtrace mcp serve"

# === CLAUDISH (Multi-Model Proxy) ===
alias claudish="npx -y claudish"
alias claudish-models="npx -y claudish --models"
alias claudish-top="npx -y claudish --top-models"
alias claudish-grok="npx -y claudish --model x-ai/grok-code-fast-1"
alias claudish-gemini="npx -y claudish --model google/gemini-2.5-flash"
alias claudish-gpt="npx -y claudish --model openai/gpt-4o"
alias claudish-qwen="npx -y claudish --model qwen/qwen3-235b-a22b"

# === AI AGENT SKILLS ===
alias skills="npx ai-agent-skills"
alias skills-list="npx ai-agent-skills list"
alias skills-search="npx ai-agent-skills search"
alias skills-install="npx ai-agent-skills install"
alias skills-info="npx ai-agent-skills info"
alias skills-update="npx ai-agent-skills update"
alias skills-remove="npx ai-agent-skills remove"

# === MCP SERVERS ===
alias n8n-mcp="npx -y n8n-mcp"
alias mcp-playwright="npx -y @playwright/mcp@latest"
alias mcp-chrome="npx -y chrome-devtools-mcp@latest"

# === PAL MCP (Multi-Model AI) ===
alias pal="cd ~/.pal-mcp-server && ./run-server.sh"
alias pal-setup="cd ~/.pal-mcp-server && uv sync"

# === RUVECTOR (Vector Database) ===
alias rv="npx -y @ruvector/cli"
alias rv-init="npx -y @ruvector/cli init"
alias rv-search="npx -y @ruvector/cli search"
alias rv-postgres="npx -y @ruvector/postgres-cli"

# === GITHUB CLI ===
alias gh-pr="gh pr create"
alias gh-prv="gh pr view --web"
alias gh-prl="gh pr list"
alias gh-prm="gh pr merge"
alias gh-issue="gh issue create"
alias gh-issuev="gh issue view --web"
alias gh-issuel="gh issue list"
alias gh-repo="gh repo view --web"

# === ZELLIJ - WORKSPACES ===
alias t="zellij"
alias zl="zellij"
alias zn="zellij --session"
alias za="zellij attach"
alias zls="zellij list-sessions"
alias zka="zellij kill-all-sessions"
alias zk="zellij kill-session"
alias zr="zellij run --"
alias zrf="zellij run --floating --"

# === ZELLIJ - QUICK LAYOUTS ===
alias zdev="zellij --layout compact"
alias zmon="zellij --layout compact --session monitor"
alias zflo="zellij action toggle-floating-panes"
alias zsync="zellij action toggle-active-sync-tab"
alias zren="zellij action rename-session"
alias zstack="/opt/agentbox/scripts/zellij-stack.sh"
alias zclaude="/opt/agentbox/scripts/zellij-stack.sh claude-core"
alias zruflo="/opt/agentbox/scripts/zellij-stack.sh ruflo-orchestrator"
alias zqe="/opt/agentbox/scripts/zellij-stack.sh qe-fleet"
alias zdocs="/opt/agentbox/scripts/zellij-stack.sh docs-latex"

# === SUPERVISORD ===
alias svc="sudo /opt/venv/bin/supervisorctl"
alias svc-status="sudo /opt/venv/bin/supervisorctl status"
alias svc-restart="sudo /opt/venv/bin/supervisorctl restart"
alias svc-start="sudo /opt/venv/bin/supervisorctl start"
alias svc-stop="sudo /opt/venv/bin/supervisorctl stop"
alias svc-tail="sudo /opt/venv/bin/supervisorctl tail -f"
alias svc-log="sudo /opt/venv/bin/supervisorctl tail"

# === POSTGRESQL (RuVector Storage) ===
alias pg="sudo -u postgres psql"
alias pg-rv="sudo -u postgres psql -d ruvector"
alias pg-status="pg_isready"

# === USER SWITCHING (Container-specific) ===
alias as-gemini="sudo -u gemini-user -i"
alias as-openai="sudo -u openai-user -i"
alias as-zai="sudo -u zai-user -i"
alias as-deepseek="sudo -u deepseek-user -i"

# === GEMINI FLOW ===
alias gf="gemini-flow"
alias gf-init="gemini-flow init --protocols a2a,mcp --topology hierarchical"
alias gf-swarm="gemini-flow swarm --agents 66 --intelligent"
alias gf-architect="gemini-flow swarm --agents 5 --type system-architect"
alias gf-coder="gemini-flow swarm --agents 12 --type master-coder"
alias gf-status="gemini-flow status"
alias gf-monitor="gemini-flow monitor --protocols --performance"
alias gf-health="gemini-flow health"

# === Z.AI SERVICE ===
alias zai-health="curl -s http://localhost:9600/health | jq"
alias zai-chat="curl -X POST http://localhost:9600/chat -H 'Content-Type: application/json'"

# === CUDA DEVELOPMENT ===
alias nvcc-version="nvcc --version"
alias cuda-info="nvidia-smi && echo && nvcc --version"
alias ptx-compile="nvcc -ptx"

# === HELPER FUNCTIONS ===
generate-claude-md() { claude "Read the .specify/ directory and generate an optimal CLAUDE.md for this project based on the specs, plan, and constitution."; }

turbo-init() {
    echo "🚀 Initializing Agentbox workspace..."
    specify init . --ai claude 2>/dev/null || echo "⚠️ spec-kit init skipped"
    npx -y @claude-flow/cli@latest init --force 2>/dev/null || echo "⚠️ claude-flow init skipped"
    echo "✅ Workspace ready! Run: claude"
}

turbo-help() {
    echo "🚀 Agentbox Quick Reference"
    echo "─────────────────────────────"
    echo "claude          Start Claude Code"
    echo "dsp             Claude (skip permissions)"
    echo "cf-swarm        Claude Flow swarm mode"
    echo "cf-hive         Spawn hive-mind agents"
    echo "cf-memory       Memory operations"
    echo "cf-doctor       System diagnostics"
    echo "af-coder        Agentic Flow coder"
    echo "aqe             Agentic QE testing"
    echo "aj              Agentic Jujutsu (git)"
    echo "sk-here         Init spec-kit in current dir"
    echo "os-init         Init OpenSpec"
    echo "agt-watch       Live agent observability"
    echo "claudish        Multi-model proxy"
    echo "skills-list     Browse AI skills"
    echo "pal             Start PAL multi-model server"
    echo "n8n-mcp         n8n workflow MCP"
    echo "svc-status      Service status"
    echo "pg-rv           PostgreSQL ruvector DB"
    echo "gh-pr           GitHub create PR"
}

agent-load() {
    if [ -z "$1" ]; then
        echo "Usage: agent-load <agent-name>"
        echo "Available agents: $(ls $AGENTS_DIR/*.md 2>/dev/null | wc -l)"
        return 1
    fi
    local agent_file="$AGENTS_DIR/$1.md"
    if [ -f "$agent_file" ]; then
        cat "$agent_file"
    else
        echo "Agent not found: $1"
        echo "Try: ls $AGENTS_DIR/*.md | head -20"
    fi
}

agent-list() {
    echo "📋 Available Agents ($(ls $AGENTS_DIR/*.md 2>/dev/null | wc -l) total)"
    echo "─────────────────────────────────────────"
    ls -1 $AGENTS_DIR/*.md 2>/dev/null | xargs -I {} basename {} .md | head -30
    echo ""
    echo "Use 'agent-load <name>' to view an agent"
}

# === PATH ===
export PATH="$HOME/.local/bin:$HOME/.cargo/bin:/usr/local/bin:$PATH"

echo "✅ Agentbox aliases v11 loaded! (120+ aliases, 8 functions)"
echo "   Run 'turbo-help' for quick reference"
