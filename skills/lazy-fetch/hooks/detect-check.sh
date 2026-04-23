#!/bin/bash
# Auto-detect and run the project's typecheck/lint command
# Used by blueprints to avoid hardcoding npm/tsc

if [ -f tsconfig.json ]; then
  npx tsc --noEmit 2>&1
elif [ -f Cargo.toml ]; then
  cargo check 2>&1
elif [ -f go.mod ]; then
  go vet ./... 2>&1
elif [ -f pyproject.toml ] || [ -f setup.py ]; then
  if command -v ruff &>/dev/null; then
    ruff check . 2>&1
  elif command -v mypy &>/dev/null; then
    mypy . 2>&1
  else
    echo "No Python linter found (ruff/mypy)"
  fi
else
  echo "No typecheck configured — skipping"
fi
