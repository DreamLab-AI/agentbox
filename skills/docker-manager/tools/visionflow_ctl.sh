#!/usr/bin/env zsh
# VisionFlow Control Wrapper
# Provides convenient shell interface to docker_manager.py

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Paths
SCRIPT_DIR="${0:A:h}"
DOCKER_MANAGER="$SCRIPT_DIR/docker_manager.py"
PROJECT_ROOT="/home/devuser/workspace/project"
LAUNCH_SCRIPT="$PROJECT_ROOT/scripts/launch.sh"

# Logging
log() {
    echo -e "${BLUE}[$(date '+%H:%M:%S')]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1" >&2
}

success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

# Check prerequisites
check_prereqs() {
    if [[ ! -f "$DOCKER_MANAGER" ]]; then
        error "docker_manager.py not found at $DOCKER_MANAGER"
        exit 1
    fi

    if ! command -v python3 &> /dev/null; then
        error "python3 not found"
        exit 1
    fi

    # Check docker socket access
    if [[ ! -S /var/run/docker.sock ]]; then
        error "Docker socket not accessible at /var/run/docker.sock"
        exit 1
    fi
}

# Execute docker_manager operation
docker_manager_exec() {
    local operation="$1"
    shift
    local args_json="${1:-{}}"

    log "Executing: $operation"

    local result
    result=$(python3 "$DOCKER_MANAGER" "$operation" "$args_json" 2>&1)
    local exit_code=$?

    if [[ $exit_code -eq 0 ]]; then
        echo "$result"
        if echo "$result" | jq -e '.success == true' &> /dev/null; then
            return 0
        else
            return 1
        fi
    else
        error "Operation failed: $operation"
        echo "$result"
        return 1
    fi
}

# Command implementations
cmd_build() {
    local no_cache=false
    local force_rebuild=false
    local profile="dev"

    while [[ $# -gt 0 ]]; do
        case $1 in
            --no-cache)
                no_cache=true
                shift
                ;;
            --force-rebuild)
                force_rebuild=true
                shift
                ;;
            -p|--profile)
                profile="$2"
                shift 2
                ;;
            *)
                error "Unknown option: $1"
                exit 1
                ;;
        esac
    done

    local args
    args=$(jq -n \
        --argjson no_cache "$no_cache" \
        --argjson force_rebuild "$force_rebuild" \
        --arg profile "$profile" \
        '{no_cache: $no_cache, force_rebuild: $force_rebuild, profile: $profile}')

    if docker_manager_exec "visionflow_build" "$args"; then
        success "Build completed successfully"
    else
        error "Build failed"
        exit 1
    fi
}

cmd_up() {
    local profile="dev"
    local detached=true

    while [[ $# -gt 0 ]]; do
        case $1 in
            -p|--profile)
                profile="$2"
                shift 2
                ;;
            -f|--foreground)
                detached=false
                shift
                ;;
            *)
                error "Unknown option: $1"
                exit 1
                ;;
        esac
    done

    local args
    args=$(jq -n \
        --arg profile "$profile" \
        --argjson detached "$detached" \
        '{profile: $profile, detached: $detached}')

    if docker_manager_exec "visionflow_up" "$args"; then
        success "VisionFlow started successfully"
    else
        error "Failed to start VisionFlow"
        exit 1
    fi
}

cmd_down() {
    local volumes=false

    while [[ $# -gt 0 ]]; do
        case $1 in
            -v|--volumes)
                volumes=true
                shift
                ;;
            *)
                error "Unknown option: $1"
                exit 1
                ;;
        esac
    done

    local args
    args=$(jq -n --argjson volumes "$volumes" '{volumes: $volumes}')

    if docker_manager_exec "visionflow_down" "$args"; then
        success "VisionFlow stopped successfully"
    else
        error "Failed to stop VisionFlow"
        exit 1
    fi
}

cmd_restart() {
    local rebuild=false
    local profile="dev"

    while [[ $# -gt 0 ]]; do
        case $1 in
            -r|--rebuild)
                rebuild=true
                shift
                ;;
            -p|--profile)
                profile="$2"
                shift 2
                ;;
            *)
                error "Unknown option: $1"
                exit 1
                ;;
        esac
    done

    local args
    args=$(jq -n \
        --argjson rebuild "$rebuild" \
        --arg profile "$profile" \
        '{rebuild: $rebuild, profile: $profile}')

    if docker_manager_exec "visionflow_restart" "$args"; then
        success "VisionFlow restarted successfully"
    else
        error "Failed to restart VisionFlow"
        exit 1
    fi
}

cmd_logs() {
    local lines=100
    local follow=false
    local timestamps=true

    while [[ $# -gt 0 ]]; do
        case $1 in
            -n|--lines)
                lines="$2"
                shift 2
                ;;
            -f|--follow)
                follow=true
                shift
                ;;
            --no-timestamps)
                timestamps=false
                shift
                ;;
            *)
                error "Unknown option: $1"
                exit 1
                ;;
        esac
    done

    local args
    args=$(jq -n \
        --argjson lines "$lines" \
        --argjson follow "$follow" \
        --argjson timestamps "$timestamps" \
        '{lines: $lines, follow: $follow, timestamps: $timestamps}')

    docker_manager_exec "visionflow_logs" "$args" | jq -r '.logs // .error'
}

