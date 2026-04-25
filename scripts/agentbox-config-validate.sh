#!/usr/bin/env bash
# agentbox-config-validate.sh — operator-facing entry point to the validator.
#
# Bootstraps the Node deps the validator needs (@iarna/toml, ajv,
# ajv-formats) on first run, then exec's the JS validator. Subsequent
# runs skip the bootstrap once node_modules is warm.
#
# Usage: ./scripts/agentbox-config-validate.sh [manifest-path]
#        ./scripts/agentbox-config-validate.sh agentbox.toml
#
# This is the canonical way to validate from a fresh clone. The flake
# evaluator and the CI pipelines also call this wrapper rather than
# `node scripts/agentbox-config-validate.js` directly.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Resolve Node binary — prefer nix-shell provided node, fallback to PATH.
if ! command -v node >/dev/null 2>&1; then
  echo "agentbox-config-validate: 'node' not found in PATH" >&2
  echo "  install via your package manager, or run inside 'nix develop'" >&2
  exit 1
fi
NODE_BIN="$(command -v node)"

# Bootstrap node_modules on first run. The validator's three runtime
# dependencies (@iarna/toml, ajv, ajv-formats) are pinned in the repo's
# top-level package.json. We probe one of them to decide whether a
# bootstrap is needed; this is idempotent and free on warm caches.
needs_bootstrap=0
if [[ ! -f "${REPO_ROOT}/node_modules/@iarna/toml/package.json" ]]; then needs_bootstrap=1; fi
if [[ ! -f "${REPO_ROOT}/node_modules/ajv/package.json" ]];          then needs_bootstrap=1; fi

if [[ "${needs_bootstrap}" -eq 1 ]]; then
  if [[ "${AGENTBOX_VALIDATOR_NO_BOOTSTRAP:-0}" -eq 1 ]]; then
    echo "agentbox-config-validate: node_modules missing and AGENTBOX_VALIDATOR_NO_BOOTSTRAP=1 set" >&2
    echo "  run: (cd ${REPO_ROOT} && npm ci)" >&2
    exit 2
  fi
  if ! command -v npm >/dev/null 2>&1; then
    echo "agentbox-config-validate: missing node_modules and 'npm' not in PATH" >&2
    exit 1
  fi
  echo "agentbox-config-validate: bootstrapping node_modules (first-run; ~10 s)..." >&2
  # NODE_ENV=production is set in the agentbox image env (and on operator
  # machines that derive from it), which makes plain `npm ci` skip
  # devDependencies AND fail to install dependencies that conflict with
  # an imagined production environment. Force production-aware install
  # paths to behave like a developer install. The three runtime deps the
  # validator needs are now in `dependencies` (not devDependencies), so
  # `--omit=dev` is fine here and matches the published-image profile.
  ( cd "${REPO_ROOT}" && NODE_ENV=development npm ci --omit=dev --silent --no-fund --no-audit --no-progress 1>&2 )
fi

exec "${NODE_BIN}" "${SCRIPT_DIR}/agentbox-config-validate.js" "$@"
