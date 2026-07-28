# Best Practices, Debugging, Examples & Command Reference

## Best Practices

### Workflow Organisation

#### 1. Use Reusable Workflows
```yaml
# .github/workflows/reusable-swarm.yml
name: Reusable Swarm Workflow
on:
  workflow_call:
    inputs:
      topology:
        required: true
        type: string

jobs:
  swarm-task:
    runs-on: ubuntu-latest
    steps:
      - name: Initialize Swarm
        run: |
          npx ruv-swarm init --topology ${{ inputs.topology }}
```

#### 2. Implement Proper Caching
```yaml
- name: Cache Swarm Dependencies
  uses: actions/cache@v3
  with:
    path: ~/.npm
    key: ${{ runner.os }}-swarm-${{ hashFiles('**/package-lock.json') }}
```

#### 3. Set Appropriate Timeouts
```yaml
jobs:
  swarm-task:
    timeout-minutes: 30
    steps:
      - name: Swarm Operation
        timeout-minutes: 10
```

#### 4. Use Workflow Dependencies
```yaml
jobs:
  setup:
    runs-on: ubuntu-latest

  test:
    needs: setup
    runs-on: ubuntu-latest

  deploy:
    needs: [setup, test]
    runs-on: ubuntu-latest
```

### Security Best Practices

#### 1. Store Configurations Securely
```yaml
- name: Setup Swarm
  env:
    SWARM_CONFIG: ${{ secrets.SWARM_CONFIG }}
    API_KEY: ${{ secrets.API_KEY }}
  run: |
    npx ruv-swarm init --config "$SWARM_CONFIG"
```

#### 2. Use OIDC Authentication
```yaml
permissions:
  id-token: write
  contents: read

- name: Configure AWS Credentials
  uses: aws-actions/configure-aws-credentials@v2
  with:
    role-to-assume: arn:aws:iam::123456789012:role/GitHubAction
    aws-region: us-east-1
```

#### 3. Implement Least-Privilege
```yaml
permissions:
  contents: read
  pull-requests: write
  issues: write
```

#### 4. Audit Swarm Operations
```yaml
- name: Audit Swarm Actions
  run: |
    npx ruv-swarm actions audit \
      --export-logs \
      --compliance-report
```

### Performance Optimisation

#### 1. Cache Swarm Dependencies
```yaml
- uses: actions/cache@v3
  with:
    path: |
      ~/.npm
      node_modules
    key: ${{ runner.os }}-swarm-${{ hashFiles('**/package-lock.json') }}
```

#### 2. Use Appropriate Runner Sizes
```yaml
jobs:
  heavy-task:
    runs-on: ubuntu-latest-4-cores
    steps:
      - name: Intensive Swarm Operation
```

#### 3. Implement Early Termination
```yaml
- name: Quick Fail Check
  run: |
    if ! npx ruv-swarm actions pre-check; then
      echo "Pre-check failed, terminating early"
      exit 1
    fi
```

#### 4. Optimise Parallel Execution
```yaml
strategy:
  matrix:
    include:
      - runner: ubuntu-latest
        task: test
      - runner: ubuntu-latest
        task: lint
      - runner: ubuntu-latest
        task: security
  max-parallel: 3
```

## Debugging & Troubleshooting

#### Debug Mode
```yaml
- name: Debug Swarm
  run: |
    npx ruv-swarm actions debug \
      --verbose \
      --trace-agents \
      --export-logs
  env:
    ACTIONS_STEP_DEBUG: true
```

#### Performance Profiling
```bash
# Profile workflow performance
npx ruv-swarm actions profile \
  --workflow "ci.yml" \
  --identify-slow-steps \
  --suggest-optimizations
```

#### Failure Analysis
```bash
# Analyze failed runs
gh run view <run-id> --json jobs,conclusion | \
  npx ruv-swarm actions analyze-failure \
    --suggest-fixes \
    --auto-retry-flaky
```

#### Log Analysis
```bash
# Download and analyze logs
gh run download <run-id>
npx ruv-swarm actions analyze-logs \
  --directory ./logs \
  --identify-errors
```

## Real-World Examples

#### Example 1: Full-Stack Application CI/CD
```yaml
name: Full-Stack CI/CD with Swarms
on:
  push:
    branches: [main, develop]
  pull_request:

jobs:
  initialize:
    runs-on: ubuntu-latest
    outputs:
      swarm-id: ${{ steps.init.outputs.swarm-id }}
    steps:
      - id: init
        run: |
          SWARM_ID=$(npx ruv-swarm init --topology mesh --output json | jq -r '.id')
          echo "swarm-id=${SWARM_ID}" >> $GITHUB_OUTPUT

  backend:
    needs: initialize
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Backend Tests
        run: |
          npx ruv-swarm agents spawn --type tester \
            --task "Run backend test suite" \
            --swarm-id ${{ needs.initialize.outputs.swarm-id }}

  frontend:
    needs: initialize
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Frontend Tests
        run: |
          npx ruv-swarm agents spawn --type tester \
            --task "Run frontend test suite" \
            --swarm-id ${{ needs.initialize.outputs.swarm-id }}

  security:
    needs: initialize
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Security Scan
        run: |
          npx ruv-swarm agents spawn --type security \
            --task "Security audit" \
            --swarm-id ${{ needs.initialize.outputs.swarm-id }}

  deploy:
    needs: [backend, frontend, security]
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - name: Deploy
        run: |
          npx ruv-swarm actions deploy \
            --strategy progressive \
            --swarm-id ${{ needs.initialize.outputs.swarm-id }}
```

