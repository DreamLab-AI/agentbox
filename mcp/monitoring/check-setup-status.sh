#!/bin/bash
# Check the status of the automated setup process

set -e

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}=== Multi-Agent Docker Setup Status ===${NC}"
echo "Time: $(date)"
echo ""

# Check if setup is still running
if pgrep -f "automated-setup.sh" > /dev/null; then
    echo -e "${YELLOW}⏳ Setup is currently running...${NC}"
    echo ""
    echo "Recent log entries:"
    tail -5 /app/mcp-logs/automated-setup.log 2>/dev/null || echo "No logs available yet"
    echo ""
    echo "To watch progress: tail -f /app/mcp-logs/automated-setup.log"
    exit 0
fi

# Check completion markers
echo "Setup Components:"
echo -n "  Initial setup: "
if [ -f /workspace/.setup_completed ]; then
    echo -e "${GREEN}✓${NC}"
else
    echo -e "${RED}✗${NC}"
fi

echo -n "  Claude auth: "
if [ -f /home/dev/.claude/.credentials.json ]; then
    echo -e "${GREEN}✓${NC}"
else
    echo -e "${RED}✗${NC}"
fi

echo -n "  Claude workspace: "
if [ -f /workspace/.claude_configured ]; then
    echo -e "${GREEN}✓${NC}"
else
    echo -e "${RED}✗${NC}"
fi

echo -n "  AI agents: "
if [ -f /workspace/.swarm/.agents_initialized ]; then
    echo -e "${GREEN}✓${NC}"
else
    echo -e "${RED}✗${NC}"
fi

echo -n "  Full automation: "
if [ -f /workspace/.full_setup_completed ]; then
    echo -e "${GREEN}✓${NC}"
else
    echo -e "${YELLOW}⚠${NC}"
fi

echo ""
echo "Services:"

# Check services
for service in "TCP Server:9500" "WebSocket:3002" "Health:9501"; do
    IFS=':' read -r name port <<< "$service"
    echo -n "  $name (port $port): "
    if nc -zv localhost $port 2>&1 | grep -q succeeded; then
        echo -e "${GREEN}✓ Running${NC}"
    else
        echo -e "${RED}✗ Not responding${NC}"
    fi
done

echo ""

# Check for errors in setup log
if [ -f /app/mcp-logs/automated-setup.log ]; then
    ERROR_COUNT=$(grep -c "ERROR\|Failed" /app/mcp-logs/automated-setup.log 2>/dev/null || echo "0")
    if [ "$ERROR_COUNT" -gt 0 ]; then
        echo -e "${YELLOW}⚠️  Found $ERROR_COUNT errors in setup log${NC}"
        echo "Recent errors:"
        grep -E "ERROR|Failed" /app/mcp-logs/automated-setup.log | tail -3
    fi
fi

# Quick health check
echo ""
echo "Quick Health Check:"
if curl -sf http://localhost:9501/health 2>/dev/null | jq -r '.status' 2>/dev/null | grep -q healthy; then
    echo -e "${GREEN}✅ System is healthy${NC}"
    
    # Show some stats
    HEALTH_DATA=$(curl -sf http://localhost:9501/health 2>/dev/null)
    if [ -n "$HEALTH_DATA" ]; then
        echo "  Uptime: $(echo "$HEALTH_DATA" | jq -r '.uptime' 2>/dev/null || echo "unknown")ms"
        echo "  Active connections: $(echo "$HEALTH_DATA" | jq -r '.stats.activeConnections' 2>/dev/null || echo "0")"
    fi
else
    echo -e "${RED}❌ Health check failed${NC}"
fi

echo ""
echo "Useful commands:"
echo "  • View setup logs: tail -f /app/mcp-logs/automated-setup.log"
echo "  • Run health check: /app/core-assets/scripts/health-check.sh"
echo "  • Check services: supervisorctl -c /etc/supervisor/conf.d/supervisord.conf status"
echo "  • Test MCP: echo '{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/list\"}' | nc localhost 9500"