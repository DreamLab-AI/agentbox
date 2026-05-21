#!/bin/bash
# AGENTBOX ALIASES v11 (Enhanced with upstream improvements)
# Source this file or add to your shell profile: source agentbox-aliases.sh

# === CLAUDE CODE ===
alias claude-hierarchical="claude --dangerously-skip-permissions"
alias dsp="claude --dangerously-skip-permissions"

# === CLAUDE FLOW (orchestration — Nix-packaged binary, no npx) ===
alias cf="claude-flow"
alias cf-init="claude-flow init --force"
alias cf-swarm="claude-flow swarm"
alias cf-hive="claude-flow hive-mind spawn"
alias cf-spawn="claude-flow hive-mind spawn"
alias cf-status="claude-flow hive-mind status"
alias cf-help="claude-flow --help"
alias cf-memory="claude-flow memory"
alias cf-hooks="claude-flow hooks"
alias cf-doctor="claude-flow doctor --fix"
alias cf-daemon="claude-flow daemon start"
alias cf-plugins="claude-flow plugins list"
alias cf-plugin-install="claude-flow plugins install -n"
alias cf-plugin-upgrade="claude-flow plugins upgrade -n"

cf-task() { claude-flow swarm "$@"; }

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

# === CODE-AS-HARNESS (PRD-008) ===
alias kernel-health="ls -la /var/lib/agentbox/code-interpreter-wheelhouse/.agentbox-wheelhouse-version 2>/dev/null && echo 'wheelhouse OK' || echo 'wheelhouse MISSING'"
alias code-harness-traces="ls -la /var/lib/agentbox/code-harness/traces-outbox/ 2>/dev/null | tail -10"
alias code-harness-audit="tail -f /var/lib/agentbox/code-harness/kernel-*.jsonl 2>/dev/null"
alias aci-submissions="ls -la /var/lib/agentbox/code-harness/aci-submissions/ 2>/dev/null"

# === BROWSER SIDECAR (browsercontainer on visionclaw_network) ===
alias cdp-sidecar="/opt/agentbox/skills/chrome-cdp/scripts/cdp-sidecar.sh"
alias browser-health="curl -s http://browsercontainer:8931/health | python3 -m json.tool"
alias browser-tabs="curl -s http://browsercontainer:9222/json/list | python3 -m json.tool"
alias browser-gpu="docker exec browsercontainer nvidia-smi --query-gpu=name,memory.used,utilization.gpu --format=csv,noheader 2>/dev/null || echo 'sidecar not running'"

# === PAL MCP (Multi-Model AI) ===
alias pal="cd ~/.pal-mcp-server && ./run-server.sh"
alias pal-setup="cd ~/.pal-mcp-server && uv sync"

# === RUFLO (orchestration — Nix-packaged binary, no npx) ===
alias rf="ruflo"
alias rf-swarm="ruflo swarm"
alias rf-plugins="ruflo plugins list"
alias rf-plugin-install="ruflo plugins install -n"

# === RUVECTOR (Vector Database — Nix-packaged binary, no npx) ===
alias rv="ruvector"
alias rv-init="ruvector init"
alias rv-search="ruvector search"
alias rv-postgres="ruvector postgres"

# === GITHUB CLI ===
alias gh-pr="gh pr create"
alias gh-prv="gh pr view --web"
alias gh-prl="gh pr list"
alias gh-prm="gh pr merge"
alias gh-issue="gh issue create"
alias gh-issuev="gh issue view --web"
alias gh-issuel="gh issue list"
alias gh-repo="gh repo view --web"

# === TMUX ===
alias ta="tmux attach -t agentbox"
alias tls="tmux list-sessions"
alias tks="tmux kill-session -t"

# === SUPERVISORD ===
alias svc="sudo /opt/venv/bin/supervisorctl"
alias svc-status="sudo /opt/venv/bin/supervisorctl status"
alias svc-restart="sudo /opt/venv/bin/supervisorctl restart"
alias svc-start="sudo /opt/venv/bin/supervisorctl start"
alias svc-stop="sudo /opt/venv/bin/supervisorctl stop"
alias svc-tail="sudo /opt/venv/bin/supervisorctl tail -f"
alias svc-log="sudo /opt/venv/bin/supervisorctl tail"

# === SOVEREIGN / PROFILE HELPERS ===
alias pod-root="cd /var/lib/solid/pods"
alias profiles="cd /workspace/profiles"
alias profile-claude="cd /workspace/profiles/claude-core"
alias profile-ruflo="cd /workspace/profiles/ruflo-orchestrator"
alias profile-qe="cd /workspace/profiles/qe-fleet"
alias profile-docs="cd /workspace/profiles/docs-latex"

