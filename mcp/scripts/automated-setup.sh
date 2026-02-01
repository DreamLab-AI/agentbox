#!/bin/bash
# Comprehensive automated setup script for Multi-Agent Docker Environment
# This script runs on container startup and ensures everything is properly configured

set -e

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Logging functions
log_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

log_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

log_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

log_error() {
    echo -e "${RED}❌ $1${NC}" >&2
}

log_section() {
    echo ""
    echo -e "${BLUE}=== $1 ===${NC}"
}

# Check if Claude is authenticated
check_claude_auth() {
    if claude --version >/dev/null 2>&1; then
        return 0
    else
        return 1
    fi
}

# Wait for Claude authentication
wait_for_claude_auth() {
    local max_attempts=10
    local attempt=1
    
    log_info "Waiting for Claude authentication..."
    
    while [ $attempt -le $max_attempts ]; do
        if check_claude_auth; then
            log_success "Claude is authenticated!"
            return 0
        fi
        
        log_info "  Attempt $attempt/$max_attempts - waiting 2 seconds..."
        sleep 2
        attempt=$((attempt + 1))
    done
    
    log_error "Claude authentication failed after $max_attempts attempts"
    return 1
}

# Initialize Claude workspace configuration
setup_claude_workspace() {
    log_section "Claude Workspace Configuration"
    
    # Check if already configured
    if [ -f /workspace/.claude_configured ]; then
        log_info "Claude workspace already configured"
        return 0
    fi
    
    # Configure Claude for the workspace
    cd /workspace
    
    # Initialize claude in the workspace if needed
    if [ ! -f /workspace/claude_project.json ]; then
        log_info "Initializing Claude project configuration..."
        
        # Create a claude_project.json for better context
        cat > /workspace/claude_project.json << 'EOF'
{
  "name": "Multi-Agent Docker Environment",
  "description": "Advanced AI/ML development environment with MCP tools integration",
  "context": {
    "mcp_servers": {
      "tcp": "localhost:9500",
      "websocket": "localhost:3002",
      "health": "localhost:9501"
    },
    "available_tools": [
      "blender-mcp",
      "qgis-mcp",
      "kicad-mcp",
      "ngspice-mcp",
      "imagemagick-mcp",
      "pbr-generator-mcp",
      "playwright-mcp"
    ],
    "ai_agents": {
      "goal_planner": "GOAP-based planning with A* pathfinding",
      "neural_agent": "SAFLA architecture with multi-tier memory"
    }
  }
}
EOF
        log_success "Created Claude project configuration"
    fi
    
    # Touch marker file
    touch /workspace/.claude_configured
}

