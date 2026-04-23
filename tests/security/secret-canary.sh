#!/usr/bin/env bash
set -euo pipefail

TMPFILE=$(mktemp)
trap "rm -f $TMPFILE" EXIT

# Create canary file with test secret
cat > "$TMPFILE" << 'EOF'
AWS_SECRET_ACCESS_KEY=AKIAIOSFODNN7EXAMPLE
EOF

# Check if gitleaks is installed
if ! command -v gitleaks &> /dev/null; then
  echo "gitleaks not installed, skipping canary test"
  exit 77
fi

# Run gitleaks on the canary file
if gitleaks detect --source="$TMPFILE" --no-git --report-format=json > /dev/null 2>&1; then
  echo "FAIL: Canary secret was NOT detected by gitleaks"
  exit 1
fi

# Gitleaks exits non-zero when secrets are found (expected behavior)
echo "PASS: Canary secret correctly detected by gitleaks"
exit 0
