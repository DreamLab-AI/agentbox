#!/bin/bash
# Smoke tests for lazy fetch CLI
# Runs core commands and checks they don't crash

PASS=0
FAIL=0
PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
CLI="node ${PROJECT_ROOT}/dist/cli.js"

# Setup: clean test environment
rm -rf /tmp/lazy-test
mkdir -p /tmp/lazy-test
cd /tmp/lazy-test
git init -q

assert() {
  local desc="$1"
  shift
  if eval "$@" >/dev/null 2>&1; then
    echo "  ✓ $desc"
    ((PASS++))
  else
    echo "  ✗ $desc"
    ((FAIL++))
  fi
}

assert_output() {
  local desc="$1"
  local cmd="$2"
  local expected="$3"
  local output
  output=$(eval "$cmd" 2>&1)
  if echo "$output" | grep -q "$expected"; then
    echo "  ✓ $desc"
    ((PASS++))
  else
    echo "  ✗ $desc (expected '$expected')"
    ((FAIL++))
  fi
}

echo ""
echo "  Lazy Fetch Smoke Tests"
echo "─────────────────────────────────────────"

# Help
assert "help works" "$CLI help | grep -q 'lazy'"

# Init
assert "init creates .lazy/" "$CLI init && [ -d .lazy ]"

# Plan
assert_output "plan creates tasks" "$CLI plan 'test the system'" "Plan created"
assert_output "status shows plan" "$CLI status" "test the system"
assert_output "plan refuses duplicate" "$CLI plan 'another plan'" "Active plan"

# Update
assert_output "update changes status" "$CLI update read done" "done"
assert_output "done shorthand works" "$CLI done plan" "done"

# Add
assert_output "add creates task" "$CLI add 'new task' implement" "Added"
assert_output "add auto-infers phase" "$CLI add 'write documentation'" "document"

# Remove
assert_output "remove deletes task" "$CLI rm 'new task'" "Removed"

# Next
assert_output "next shows next task" "$CLI next" "Next up"

# Remember / Recall
assert_output "remember stores fact" "$CLI remember testkey testvalue" "Stored"
assert_output "recall retrieves fact" "$CLI recall testkey" "testvalue"
assert_output "recall shows all" "$CLI recall" "testkey"

# Journal
assert_output "journal adds entry" "$CLI journal 'test entry'" "Journal entry"
assert_output "journal reads entries" "$CLI journal" "test entry"

# Context
assert_output "context shows repo" "$CLI context" "Repo Map"

# Gather
assert_output "gather finds files" "$CLI gather 'test'" "Gathering context"

# Check
assert_output "check runs" "$CLI check" "Health Check"

# Snapshot
assert_output "snapshot saves" "$CLI snapshot test-snap" "Snapshot saved"

# Blueprint list
assert_output "bp list works" "$CLI bp list" "blueprints"

# Plan reset
assert_output "plan reset works" "$CLI plan --reset" "cleared"

# Cleanup
rm -rf /tmp/lazy-test

echo ""
echo "─────────────────────────────────────────"
echo "  Results: $PASS passed, $FAIL failed"
echo ""

if [ $FAIL -gt 0 ]; then
  exit 1
fi
