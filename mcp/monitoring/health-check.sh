#!/bin/bash
# Enhanced health check script for MCP services
# Returns 0 if healthy, 1 if unhealthy

# Configuration
HEALTH_ENDPOINT="http://localhost:9501/health"
WS_ENDPOINT="http://localhost:3002/health"
TCP_PORT=9500
TIMEOUT=5

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Track overall health
HEALTHY=true

echo "=== MCP Services Health Check ==="
echo "Time: $(date)"

# Check TCP server health endpoint
echo -n "TCP Server Health (9501): "
if curl -sf --max-time $TIMEOUT "$HEALTH_ENDPOINT" > /dev/null 2>&1; then
    echo -e "${GREEN}✓ HEALTHY${NC}"
    
    # Get detailed status if available
    if STATUS=$(curl -sf --max-time $TIMEOUT "$HEALTH_ENDPOINT" 2>/dev/null); then
        echo "  Status: $(echo "$STATUS" | jq -r '.status // "unknown"' 2>/dev/null)"
        echo "  Uptime: $(echo "$STATUS" | jq -r '.uptime // 0' 2>/dev/null)ms"
        echo "  Active connections: $(echo "$STATUS" | jq -r '.stats.activeConnections // 0' 2>/dev/null)"
    fi
else
    echo -e "${RED}✗ UNHEALTHY${NC}"
    HEALTHY=false
fi

# Check TCP port connectivity
echo -n "TCP Server Port (9500): "
if timeout $TIMEOUT bash -c "echo > /dev/tcp/localhost/9500" 2>/dev/null; then
    echo -e "${GREEN}✓ ACCEPTING CONNECTIONS${NC}"
else
    echo -e "${RED}✗ NOT ACCEPTING CONNECTIONS${NC}"
    HEALTHY=false
fi

# Check WebSocket bridge
echo -n "WebSocket Bridge (3002): "
if curl -sf --max-time $TIMEOUT "$WS_ENDPOINT" > /dev/null 2>&1; then
    echo -e "${GREEN}✓ HEALTHY${NC}"
elif timeout $TIMEOUT bash -c "echo > /dev/tcp/localhost/3002" 2>/dev/null; then
    echo -e "${YELLOW}⚠ PORT OPEN (no health endpoint)${NC}"
else
    echo -e "${RED}✗ UNHEALTHY${NC}"
    HEALTHY=false
fi

# Check supervisor status
echo -n "Supervisor Status: "
if supervisorctl -c /etc/supervisor/conf.d/supervisord.conf status mcp-core:* 2>/dev/null | grep -q RUNNING; then
    echo -e "${GREEN}✓ SERVICES RUNNING${NC}"
    supervisorctl -c /etc/supervisor/conf.d/supervisord.conf status mcp-core:* 2>/dev/null | sed 's/^/  /'
else
    echo -e "${RED}✗ SERVICES NOT RUNNING${NC}"
    HEALTHY=false
fi

# Check critical directories
echo -n "Critical Directories: "
DIRS_OK=true
for dir in /workspace/.swarm /app/mcp-logs /workspace/scripts; do
    if [ ! -d "$dir" ]; then
        echo -e "\n  ${RED}✗ Missing: $dir${NC}"
        DIRS_OK=false
    fi
done
if [ "$DIRS_OK" = true ]; then
    echo -e "${GREEN}✓ ALL PRESENT${NC}"
fi

# Check for error logs
echo -n "Recent Errors: "
ERROR_COUNT=$(find /app/mcp-logs -name "*error*.log" -type f -mmin -5 -exec grep -l "ERROR\|FATAL" {} \; 2>/dev/null | wc -l)
if [ "$ERROR_COUNT" -eq 0 ]; then
    echo -e "${GREEN}✓ NONE${NC}"
else
    echo -e "${YELLOW}⚠ Found $ERROR_COUNT error log(s) with recent errors${NC}"
fi

echo "================================="

# Return appropriate exit code
if [ "$HEALTHY" = true ]; then
    echo -e "${GREEN}Overall Status: HEALTHY${NC}"
    exit 0
else
    echo -e "${RED}Overall Status: UNHEALTHY${NC}"
    exit 1
fi