#### Example 2: Monorepo Management
```yaml
name: Monorepo Coordination
on: push

jobs:
  detect-changes:
    runs-on: ubuntu-latest
    outputs:
      packages: ${{ steps.detect.outputs.packages }}
    steps:
      - uses: actions/checkout@v3
        with:
          fetch-depth: 0

      - id: detect
        run: |
          PACKAGES=$(npx ruv-swarm actions detect-changes \
            --monorepo \
            --output json)
          echo "packages=${PACKAGES}" >> $GITHUB_OUTPUT

  build-packages:
    needs: detect-changes
    runs-on: ubuntu-latest
    strategy:
      matrix:
        package: ${{ fromJson(needs.detect-changes.outputs.packages) }}
    steps:
      - name: Build Package
        run: |
          npx ruv-swarm actions build \
            --package ${{ matrix.package }} \
            --parallel-deps
```

#### Example 3: Multi-Repo Synchronization
```bash
# Synchronize multiple repositories
npx claude-flow@alpha github sync-coordinator \
  "Synchronize version updates across:
   - github.com/org/repo-a
   - github.com/org/repo-b
   - github.com/org/repo-c

   Update dependencies, align versions, create PRs"
```

## Command Reference

#### Workflow Generation
```bash
npx ruv-swarm actions generate-workflow [options]
  --analyze-codebase       Analyze repository structure
  --detect-languages       Detect programming languages
  --create-optimal-pipeline Generate optimized workflow
```

#### Optimisation
```bash
npx ruv-swarm actions optimize [options]
  --workflow <path>        Path to workflow file
  --suggest-parallelization Suggest parallel execution
  --reduce-redundancy      Remove redundant steps
  --estimate-savings       Estimate time/cost savings
```

#### Analysis
```bash
npx ruv-swarm actions analyze [options]
  --commit <sha>           Analyze specific commit
  --suggest-tests          Suggest test improvements
  --optimize-pipeline      Optimize pipeline structure
```

#### Testing
```bash
npx ruv-swarm actions smart-test [options]
  --changed-files <files>  Files that changed
  --impact-analysis        Analyze test impact
  --parallel-safe          Only parallel-safe tests
```

#### Security
```bash
npx ruv-swarm actions security [options]
  --deep-scan             Deep security analysis
  --format <format>       Output format (json/text)
  --create-issues         Auto-create GitHub issues
```

#### Deployment
```bash
npx ruv-swarm actions deploy [options]
  --strategy <type>       Deployment strategy
  --risk <level>          Risk assessment level
  --auto-execute          Execute automatically
```

#### Monitoring
```bash
npx ruv-swarm actions analytics [options]
  --workflow <name>       Workflow to analyze
  --period <duration>     Analysis period
  --identify-bottlenecks  Find bottlenecks
  --suggest-improvements  Improvement suggestions
```

## Integration Checklist — Setup Verification

- [ ] GitHub CLI (`gh`) installed and authenticated
- [ ] Git configured with user credentials
- [ ] Node.js v16+ installed
- [ ] `claude-flow@alpha` package available
- [ ] Repository has `.github/workflows` directory
- [ ] GitHub Actions enabled on repository
- [ ] Necessary secrets configured
- [ ] Runner permissions verified

#### Quick Setup Script
```bash
#!/bin/bash
# setup-github-automation.sh

# Install dependencies
npm install -g claude-flow@alpha

# Verify GitHub CLI
gh auth status || gh auth login

# Create workflow directory
mkdir -p .github/workflows

# Generate initial workflow
npx ruv-swarm actions generate-workflow \
  --analyze-codebase \
  --create-optimal-pipeline > .github/workflows/ci.yml

echo "✅ GitHub workflow automation setup complete"
```

## Support & Documentation

- **GitHub CLI Docs**: https://cli.github.com/manual/
- **GitHub Actions**: https://docs.github.com/en/actions
- **Claude-Flow**: https://github.com/ruvnet/claude-flow
- **Ruv-Swarm**: https://github.com/ruvnet/ruv-swarm

## Version History

- **v1.0.0** (2025-01-19): Initial skill consolidation
  - Merged workflow-automation.md (441 lines)
  - Merged github-modes.md (146 lines)
  - Added progressive disclosure
  - Enhanced with swarm coordination patterns
  - Added comprehensive examples and best practices
