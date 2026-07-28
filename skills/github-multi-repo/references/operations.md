# Multi-Repo Operations — use cases, monitoring, best practices, troubleshooting

The operational command surface (`npx claude-flow skill run github-multi-repo <verb>`),
plus best practices, performance tuning, troubleshooting, and cross-skill integration.

## Use Cases

### 1. Microservices Coordination
```bash
npx claude-flow skill run github-multi-repo microservices \
  --services "auth,users,orders,payments" \
  --ensure-compatibility \
  --sync-contracts \
  --integration-tests
```

### 2. Library Updates
```bash
npx claude-flow skill run github-multi-repo lib-update \
  --library "org/shared-lib" \
  --version "2.0.0" \
  --find-consumers \
  --update-imports \
  --run-tests
```

### 3. Organisation-Wide Changes
```bash
npx claude-flow skill run github-multi-repo org-policy \
  --policy "add-security-headers" \
  --repos "org/*" \
  --validate-compliance \
  --create-reports
```

## Monitoring & Visualization

### Multi-Repo Dashboard
```bash
npx claude-flow skill run github-multi-repo dashboard \
  --port 3000 \
  --metrics "agent-activity,task-progress,memory-usage" \
  --real-time
```

### Dependency Graph
```bash
npx claude-flow skill run github-multi-repo dep-graph \
  --format mermaid \
  --include-agents \
  --show-data-flow
```

### Health Monitoring
```bash
npx claude-flow skill run github-multi-repo health-check \
  --repos "org/*" \
  --check "connectivity,memory,agents" \
  --alert-on-issues
```

## Best Practices

### 1. Repository Organisation
- Clear repository roles and boundaries
- Consistent naming conventions
- Documented dependencies
- Shared configuration standards

### 2. Communication
- Use appropriate sync strategies
- Implement circuit breakers
- Monitor latency and failures
- Clear error propagation

### 3. Security
- Secure cross-repo authentication
- Encrypted communication channels
- Audit trail for all operations
- Principle of least privilege

### 4. Version Management
- Semantic versioning alignment
- Dependency compatibility validation
- Automated version bump coordination

### 5. Testing Integration
- Cross-package test validation
- Integration test automation
- Performance regression detection

## Performance Optimisation

### Caching Strategy
```bash
npx claude-flow skill run github-multi-repo cache-strategy \
  --analyze-patterns \
  --suggest-cache-layers \
  --implement-invalidation
```

### Parallel Execution
```bash
npx claude-flow skill run github-multi-repo parallel-optimize \
  --analyze-dependencies \
  --identify-parallelizable \
  --execute-optimal
```

### Resource Pooling
```bash
npx claude-flow skill run github-multi-repo resource-pool \
  --share-agents \
  --distribute-load \
  --monitor-usage
```

## Troubleshooting

### Connectivity Issues
```bash
npx claude-flow skill run github-multi-repo diagnose-connectivity \
  --test-all-repos \
  --check-permissions \
  --verify-webhooks
```

### Memory Synchronization
```bash
npx claude-flow skill run github-multi-repo debug-memory \
  --check-consistency \
  --identify-conflicts \
  --repair-state
```

### Performance Bottlenecks
```bash
npx claude-flow skill run github-multi-repo perf-analysis \
  --profile-operations \
  --identify-bottlenecks \
  --suggest-optimizations
```

## Advanced Features

### 1. Distributed Task Queue
```bash
npx claude-flow skill run github-multi-repo queue \
  --backend redis \
  --workers 10 \
  --priority-routing \
  --dead-letter-queue
```

### 2. Cross-Repo Testing
```bash
npx claude-flow skill run github-multi-repo test \
  --setup-test-env \
  --link-services \
  --run-e2e \
  --tear-down
```

### 3. Monorepo Migration
```bash
npx claude-flow skill run github-multi-repo to-monorepo \
  --analyze-repos \
  --suggest-structure \
  --preserve-history \
  --create-migration-prs
```

## Examples

### Full-Stack Application Update
```bash
npx claude-flow skill run github-multi-repo fullstack-update \
  --frontend "org/web-app" \
  --backend "org/api-server" \
  --database "org/db-migrations" \
  --coordinate-deployment
```

### Cross-Team Collaboration
```bash
npx claude-flow skill run github-multi-repo cross-team \
  --teams "frontend,backend,devops" \
  --task "implement-feature-x" \
  --assign-by-expertise \
  --track-progress
```

## Metrics and Reporting

### Sync Quality Metrics
- Package version alignment percentage
- Documentation consistency score
- Integration test success rate
- Synchronization completion time

### Architecture Health Metrics
- Repository structure consistency score
- Documentation coverage percentage
- Cross-repository integration success rate
- Template adoption and usage statistics

### Automated Reporting
- Weekly sync status reports
- Dependency drift detection
- Documentation divergence alerts
- Integration health monitoring

## Integration Points

### Related Skills
- `github-code-review` - Single-repo PR review
- `github-release-management` - Release orchestration
- `github-workflow-automation` - CI/CD pipelines
- `github-project-management` - Issue and sprint management

### Related Commands
- `/github sync-coordinator` - Cross-repo synchronization
- `/github release-manager` - Coordinated releases
- `/github repo-architect` - Repository optimisation
- `/sparc architect` - Detailed architecture design

## Support and Resources

- Documentation: https://github.com/ruvnet/claude-flow
- Issues: https://github.com/ruvnet/claude-flow/issues
- Examples: `.claude/examples/github-multi-repo/`
