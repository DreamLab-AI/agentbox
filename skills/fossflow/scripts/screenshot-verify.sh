#!/bin/bash
# FossFLOW Screenshot Verification Script
# Captures screenshots of diagrams via virtual display

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTPUT_DIR="${OUTPUT_DIR:-/tmp/fossflow-screenshots}"
DISPLAY="${DISPLAY:-:1}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

usage() {
    echo "FossFLOW Screenshot Verification"
    echo ""
    echo "Usage: $0 [OPTIONS] <command>"
    echo ""
    echo "Commands:"
    echo "  capture <output.png>     Capture current display"
    echo "  verify <diagram.json>    Load diagram and capture screenshot"
    echo "  compare <img1> <img2>    Compare two screenshots"
    echo ""
    echo "Options:"
    echo "  -d, --display DISPLAY    X display to use (default: :1)"
    echo "  -o, --output DIR         Output directory (default: /tmp/fossflow-screenshots)"
    echo "  -h, --help               Show this help"
    echo ""
    echo "Examples:"
    echo "  $0 capture diagram-screenshot.png"
    echo "  $0 verify my-diagram.json"
    echo "  DISPLAY=:0 $0 capture test.png"
}

# Check dependencies
check_deps() {
    local missing=()

    for cmd in scrot convert identify; do
        if ! command -v $cmd &> /dev/null; then
            missing+=($cmd)
        fi
    done

    if [ ${#missing[@]} -gt 0 ]; then
        echo -e "${YELLOW}Warning: Missing tools: ${missing[*]}${NC}"
        echo "Install with: sudo apt-get install scrot imagemagick"

        # Try alternative screenshot tools
        if command -v import &> /dev/null; then
            SCREENSHOT_CMD="import -window root"
        elif command -v gnome-screenshot &> /dev/null; then
            SCREENSHOT_CMD="gnome-screenshot -f"
        else
            echo -e "${RED}Error: No screenshot tool available${NC}"
            return 1
        fi
    else
        SCREENSHOT_CMD="scrot"
    fi

    return 0
}

# Capture screenshot
capture_screenshot() {
    local output="$1"

    if [ -z "$output" ]; then
        output="$OUTPUT_DIR/screenshot-$(date +%Y%m%d-%H%M%S).png"
    fi

    mkdir -p "$(dirname "$output")"

    echo "Capturing display $DISPLAY..."

    export DISPLAY

    if [ "$SCREENSHOT_CMD" = "scrot" ]; then
        scrot "$output"
    else
        $SCREENSHOT_CMD "$output"
    fi

    if [ -f "$output" ]; then
        echo -e "${GREEN}Screenshot saved: $output${NC}"

        # Get image info
        if command -v identify &> /dev/null; then
            local info=$(identify "$output" 2>/dev/null)
            echo "  Size: $(echo "$info" | awk '{print $3}')"
        fi

        return 0
    else
        echo -e "${RED}Failed to capture screenshot${NC}"
        return 1
    fi
}

# Verify diagram by loading and capturing
verify_diagram() {
    local diagram="$1"

    if [ ! -f "$diagram" ]; then
        echo -e "${RED}Error: Diagram file not found: $diagram${NC}"
        return 1
    fi

    echo "Verifying diagram: $diagram"

    # Validate JSON first
    if command -v node &> /dev/null; then
        echo "Validating diagram structure..."
        node "$SCRIPT_DIR/validate-diagram.js" "$diagram"
        if [ $? -ne 0 ]; then
            echo -e "${RED}Diagram validation failed${NC}"
            return 1
        fi
    fi

    # Generate output filename
    local basename=$(basename "$diagram" .json)
    local output="$OUTPUT_DIR/${basename}-verify-$(date +%H%M%S).png"

    # Capture screenshot
    echo ""
    echo "Capturing screenshot for visual verification..."
    capture_screenshot "$output"

    echo ""
    echo -e "${GREEN}Verification complete!${NC}"
    echo "Screenshot: $output"
    echo ""
    echo "To view: feh $output  OR  xdg-open $output"
}

# Compare two images
compare_images() {
    local img1="$1"
    local img2="$2"

    if [ ! -f "$img1" ] || [ ! -f "$img2" ]; then
        echo -e "${RED}Error: Both image files must exist${NC}"
        return 1
    fi

    if ! command -v compare &> /dev/null; then
        echo -e "${RED}Error: ImageMagick 'compare' not found${NC}"
        echo "Install with: sudo apt-get install imagemagick"
        return 1
    fi

    local diff_output="$OUTPUT_DIR/diff-$(date +%H%M%S).png"

    echo "Comparing images..."
    echo "  Image 1: $img1"
    echo "  Image 2: $img2"

    # Generate difference image
    local result=$(compare -metric AE "$img1" "$img2" "$diff_output" 2>&1)

    echo ""
    echo "Pixel difference: $result"
    echo "Diff image: $diff_output"

    if [ "$result" = "0" ]; then
        echo -e "${GREEN}Images are identical!${NC}"
    else
        echo -e "${YELLOW}Images differ by $result pixels${NC}"
    fi
}

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -d|--display)
            DISPLAY="$2"
            shift 2
            ;;
        -o|--output)
            OUTPUT_DIR="$2"
            shift 2
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        capture)
            check_deps || exit 1
            capture_screenshot "$2"
            exit $?
            ;;
        verify)
            check_deps || exit 1
            verify_diagram "$2"
            exit $?
            ;;
        compare)
            compare_images "$2" "$3"
            exit $?
            ;;
        *)
            echo -e "${RED}Unknown command: $1${NC}"
            usage
            exit 1
            ;;
    esac
done

usage
