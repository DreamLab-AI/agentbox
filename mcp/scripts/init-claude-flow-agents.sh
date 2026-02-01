#!/bin/bash
# Initialize Claude-Flow v3alpha agents and intelligence system
# This script sets up the advanced AI capabilities in the Docker environment

set -e

echo "========================================"
echo "  Claude-Flow v3alpha Initialization"
echo "========================================"

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Ensure we're in the workspace directory
WORKSPACE="${WORKSPACE_FOLDER:-/workspace}"
[ -d "$WORKSPACE" ] || WORKSPACE="/home/devuser/workspace"
[ -d "$WORKSPACE" ] || WORKSPACE="$HOME/workspace"
cd "$WORKSPACE" || exit 1

# Check if claude-flow is available
if ! command_exists claude-flow; then
    echo "⚠️  claude-flow not found. Installing v3alpha..."
    npm install -g claude-flow@v3alpha || {
        echo "❌ Failed to install claude-flow"
        exit 1
    }
fi

# Display version
echo ""
echo "📦 Version: $(claude-flow --version)"

# Run system diagnostics
echo ""
echo "🔍 Running system diagnostics..."
claude-flow doctor || {
    echo "⚠️  Some diagnostics failed (non-critical)"
}

# Initialize v3 swarm with hierarchical-mesh topology
echo ""
echo "🐝 Initializing v3 swarm..."
echo "   - 15-agent hierarchical-mesh coordination"
echo "   - Flash Attention (2.49x-7.47x speedup)"
echo "   - AgentDB with HNSW indexing (150x faster)"

claude-flow swarm init --v3-mode || {
    echo "⚠️  Swarm may already be initialized"
}

# Bootstrap intelligence from repository
echo ""
echo "🧠 Bootstrapping intelligence system..."
echo "   - Pattern recognition and learning"
echo "   - RuVector HNSW search (150x faster)"
echo "   - Intelligent routing (90%+ accuracy)"

claude-flow hooks pretrain 2>/dev/null || {
    echo "ℹ️  Pretrain requires codebase context"
}

# Verify installation
echo ""
echo "✅ Checking system status..."
claude-flow status || {
    echo "⚠️  Could not verify system status"
}

# Create helper functions file
cat > "$WORKSPACE/.claude-flow-helpers.sh" << 'EOF'
#!/bin/bash
# Claude-Flow v3alpha Helper Functions

# Run SPARC workflow
cf_sparc() {
    local task="${1:-build feature}"
    echo "Running SPARC workflow for: $task"
    claude-flow workflow run --template sparc --task "$task"
}

# Intelligent task routing
cf_route() {
    local task="$1"
    if [ -z "$task" ]; then
        echo "Usage: cf_route 'task description'"
        return 1
    fi
    echo "Routing task: $task"
    claude-flow hooks route --task "$task"
}

# Search memory
cf_search() {
    local query="$1"
    if [ -z "$query" ]; then
        echo "Usage: cf_search 'query'"
        return 1
    fi
    echo "Searching: $query"
    claude-flow memory search --query "$query"
}

# View metrics dashboard
cf_metrics() {
    claude-flow hooks metrics
}

# Spawn an agent
cf_spawn() {
    local type="${1:-coder}"
    local name="${2:-agent-$(date +%s)}"
    echo "Spawning $type agent: $name"
    claude-flow agent spawn --type "$type" --name "$name"
}

# List agents
cf_agents() {
    claude-flow agent list
}

# Swarm status
cf_status() {
    claude-flow swarm status
}

# System diagnostics
cf_doctor() {
    claude-flow doctor
}

# Available workflow templates
cf_templates() {
    claude-flow workflow template list
}

echo "Claude-Flow v3alpha helpers loaded. Available commands:"
echo "  cf_sparc [task]     - Run SPARC workflow"
echo "  cf_route 'task'     - Intelligent routing"
echo "  cf_search 'query'   - Search memory"
echo "  cf_metrics          - View metrics dashboard"
echo "  cf_spawn [type]     - Spawn agent (coder, tester, etc.)"
echo "  cf_agents           - List active agents"
echo "  cf_status           - Swarm status"
echo "  cf_doctor           - System diagnostics"
echo "  cf_templates        - List workflow templates"
EOF

chmod +x "$WORKSPACE/.claude-flow-helpers.sh"

echo ""
echo "✨ Claude-Flow v3alpha initialized successfully!"
echo ""
echo "📚 Helper functions created:"
echo "   source .claude-flow-helpers.sh"
echo ""
echo "💡 Quick start:"
echo "   cf_doctor           # System diagnostics"
echo "   cf_status           # Swarm status"
echo "   cf_templates        # Available workflows"
echo "   cf_route 'Fix bug'  # Route task to optimal agent"
echo ""
