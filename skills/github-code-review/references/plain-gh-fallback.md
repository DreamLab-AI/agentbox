# Plain `gh` fallback (no claude-flow / ruv-swarm MCP)

Every Quick Start in the five `github-*` skills (code review, multi-repo,
project management, release management, workflow automation) pipes through
`npx claude-flow`/`npx ruv-swarm` swarm orchestration, which needs the
claude-flow MCP server. A session without it — GPT-6 Astra via Codex, or any
Claude Code session that hasn't registered the claude-flow MCP server — can
still do all of this work with `gh` alone, one call at a time instead of
fanning it out across review/security/performance agents. This file is the
plain-`gh` path for each of the five domains.

**Claude Code only:** the multi-agent swarm orchestration (parallel
specialised review agents, cross-repo topology, swarm-coordinated release
pipelines) needs the claude-flow MCP server and its `mcp__claude-flow__*`
tools. **On Codex / GPT-6 Astra** (or any session without that MCP server):
run the equivalent `gh` commands below sequentially in one session instead —
slower, but functionally equivalent for a single PR/release/repo.

## Code review (`github-code-review`)

```bash
# Read the PR
gh pr view 123 --json files,additions,deletions,title,body
gh pr diff 123

# Post a review — approve, request changes, or just comment
gh pr review 123 --comment --body "Looked at the diff; see inline notes."
gh pr review 123 --request-changes --body "Blocking: see the SQL injection note below."
gh pr review 123 --approve --body "LGTM."

# Inline comment on a specific line (requires the commit SHA and path)
gh api repos/:owner/:repo/pulls/123/comments -f body="Comment" -f commit_id="$(gh pr view 123 --json headRefOid -q .headRefOid)" -f path="src/file.js" -F line=42 -f side=RIGHT
```

Do the security/performance/architecture/style passes as separate reads of
the diff (one focus at a time) rather than parallel agents; post one
consolidated review instead of one comment per specialised agent.

## Multi-repo coordination (`github-multi-repo`)

```bash
# Discover repos matching a filter before touching any of them
gh repo list org --topic needs-dependency-bump --json name,url --limit 200

# Apply the same change to each repo in turn, opening a PR per repo
for repo in org/frontend org/backend org/shared; do
  gh api repos/$repo/contents/package.json --jq .content | base64 -d > /tmp/package.json
  # edit /tmp/package.json ...
  gh api -X PUT repos/$repo/contents/package.json \
    -f message="chore: bump shared dependency" \
    -f content="$(base64 -w0 /tmp/package.json)" \
    -f sha="$(gh api repos/$repo/contents/package.json --jq .sha)" \
    -f branch="chore/dep-bump"
  gh pr create --repo $repo --head chore/dep-bump --title "chore: bump shared dependency" --body "Org-wide sync."
done
```

Keep the org-wide safety rule from the main skill: dry-run the discovery
step, prefer PRs over direct pushes, get sign-off before anything
irreversible (force pushes, protected-branch/policy changes).

## Project management (`github-project-management`)

```bash
# Create and label an issue
gh issue create --title "Feature: X" --body "..." --label "enhancement"

# List / triage
gh issue list --label "needs-triage" --json number,title,labels

# Project boards (Projects v2)
PROJECT_ID=$(gh project list --owner @me --format json | jq -r '.projects[0].id')
gh project item-add "$PROJECT_ID" --owner @me --url https://github.com/org/repo/issues/123
gh project item-edit --id <item-id> --field-id <field-id> --project-id "$PROJECT_ID" --single-select-option-id <option-id>
```

## Release management (`github-release-management`)

```bash
# Draft release with auto-generated notes
gh release create v2.0.0 --draft --generate-notes --title "Release v2.0.0"

# Changelog from commits since the last tag
LAST_TAG=$(gh release list --limit 1 --json tagName -q '.[0].tagName')
gh api repos/:owner/:repo/compare/${LAST_TAG}...HEAD --jq '.commits[].commit.message'

# Version bump + publish
npm version patch && git push --follow-tags
gh release create "$(npm pkg get version | tr -d '\"')" --generate-notes
```

## Workflow automation (`github-workflow-automation`)

```bash
# Trigger and inspect a workflow
gh workflow run ci.yml --ref main
gh run list --workflow=ci.yml --limit 5
gh run view <run-id> --log-failed

# Re-run failed jobs
gh run rerun <run-id> --failed
```

Writing or editing the YAML itself (`.github/workflows/*.yml`) is a plain
text edit — no swarm needed either way; the swarm path only adds automated
*generation* (codebase analysis, template selection), not execution.