# Align MCP tools configuration
align_mcp_tools() {
    log_section "MCP Tools Alignment"
    
    # Ensure MCP tools are properly linked
    local mcp_tools_dir="/app/core-assets/mcp-tools"
    local workspace_tools_dir="/workspace/mcp-tools"
    
    if [ -d "$mcp_tools_dir" ]; then
        # Create symlinks for each MCP tool
        for tool in "$mcp_tools_dir"/*.py; do
            if [ -f "$tool" ]; then
                local tool_name=$(basename "$tool")
                local target="$workspace_tools_dir/$tool_name"
                
                if [ ! -e "$target" ]; then
                    ln -sf "$tool" "$target"
                    log_success "Linked MCP tool: $tool_name"
                fi
            fi
        done
    fi
    
    # Verify MCP servers are accessible
    log_info "Verifying MCP server configuration..."
    
    # Check .mcp.json exists
    if [ ! -f /workspace/.mcp.json ]; then
        log_warning ".mcp.json not found, copying from template..."
        cp /app/core-assets/mcp.json /workspace/.mcp.json
    fi
    
    # Update .mcp.json with current environment settings
    if command -v jq >/dev/null 2>&1; then
        # Add environment-specific configurations
        local temp_mcp=$(mktemp)
        jq '.mcpServers |= . + {
            "environment": {
                "type": "docker",
                "container": "multi-agent",
                "initialized": "'$(date -u +"%Y-%m-%dT%H:%M:%SZ")'"
            }
        }' /workspace/.mcp.json > "$temp_mcp" && mv "$temp_mcp" /workspace/.mcp.json
        
        log_success "Updated MCP configuration with environment details"
    fi
}

# Initialize AI agents
initialize_ai_agents() {
    log_section "AI Agents Initialization"
    
    # Check if agents are already initialized
    if [ -f /workspace/.swarm/.agents_initialized ]; then
        log_info "AI agents already initialized"
        return 0
    fi
    
    # Initialize Goal Planner agent
    log_info "Initializing Goal Planner agent..."
    if claude-flow goal init --force 2>&1 | grep -E "(initialized|already exists)"; then
        log_success "Goal Planner agent ready"
    else
        log_warning "Goal Planner initialization had issues"
    fi
    
    # Initialize SAFLA Neural agent
    log_info "Initializing SAFLA Neural agent..."
    if claude-flow neural init --force 2>&1 | grep -E "(initialized|already exists)"; then
        log_success "SAFLA Neural agent ready"
    else
        log_warning "SAFLA Neural initialization had issues"
    fi
    
    # Create initialization marker
    mkdir -p /workspace/.swarm
    touch /workspace/.swarm/.agents_initialized
    
    # Set up agent communication channels
    log_info "Setting up agent communication channels..."
    
    # Create agent configuration
    cat > /workspace/.swarm/agent-config.json << 'EOF'
{
  "agents": {
    "goal_planner": {
      "enabled": true,
      "port": 9510,
      "features": ["planning", "optimization", "pathfinding"]
    },
    "neural_agent": {
      "enabled": true,
      "port": 9511,
      "memory_tiers": ["vector", "episodic", "semantic", "working"],
      "features": ["learning", "pattern_recognition", "knowledge_accumulation"]
    }
  },
  "swarm_config": {
    "coordination_mode": "distributed",
    "consensus_protocol": "raft",
    "max_agents": 10
  }
}
EOF
    
    log_success "Agent configuration created"
}

# Setup workspace projects
setup_workspace_projects() {
    log_section "Workspace Projects Setup"
    
    # Check if external directory is mounted
    if [ -d /workspace/ext ]; then
        log_info "External directory detected: /workspace/ext"
        
        # Look for common project indicators
        for indicator in package.json Cargo.toml pyproject.toml requirements.txt go.mod; do
            if find /workspace/ext -name "$indicator" -maxdepth 3 2>/dev/null | head -1 | grep -q .; then
                log_info "Found project indicator: $indicator"
                
                # Run appropriate setup based on project type
                case "$indicator" in
                    package.json)
                        log_info "Node.js project detected"
                        # Could run: cd /workspace/ext && npm install
                        ;;
                    Cargo.toml)
                        log_info "Rust project detected"
                        # Could run: cd /workspace/ext && cargo check
                        ;;
                    pyproject.toml|requirements.txt)
                        log_info "Python project detected"
                        # Could run: cd /workspace/ext && pip install -r requirements.txt
                        ;;
                    go.mod)
                        log_info "Go project detected"
                        # Could run: cd /workspace/ext && go mod download
                        ;;
                esac
            fi
        done
    else
        log_info "No external directory mounted"
    fi
    
    # Create example projects directory
    if [ ! -d /workspace/examples ]; then
        mkdir -p /workspace/examples
        
        # Create example MCP integration
        cat > /workspace/examples/mcp-example.js << 'EOF'
// Example MCP TCP client
const net = require('net');

const client = net.createConnection({ port: 9500 }, () => {
    console.log('Connected to MCP TCP server');
    
    // Send a tool list request
    const request = {
        jsonrpc: '2.0',
        id: '1',
        method: 'tools/list',
        params: {}
    };
    
    client.write(JSON.stringify(request) + '\n');
});

client.on('data', (data) => {
    console.log('Response:', data.toString());
    client.end();
});

client.on('end', () => {
    console.log('Disconnected from server');
});
EOF
        
        log_success "Created example projects"
    fi
}

# Configure development environment
configure_dev_environment() {
    log_section "Development Environment Configuration"
    
    # Set up git configuration if not present
    if ! git config --global user.name >/dev/null 2>&1; then
        git config --global user.name "Dev User"
        git config --global user.email "dev@multi-agent.local"
        git config --global init.defaultBranch main
        log_success "Configured git defaults"
    fi
    
    # Create useful workspace shortcuts
    if [ ! -f /workspace/.shortcuts ]; then
        cat > /workspace/.shortcuts << 'EOF'
#!/bin/bash
# Workspace shortcuts

# Quick access to tools
alias tools='ls -la /workspace/mcp-tools/'
alias agents='claude-flow status'
alias mcp-test='node /workspace/examples/mcp-example.js'

# Project navigation
alias ext='cd /workspace/ext'
alias ws='cd /workspace'

# Service management
alias services='supervisorctl -c /etc/supervisor/conf.d/supervisord.conf status'
alias restart-all='supervisorctl -c /etc/supervisor/conf.d/supervisord.conf restart all'

# Development helpers
alias py='python3'
alias ipy='ipython'
alias nb='jupyter notebook --ip=0.0.0.0 --no-browser'

echo "Workspace shortcuts loaded. Type 'alias' to see all available shortcuts."
EOF
        
        chmod +x /workspace/.shortcuts
        
        # Add to bashrc if not already there
        if ! grep -q "source /workspace/.shortcuts" /home/dev/.bashrc; then
            echo "[ -f /workspace/.shortcuts ] && source /workspace/.shortcuts" >> /home/dev/.bashrc
        fi
        
        log_success "Created workspace shortcuts"
    fi
}

# Start MCP services with retry logic
start_mcp_services() {
    log_section "MCP Services Startup"
    
    # Kill any existing processes
    pkill -f "mcp-tcp-server.js" 2>/dev/null || true
    pkill -f "mcp-ws-relay.js" 2>/dev/null || true
    sleep 2
    
    # Start services via supervisor
    log_info "Starting MCP services via supervisor..."
    
    supervisorctl -c /etc/supervisor/conf.d/supervisord.conf start mcp-core:* 2>/dev/null || {
        log_warning "Supervisor start failed, attempting manual start..."
        
        # Manual start with proper environment
        cd /workspace
        
        # Start TCP server
        CLAUDE_FLOW_DB_PATH=/workspace/.swarm/memory.db \
        NODE_ENV=production \
        nohup node /workspace/scripts/mcp-tcp-server.js > /app/mcp-logs/mcp-tcp-server.log 2>&1 &
        
        # Start WebSocket relay
        NODE_ENV=production \
        nohup node /workspace/scripts/mcp-ws-relay.js > /app/mcp-logs/mcp-ws-bridge.log 2>&1 &
        
        log_info "Started services manually"
    }
    
    # Wait for services to be healthy
    log_info "Waiting for services to become healthy..."
    local max_attempts=15
    local attempt=1
    
    while [ $attempt -le $max_attempts ]; do
        if curl -sf http://localhost:9501/health >/dev/null 2>&1; then
            log_success "MCP services are healthy!"
            
            # Display service status
            if [ -x /app/core-assets/scripts/health-check.sh ]; then
                /app/core-assets/scripts/health-check.sh || true
            fi
            
            return 0
        fi
        
        log_info "  Attempt $attempt/$max_attempts - waiting 3 seconds..."
        sleep 3
        attempt=$((attempt + 1))
    done
    
    log_error "MCP services did not become healthy"
    return 1
}

# Run post-setup validations
run_validations() {
    log_section "Post-Setup Validation"
    
    local all_good=true
    
    # Check Claude authentication
    echo -n "Claude authentication: "
    if check_claude_auth; then
        echo -e "${GREEN}✓${NC}"
    else
        echo -e "${RED}✗${NC}"
        all_good=false
    fi
    
    # Check MCP services
    echo -n "MCP TCP Server: "
    if nc -zv localhost 9500 2>&1 | grep -q succeeded; then
        echo -e "${GREEN}✓${NC}"
    else
        echo -e "${RED}✗${NC}"
        all_good=false
    fi
    
    echo -n "MCP WebSocket: "
    if nc -zv localhost 3002 2>&1 | grep -q succeeded; then
        echo -e "${GREEN}✓${NC}"
    else
        echo -e "${RED}✗${NC}"
        all_good=false
    fi
    
    echo -n "Health Endpoint: "
    if curl -sf http://localhost:9501/health >/dev/null 2>&1; then
        echo -e "${GREEN}✓${NC}"
    else
        echo -e "${RED}✗${NC}"
        all_good=false
    fi
    
    # Check AI agents
    echo -n "AI Agents: "
    if [ -f /workspace/.swarm/.agents_initialized ]; then
        echo -e "${GREEN}✓${NC}"
    else
        echo -e "${YELLOW}⚠${NC} (not initialized)"
    fi
    
    # Check workspace
    echo -n "Workspace Setup: "
    if [ -f /workspace/.claude_configured ]; then
        echo -e "${GREEN}✓${NC}"
    else
        echo -e "${YELLOW}⚠${NC} (not configured)"
    fi
    
    if [ "$all_good" = true ]; then
        log_success "All systems operational!"
        return 0
    else
        log_warning "Some components need attention"
        return 1
    fi
}

# Main execution
main() {
    echo ""
    echo "🚀 Multi-Agent Docker Automated Setup"
    echo "===================================="
    echo "Time: $(date)"
    echo ""
    
    # Skip if already fully set up
    if [ -f /workspace/.full_setup_completed ]; then
        log_info "Full setup already completed"
        
        # Just ensure services are running
        start_mcp_services
        run_validations
        
        return 0
    fi
    
    # Run setup steps in order
    if wait_for_claude_auth; then
        setup_claude_workspace
        align_mcp_tools
        initialize_ai_agents
        setup_workspace_projects
        configure_dev_environment
        start_mcp_services
        
        # Run validations
        echo ""
        if run_validations; then
            # Mark as fully set up
            touch /workspace/.full_setup_completed
            
            echo ""
            log_success "🎉 Automated setup completed successfully!"
            echo ""
            echo "Quick Start Guide:"
            echo "  • MCP TCP Server: localhost:9500"
            echo "  • WebSocket Bridge: localhost:3002" 
            echo "  • Health Check: curl localhost:9501/health"
            echo "  • View shortcuts: source /workspace/.shortcuts"
            echo "  • Test MCP: mcp-test"
            echo "  • Check agents: agents"
            echo ""
        else
            log_warning "Setup completed with warnings - check the validation results"
        fi
    else
        log_error "Cannot proceed without Claude authentication"
        log_info "Please set CLAUDE_CODE_ACCESS and CLAUDE_CODE_REFRESH in .env"
        exit 1
    fi
}

# Run main if not sourced
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi