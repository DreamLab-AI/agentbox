# PR-Based Swarm Management & Automation

Covers PR-driven swarm orchestration, comment-command interfaces, webhooks,
automated review workflows, intelligent comment generation, and auto-fixes.

## Create Swarm from PR

```bash
# Create swarm from PR description using gh CLI
gh pr view 123 --json body,title,labels,files | npx ruv-swarm swarm create-from-pr

# Auto-spawn agents based on PR labels
gh pr view 123 --json labels | npx ruv-swarm swarm auto-spawn

# Create swarm with full PR context
gh pr view 123 --json body,labels,author,assignees | \
  npx ruv-swarm swarm init --from-pr-data
```

## Label-Based Agent Assignment

Map PR labels to specialized agents:

```json
{
  "label-mapping": {
    "bug": ["debugger", "tester"],
    "feature": ["architect", "coder", "tester"],
    "refactor": ["analyst", "coder"],
    "docs": ["researcher", "writer"],
    "performance": ["analyst", "optimizer"],
    "security": ["security", "authentication", "audit"]
  }
}
```

## Topology Selection by PR Size

```bash
# Automatic topology selection based on PR complexity
# Small PR (< 100 lines): ring topology
# Medium PR (100-500 lines): mesh topology
# Large PR (> 500 lines): hierarchical topology
npx ruv-swarm github pr-topology --pr 123
```

---

## PR Comment Commands

Execute swarm commands directly from PR comments:

```markdown
<!-- In PR comment -->
/swarm init mesh 6
/swarm spawn coder "Implement authentication"
/swarm spawn tester "Write unit tests"
/swarm status
/swarm review --agents security,performance
```

<details>
<summary><strong>Webhook Handler for Comment Commands</strong></summary>

```javascript
// webhook-handler.js
const { createServer } = require('http');
const { execSync } = require('child_process');

createServer((req, res) => {
  if (req.url === '/github-webhook') {
    const event = JSON.parse(body);

    if (event.action === 'opened' && event.pull_request) {
      execSync(`npx ruv-swarm github pr-init ${event.pull_request.number}`);
    }

    if (event.comment && event.comment.body.startsWith('/swarm')) {
      const command = event.comment.body;
      execSync(`npx ruv-swarm github handle-comment --pr ${event.issue.number} --command "${command}"`);
    }

    res.writeHead(200);
    res.end('OK');
  }
}).listen(3000);
```

</details>

---

## Automated Workflows

### Auto-Review on PR Creation

```yaml
# .github/workflows/auto-review.yml
name: Automated Code Review
on:
  pull_request:
    types: [opened, synchronize]
  issue_comment:
    types: [created]

jobs:
  swarm-review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
        with:
          fetch-depth: 0

      - name: Setup GitHub CLI
        run: echo "${{ secrets.GITHUB_TOKEN }}" | gh auth login --with-token

      - name: Run Review Swarm
        run: |
          # Get PR context with gh CLI
          PR_NUM=${{ github.event.pull_request.number }}
          PR_DATA=$(gh pr view $PR_NUM --json files,title,body,labels)
          PR_DIFF=$(gh pr diff $PR_NUM)

          # Run swarm review
          REVIEW_OUTPUT=$(npx ruv-swarm github review-all \
            --pr $PR_NUM \
            --pr-data "$PR_DATA" \
            --diff "$PR_DIFF" \
            --agents "security,performance,style,architecture")

          # Post review results
          echo "$REVIEW_OUTPUT" | gh pr review $PR_NUM --comment -F -

          # Update PR status
          if echo "$REVIEW_OUTPUT" | grep -q "approved"; then
            gh pr review $PR_NUM --approve
          elif echo "$REVIEW_OUTPUT" | grep -q "changes-requested"; then
            gh pr review $PR_NUM --request-changes -b "See review comments above"
          fi

      - name: Update Labels
        run: |
          # Add labels based on review results
          if echo "$REVIEW_OUTPUT" | grep -q "security"; then
            gh pr edit $PR_NUM --add-label "security-review"
          fi
          if echo "$REVIEW_OUTPUT" | grep -q "performance"; then
            gh pr edit $PR_NUM --add-label "performance-review"
          fi
```

---

## Intelligent Comment Generation

### Generate Contextual Review Comments

```bash
# Get PR diff with context
PR_DIFF=$(gh pr diff 123 --color never)
PR_FILES=$(gh pr view 123 --json files)

# Generate review comments
COMMENTS=$(npx ruv-swarm github review-comment \
  --pr 123 \
  --diff "$PR_DIFF" \
  --files "$PR_FILES" \
  --style "constructive" \
  --include-examples \
  --suggest-fixes)

# Post comments using gh CLI
echo "$COMMENTS" | jq -c '.[]' | while read -r comment; do
  FILE=$(echo "$comment" | jq -r '.path')
  LINE=$(echo "$comment" | jq -r '.line')
  BODY=$(echo "$comment" | jq -r '.body')
  COMMIT_ID=$(gh pr view 123 --json headRefOid -q .headRefOid)

  # Create inline review comments
  gh api \
    --method POST \
    /repos/:owner/:repo/pulls/123/comments \
    -f path="$FILE" \
    -f line="$LINE" \
    -f body="$BODY" \
    -f commit_id="$COMMIT_ID"
done
```

### Batch Comment Management

```bash
# Manage review comments efficiently
npx ruv-swarm github review-comments \
  --pr 123 \
  --group-by "agent,severity" \
  --summarize \
  --resolve-outdated
```

---

## CI/CD Integration

### Integration with Build Pipeline

```yaml
# .github/workflows/build-and-review.yml
name: Build and Review
on: [pull_request]

jobs:
  build-and-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - run: npm install
      - run: npm test
      - run: npm run build

  swarm-review:
    needs: build-and-test
    runs-on: ubuntu-latest
    steps:
      - name: Run Swarm Review
        run: |
          npx ruv-swarm github review-all \
            --pr ${{ github.event.pull_request.number }} \
            --include-build-results
```

### Automated PR Fixes

```bash
# Auto-fix common issues
npx ruv-swarm github pr-fix 123 \
  --issues "lint,test-failures,formatting" \
  --commit-fixes \
  --push-changes
```

### Progress Updates to PR

```bash
# Post swarm progress to PR using gh CLI
PROGRESS=$(npx ruv-swarm github pr-progress 123 --format markdown)

gh pr comment 123 --body "$PROGRESS"

# Update PR labels based on progress
if [[ $(echo "$PROGRESS" | grep -o '[0-9]\+%' | sed 's/%//') -gt 90 ]]; then
  gh pr edit 123 --add-label "ready-for-review"
fi
```

### Auto-Merge When Ready

```bash
# Auto-merge when swarm completes and passes checks
SWARM_STATUS=$(npx ruv-swarm github pr-status 123)

if [[ "$SWARM_STATUS" == "complete" ]]; then
  # Check review requirements
  REVIEWS=$(gh pr view 123 --json reviews --jq '.reviews | length')

  if [[ $REVIEWS -ge 2 ]]; then
    # Enable auto-merge
    gh pr merge 123 --auto --squash
  fi
fi
```