cmd_status() {
    local result
    result=$(docker_manager_exec "visionflow_status" "{}")

    if echo "$result" | jq -e '.success == true' &> /dev/null; then
        echo "$result" | jq -r '
            "=== VisionFlow Container Status ===",
            "Name: \(.container.name)",
            "Status: \(.container.status)",
            "State: \(if .container.state.running then "Running ✓" else "Stopped ✗" end)",
            "Health: \(.container.health)",
            "Image: \(.container.image)",
            "",
            "=== Resources ===",
            "CPU: \(.container.resources.cpu_percent)%",
            "Memory: \(.container.resources.memory_usage_mb) MB (\(.container.resources.memory_percent)%)",
            "",
            "=== Network ===",
            "Networks: \(.container.networks | join(", "))",
            "Ports: \(.container.ports | to_entries | map("\(.key) -> \(.value)") | join(", "))",
            "",
            "=== State Details ===",
            "Started: \(.container.state.started_at)",
            "Exit Code: \(.container.state.exit_code)"
        '
    else
        error "Failed to get status"
        echo "$result" | jq -r '.error'
        exit 1
    fi
}

cmd_exec() {
    if [[ $# -eq 0 ]]; then
        error "No command specified"
        exit 1
    fi

    local command="$1"
    shift

    local workdir="/app"
    local user=""

    while [[ $# -gt 0 ]]; do
        case $1 in
            -w|--workdir)
                workdir="$2"
                shift 2
                ;;
            -u|--user)
                user="$2"
                shift 2
                ;;
            *)
                error "Unknown option: $1"
                exit 1
                ;;
        esac
    done

    local args
    if [[ -n "$user" ]]; then
        args=$(jq -n \
            --arg command "$command" \
            --arg workdir "$workdir" \
            --arg user "$user" \
            '{command: $command, workdir: $workdir, user: $user}')
    else
        args=$(jq -n \
            --arg command "$command" \
            --arg workdir "$workdir" \
            '{command: $command, workdir: $workdir}')
    fi

    local result
    result=$(docker_manager_exec "docker_exec" "$args")

    if echo "$result" | jq -e '.success == true' &> /dev/null; then
        echo "$result" | jq -r '.stdout'
        if [[ -n "$(echo "$result" | jq -r '.stderr')" ]]; then
            echo "$result" | jq -r '.stderr' >&2
        fi
    else
        error "Command execution failed"
        echo "$result" | jq -r '.error // .stderr'
        exit 1
    fi
}

cmd_discover() {
    local result
    result=$(docker_manager_exec "container_discover" "{}")

    if echo "$result" | jq -e '.success == true' &> /dev/null; then
        echo "$result" | jq -r '
            "=== Docker Network Discovery ===",
            "Network: \(.network)",
            "Container Count: \(.container_count)",
            "",
            "=== Containers ===",
            (.containers[] |
                "[\(.status)] \(.name) (\(.id))",
                "  Image: \(.image)",
                "  IP: \(.ip_address)",
                "  Ports: \(.ports | to_entries | map("\(.key)") | join(", "))",
                ""
            )
        '
    else
        error "Discovery failed"
        echo "$result" | jq -r '.error'
        exit 1
    fi
}

# Show help
show_help() {
    cat << EOF
${GREEN}VisionFlow Control Wrapper${NC}

${YELLOW}Usage:${NC}
    visionflow_ctl.sh <command> [options]

${YELLOW}Commands:${NC}
    build           Build VisionFlow container
    up              Start VisionFlow container
    down            Stop VisionFlow container
    restart         Restart VisionFlow container
    logs            Show container logs
    status          Show container status
    exec            Execute command in container
    discover        Discover containers in network

${YELLOW}Options:${NC}
    build:
        --no-cache          Build without cache
        --force-rebuild     Force complete rebuild
        -p, --profile       Profile (dev|production)

    up:
        -p, --profile       Profile (dev|production)
        -f, --foreground    Run in foreground

    down:
        -v, --volumes       Remove volumes too

    restart:
        -r, --rebuild       Rebuild before restart
        -p, --profile       Profile (dev|production)

    logs:
        -n, --lines N       Number of lines (default: 100)
        -f, --follow        Follow log output
        --no-timestamps     Hide timestamps

    exec:
        -w, --workdir DIR   Working directory
        -u, --user USER     User to run as

${YELLOW}Examples:${NC}
    visionflow_ctl.sh build --no-cache
    visionflow_ctl.sh up -p dev
    visionflow_ctl.sh restart --rebuild
    visionflow_ctl.sh logs -n 50 -f
    visionflow_ctl.sh exec "npm run test"
    visionflow_ctl.sh status
    visionflow_ctl.sh discover
EOF
}

# Main
main() {
    check_prereqs

    if [[ $# -eq 0 ]]; then
        show_help
        exit 0
    fi

    local command="$1"
    shift

    case "$command" in
        build)
            cmd_build "$@"
            ;;
        up)
            cmd_up "$@"
            ;;
        down)
            cmd_down "$@"
            ;;
        restart)
            cmd_restart "$@"
            ;;
        logs)
            cmd_logs "$@"
            ;;
        status)
            cmd_status "$@"
            ;;
        exec)
            cmd_exec "$@"
            ;;
        discover)
            cmd_discover "$@"
            ;;
        -h|--help|help)
            show_help
            ;;
        *)
            error "Unknown command: $command"
            show_help
            exit 1
            ;;
    esac
}

main "$@"
