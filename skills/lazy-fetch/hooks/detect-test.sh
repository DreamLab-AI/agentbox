#!/bin/bash
# Auto-detect and run the project's test command
# Used by blueprints to avoid hardcoding npm test

if [ -f package.json ]; then
  # Check if test script exists and isn't a placeholder
  TEST_CMD=$(node -e "const p=JSON.parse(require('fs').readFileSync('package.json','utf-8')); const t=p.scripts?.test??''; if(t && !t.includes('no test specified') && t!=='echo') console.log(t)" 2>/dev/null)
  if [ -n "$TEST_CMD" ]; then
    npm test 2>&1
  else
    echo "No test script configured — skipping"
  fi
elif [ -f Cargo.toml ]; then
  cargo test 2>&1
elif [ -f go.mod ]; then
  go test ./... 2>&1
elif [ -f pytest.ini ] || [ -f conftest.py ]; then
  pytest 2>&1
elif [ -f pyproject.toml ]; then
  if grep -q '\[tool.pytest' pyproject.toml 2>/dev/null; then
    pytest 2>&1
  else
    echo "No test runner detected — skipping"
  fi
else
  echo "No test runner detected — skipping"
fi
