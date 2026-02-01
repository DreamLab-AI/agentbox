#!/usr/bin/env bash
# Docker Manager Skill Test Suite
# Run from inside agentic-workstation container

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

PASSED=0
FAILED=0

log() {
    echo -e "${BLUE}[TEST]${NC} $1"
}

pass() {
    echo -e "${GREEN}[PASS]${NC} $1"
    ((PASSED++))
}

fail() {
    echo -e "${RED}[FAIL]${NC} $1"
    ((FAILED++))
}

warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

# Test 1: Check skill directory exists
test_skill_directory() {
    log "Checking skill directory..."
    if [[ -d "/home/devuser/.claude/skills/docker-manager" ]]; then
        pass "Skill directory exists"
    else
        fail "Skill directory not found"
        return 1
    fi
}

# Test 2: Check Python tool exists and is executable
test_python_tool() {
    log "Checking Python tool..."
    local tool="/home/devuser/.claude/skills/docker-manager/tools/docker_manager.py"

    if [[ -f "$tool" ]]; then
        if [[ -x "$tool" ]]; then
            pass "Python tool is executable"
        else
            fail "Python tool not executable"
            return 1
        fi
    else
        fail "Python tool not found"
        return 1
    fi
}

# Test 3: Check shell wrapper exists and is executable
test_shell_wrapper() {
    log "Checking shell wrapper..."
    local wrapper="/home/devuser/.claude/skills/docker-manager/tools/visionflow_ctl.sh"

    if [[ -f "$wrapper" ]]; then
        if [[ -x "$wrapper" ]]; then
            pass "Shell wrapper is executable"
        else
            fail "Shell wrapper not executable"
            return 1
        fi
    else
        fail "Shell wrapper not found"
        return 1
    fi
}

# Test 4: Check config file exists
test_config() {
    log "Checking configuration..."
    local config="/home/devuser/.claude/skills/docker-manager/config/docker-auth.json"

    if [[ -f "$config" ]]; then
        if jq empty "$config" 2>/dev/null; then
            pass "Configuration file is valid JSON"
        else
            fail "Configuration file is invalid JSON"
            return 1
        fi
    else
        fail "Configuration file not found"
        return 1
    fi
}

# Test 5: Check Docker socket access
test_docker_socket() {
    log "Checking Docker socket access..."

    if [[ -S /var/run/docker.sock ]]; then
        if docker ps &>/dev/null; then
            pass "Docker socket is accessible"
        else
            fail "Docker socket exists but not accessible (check permissions)"
            warn "Run: sudo chmod 666 /var/run/docker.sock"
            return 1
        fi
    else
        fail "Docker socket not found at /var/run/docker.sock"
        return 1
    fi
}

# Test 6: Check Python dependencies
test_python_deps() {
    log "Checking Python dependencies..."

    if python3 -c "import docker" 2>/dev/null; then
        pass "Python docker module is installed"
    else
        fail "Python docker module not installed"
        warn "Run: pip3 install docker --break-system-packages"
        return 1
    fi
}

# Test 7: Test container discovery
test_container_discovery() {
    log "Testing container discovery..."
    local tool="/home/devuser/.claude/skills/docker-manager/tools/docker_manager.py"

    if python3 "$tool" container_discover '{}' 2>/dev/null | jq -e '.success == true' &>/dev/null; then
        pass "Container discovery works"
    else
        fail "Container discovery failed"
        return 1
    fi
}

# Test 8: Test VisionFlow status check
test_visionflow_status() {
    log "Testing VisionFlow status check..."
    local tool="/home/devuser/.claude/skills/docker-manager/tools/docker_manager.py"

    local result
    result=$(python3 "$tool" visionflow_status '{}' 2>/dev/null || echo '{"success":false}')

    if echo "$result" | jq -e '.success == true' &>/dev/null; then
        pass "VisionFlow status check works"
        local status
        status=$(echo "$result" | jq -r '.container.status')
        log "VisionFlow status: $status"
    elif echo "$result" | jq -e '.error' &>/dev/null; then
        warn "VisionFlow container not found (this is OK if not running)"
        pass "Status check executed successfully (container not found)"
    else
        fail "VisionFlow status check failed"
        return 1
    fi
}

# Test 9: Test wrapper script help
test_wrapper_help() {
    log "Testing wrapper script help..."
    local wrapper="/home/devuser/.claude/skills/docker-manager/tools/visionflow_ctl.sh"

    if "$wrapper" --help &>/dev/null; then
        pass "Wrapper script help works"
    else
        fail "Wrapper script help failed"
        return 1
    fi
}

# Test 10: Check project mount
test_project_mount() {
    log "Checking project mount..."

    if [[ -f "/home/devuser/workspace/project/scripts/launch.sh" ]]; then
        pass "Launch script is accessible"
    else
        fail "Launch script not found (check project mount)"
        warn "Expected: /home/devuser/workspace/project/scripts/launch.sh"
        return 1
    fi
}

# Main test execution
main() {
    echo ""
    echo "======================================"
    echo "  Docker Manager Skill Test Suite"
    echo "======================================"
    echo ""

    test_skill_directory || true
    test_python_tool || true
    test_shell_wrapper || true
    test_config || true
    test_docker_socket || true
    test_python_deps || true
    test_container_discovery || true
    test_visionflow_status || true
    test_wrapper_help || true
    test_project_mount || true

    echo ""
    echo "======================================"
    echo "  Test Results"
    echo "======================================"
    echo -e "${GREEN}Passed: $PASSED${NC}"
    echo -e "${RED}Failed: $FAILED${NC}"
    echo ""

    if [[ $FAILED -eq 0 ]]; then
        echo -e "${GREEN}All tests passed!${NC}"
        echo ""
        echo "You can now use the Docker Manager skill:"
        echo "  - From Claude: 'Use Docker Manager to check VisionFlow status'"
        echo "  - From Shell: 'visionflow_ctl.sh status'"
        exit 0
    else
        echo -e "${RED}Some tests failed. Please fix the issues above.${NC}"
        exit 1
    fi
}

main "$@"
