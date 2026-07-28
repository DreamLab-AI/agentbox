# GitHub Actions Integration

Complete release and hotfix workflows for CI/CD. (For authoring/optimising the
Actions YAML itself, use the `github-workflow-automation` skill; these are
ready-to-adapt release pipelines.)

## Complete Release Workflow
```yaml
# .github/workflows/release.yml
name: Intelligent Release Workflow
on:
  push:
    tags: ['v*']

jobs:
  release-orchestration:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      packages: write
      issues: write

    steps:
      - name: Checkout Repository
        uses: actions/checkout@v3
        with:
          fetch-depth: 0

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '20'
          cache: 'npm'

      - name: Authenticate GitHub CLI
        run: echo "${{ secrets.GITHUB_TOKEN }}" | gh auth login --with-token

      - name: Initialize Release Swarm
        run: |
          # Extract version from tag
          RELEASE_TAG=${{ github.ref_name }}
          PREV_TAG=$(gh release list --limit 2 --json tagName -q '.[1].tagName')

          # Get merged PRs for changelog
          PRS=$(gh pr list --state merged --base main --json number,title,labels,author,mergedAt \
            --jq ".[] | select(.mergedAt > \"$(gh release view $PREV_TAG --json publishedAt -q .publishedAt)\")")

          # Get commit history
          COMMITS=$(gh api repos/${{ github.repository }}/compare/${PREV_TAG}...HEAD \
            --jq '.commits[].commit.message')

          # Initialize swarm coordination
          npx claude-flow@alpha swarm init --topology hierarchical

          # Store release context
          echo "$PRS" > /tmp/release-prs.json
          echo "$COMMITS" > /tmp/release-commits.txt

      - name: Generate Release Changelog
        run: |
          # Generate intelligent changelog
          CHANGELOG=$(npx claude-flow@alpha github changelog \
            --prs "$(cat /tmp/release-prs.json)" \
            --commits "$(cat /tmp/release-commits.txt)" \
            --from $PREV_TAG \
            --to $RELEASE_TAG \
            --categorize \
            --add-migration-guide \
            --format markdown)

          echo "$CHANGELOG" > RELEASE_CHANGELOG.md

      - name: Build Release Artifacts
        run: |
          # Install dependencies
          npm ci

          # Run comprehensive validation
          npm run lint
          npm run typecheck
          npm run test:all
          npm run build

          # Build platform-specific binaries
          npx claude-flow@alpha github release-build \
            --platforms "linux,macos,windows" \
            --architectures "x64,arm64" \
            --parallel

      - name: Security Scan
        run: |
          # Run security validation
          npm audit --audit-level=moderate

          npx claude-flow@alpha github release-security \
            --scan-dependencies \
            --check-secrets \
            --sign-artifacts

      - name: Create GitHub Release
        run: |
          # Update release with generated changelog
          gh release edit ${{ github.ref_name }} \
            --notes "$(cat RELEASE_CHANGELOG.md)" \
            --draft=false

          # Upload all artifacts
          for file in dist/*; do
            gh release upload ${{ github.ref_name }} "$file"
          done

      - name: Deploy to Package Registries
        run: |
          # Publish to npm
          echo "//registry.npmjs.org/:_authToken=${{ secrets.NPM_TOKEN }}" > .npmrc
          npm publish

          # Build and push Docker images
          docker build -t ${{ github.repository }}:${{ github.ref_name }} .
          docker push ${{ github.repository }}:${{ github.ref_name }}

      - name: Post-Release Validation
        run: |
          # Run smoke tests
          npm run test:smoke

          # Validate deployment
          npx claude-flow@alpha github release-validate \
            --version ${{ github.ref_name }} \
            --smoke-tests \
            --health-checks

      - name: Create Release Announcement
        run: |
          # Create announcement issue
          gh issue create \
            --title "🎉 Released ${{ github.ref_name }}" \
            --body "$(cat RELEASE_CHANGELOG.md)" \
            --label "announcement,release"

          # Notify via discussion
          gh api repos/${{ github.repository }}/discussions \
            --method POST \
            -f title="Release ${{ github.ref_name }} Now Available" \
            -f body="$(cat RELEASE_CHANGELOG.md)" \
            -f category_id="$(gh api repos/${{ github.repository }}/discussions/categories --jq '.[] | select(.slug=="announcements") | .id')"

      - name: Monitor Release
        run: |
          # Start release monitoring
          npx claude-flow@alpha github release-monitor \
            --version ${{ github.ref_name }} \
            --duration 1h \
            --alert-on-errors &
```

## Hotfix Workflow
```yaml
# .github/workflows/hotfix.yml
name: Emergency Hotfix Workflow
on:
  issues:
    types: [labeled]

jobs:
  emergency-hotfix:
    if: contains(github.event.issue.labels.*.name, 'critical-hotfix')
    runs-on: ubuntu-latest

    steps:
      - name: Create Hotfix Branch
        run: |
          LAST_STABLE=$(gh release list --limit 1 --json tagName -q '.[0].tagName')
          HOTFIX_VERSION=$(echo $LAST_STABLE | awk -F. '{print $1"."$2"."$3+1}')

          git checkout -b hotfix/$HOTFIX_VERSION $LAST_STABLE

      - name: Fast-Track Testing
        run: |
          npm ci
          npm run test:critical
          npm run build

      - name: Emergency Release
        run: |
          npx claude-flow@alpha github emergency-release \
            --issue ${{ github.event.issue.number }} \
            --severity critical \
            --fast-track \
            --notify-all
```