# === ANTIGRAVITY CLI (Google, replaces gemini-cli) ===
alias zantigravity='zellij action launch-or-focus-plugin -- antigravity'
alias agy-help="agy --help"
alias agy-version="agy --version"
alias agy-login="agy auth login"

# === OPENAI CODEX RUST CLI (github.com/openai/codex rust-v0.124.0) ===
# Enabled via [toolchains.codex] = true in agentbox.toml.
alias zcodex='codex'
alias codex-help='codex --help'
alias codex-version='codex --version'

# === ANTIGRAVITY (Google) ===
alias agy-chat="agy chat"
alias agy-status="agy status"
alias agy-models="agy models list"

# === Z.AI SERVICE ===
alias zai-health="curl -s http://localhost:9600/health | jq"
alias zai-chat="curl -X POST http://localhost:9600/chat -H 'Content-Type: application/json'"

# === CUDA DEVELOPMENT ===
alias nvcc-version="nvcc --version"
alias cuda-info="nvidia-smi && echo && nvcc --version"
alias ptx-compile="nvcc -ptx"

# === HELPER FUNCTIONS ===
generate-claude-md() { claude "Read the .specify/ directory and generate an optimal CLAUDE.md for this project based on the specs, plan, and constitution."; }

agentbox-init() {
    if command -v gum >/dev/null 2>&1; then
        gum spin --spinner dot --title "Initialising spec-kit..." -- specify init . --ai claude 2>/dev/null || true
        gum spin --spinner dot --title "Initialising claude-flow..." -- claude-flow init --force 2>/dev/null || true
        gum style --foreground '#9ece6a' "Workspace ready — run: claude"
    else
        specify init . --ai claude 2>/dev/null || echo "spec-kit init skipped"
        claude-flow init --force 2>/dev/null || echo "claude-flow init skipped"
        echo "Workspace ready — run: claude"
    fi
}

agentbox-help() {
    if command -v gum >/dev/null 2>&1; then
        gum style --border rounded --border-foreground '#7aa2f7' --padding '1 2' --bold "AGENTBOX QUICK REFERENCE"
        echo ""
        gum format -- \
            "## AI Agents" \
            "| Command | Description |" \
            "|---------|-------------|" \
            "| claude | Start Claude Code |" \
            "| dsp | Claude (skip permissions) |" \
            "| cf-swarm | Claude Flow swarm mode |" \
            "| cf-hive | Spawn hive-mind agents |" \
            "| cf-doctor | System diagnostics |" \
            "| claudish | Multi-model proxy |" \
            "" \
            "## Development" \
            "| Command | Description |" \
            "|---------|-------------|" \
            "| sk-here | Init spec-kit in current dir |" \
            "| aqe | Agentic QE testing |" \
            "| skills-list | Browse AI skills |" \
            "| gh-pr | GitHub create PR |" \
            "" \
            "## Services" \
            "| Command | Description |" \
            "|---------|-------------|" \
            "| svc-status | Service health |" \
            "| health | Management API health |" \
            "| profiles | Open provisioned stacks |" \
            "| pod-root | Sovereign pod storage |"
    else
        echo "Agentbox Quick Reference"
        echo "------------------------"
        printf "  %-16s %s\n" \
            "claude" "Start Claude Code" \
            "dsp" "Claude (skip permissions)" \
            "cf-swarm" "Claude Flow swarm mode" \
            "cf-hive" "Spawn hive-mind agents" \
            "cf-doctor" "System diagnostics" \
            "claudish" "Multi-model proxy" \
            "svc-status" "Service health" \
            "gh-pr" "GitHub create PR" \
            "skills-list" "Browse AI skills"
    fi
}

agentbox-pick() {
    if ! command -v gum >/dev/null 2>&1; then
        echo "gum not installed — run agentbox-help instead"
        return 1
    fi
    local choice
    choice=$(gum choose --header "Pick a tool" \
        "claude        — Start Claude Code" \
        "cf-swarm      — Claude Flow swarm" \
        "cf-doctor     — System diagnostics" \
        "svc-status    — Service health" \
        "skills-list   — Browse AI skills" \
        "claudish      — Multi-model proxy" \
        "agt-watch     — Agent observability" \
        "agentbox-help — Full reference")
    local cmd="${choice%%—*}"
    cmd="$(echo "$cmd" | xargs)"
    [ -n "$cmd" ] && eval "$cmd"
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

alias turbo-init="agentbox-init"
alias turbo-help="agentbox-help"
alias pick="agentbox-pick"
