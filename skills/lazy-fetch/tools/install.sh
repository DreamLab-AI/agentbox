#!/bin/bash
# Install lazy-fetch globally from GitHub
# Usage: curl -fsSL https://raw.githubusercontent.com/Clemens865/Lazy-Fetch/main/install.sh | bash

set -e

REPO="https://github.com/Clemens865/Lazy-Fetch.git"
INSTALL_DIR="${LAZY_FETCH_DIR:-$HOME/.lazy-fetch}"

echo ""
echo "  Installing lazy-fetch..."
echo "─────────────────────────────────────────"

# Check prerequisites
for cmd in node npm git; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "  Error: $cmd is required but not installed."
    exit 1
  fi
done

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
  echo "  Error: Node.js 18+ required (found $(node -v))"
  exit 1
fi

# Clone or update
if [ -d "$INSTALL_DIR" ]; then
  echo "  Updating existing installation..."
  cd "$INSTALL_DIR"
  git pull --quiet
else
  echo "  Cloning from GitHub..."
  git clone --quiet "$REPO" "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi

# Install dependencies and build
echo "  Installing dependencies..."
npm install --quiet 2>/dev/null

echo "  Building..."
npm run build --quiet 2>/dev/null

# Link globally
echo "  Linking globally..."
npm link --quiet 2>/dev/null

echo ""
echo "─────────────────────────────────────────"
echo "  lazy-fetch installed!"
echo ""
echo "  Get started in any project:"
echo "    cd your-project"
echo "    lazy init"
echo "    lazy read"
echo ""
echo "  Installed to: $INSTALL_DIR"
echo ""
