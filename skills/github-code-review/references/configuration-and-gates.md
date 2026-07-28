# Review Configuration & Quality Gates

## Configuration File

```yaml
# .github/review-swarm.yml
version: 1
review:
  auto-trigger: true
  required-agents:
    - security
    - performance
    - style
  optional-agents:
    - architecture
    - accessibility
    - i18n

  thresholds:
    security: block      # Block merge on security issues
    performance: warn    # Warn on performance issues
    style: suggest       # Suggest style improvements

  rules:
    security:
      - no-eval
      - no-hardcoded-secrets
      - proper-auth-checks
      - validate-input
    performance:
      - no-n-plus-one
      - efficient-queries
      - proper-caching
      - optimize-loops
    architecture:
      - max-coupling: 5
      - min-cohesion: 0.7
      - follow-patterns
      - avoid-circular-deps
```

## Custom Review Triggers

```javascript
{
  "triggers": {
    "high-risk-files": {
      "paths": ["**/auth/**", "**/payment/**", "**/admin/**"],
      "agents": ["security", "architecture"],
      "depth": "comprehensive",
      "require-approval": true
    },
    "performance-critical": {
      "paths": ["**/api/**", "**/database/**", "**/cache/**"],
      "agents": ["performance", "database"],
      "benchmarks": true,
      "regression-threshold": "5%"
    },
    "ui-changes": {
      "paths": ["**/components/**", "**/styles/**", "**/pages/**"],
      "agents": ["accessibility", "style", "i18n"],
      "visual-tests": true,
      "responsive-check": true
    }
  }
}
```

---

## Quality Gates & Checks

### Status Checks

```yaml
# Required status checks in branch protection
protection_rules:
  required_status_checks:
    strict: true
    contexts:
      - "review-swarm/security"
      - "review-swarm/performance"
      - "review-swarm/architecture"
      - "review-swarm/tests"
```

### Define Quality Gates

```bash
# Set quality gate thresholds
npx ruv-swarm github quality-gates \
  --define '{
    "security": {"threshold": "no-critical"},
    "performance": {"regression": "<5%"},
    "coverage": {"minimum": "80%"},
    "architecture": {"complexity": "<10"},
    "duplication": {"maximum": "5%"}
  }'
```

### Track Review Metrics

```bash
# Monitor review effectiveness
npx ruv-swarm github review-metrics \
  --period 30d \
  --metrics "issues-found,false-positives,fix-rate,time-to-review" \
  --export-dashboard \
  --format json
```

---

## Security Considerations

### Best Practices

1. **Token Permissions**: Ensure GitHub tokens have minimal required scopes
2. **Command Validation**: Validate all PR comments before execution
3. **Rate Limiting**: Implement rate limits for PR operations
4. **Audit Trail**: Log all swarm operations for compliance
5. **Secret Management**: Never expose API keys in PR comments or logs

### Security Checklist

- [ ] GitHub token scoped to repository only
- [ ] Webhook signatures verified
- [ ] Command injection protection enabled
- [ ] Rate limiting configured
- [ ] Audit logging enabled
- [ ] Secrets scanning active
- [ ] Branch protection rules enforced

---

## Best Practices

### 1. Review Configuration
- ✅ Define clear review criteria upfront
- ✅ Set appropriate severity thresholds
- ✅ Configure agent specializations for your stack
- ✅ Establish override procedures for emergencies

### 2. Comment Quality
- ✅ Provide actionable, specific feedback
- ✅ Include code examples with suggestions
- ✅ Reference documentation and best practices
- ✅ Maintain respectful, constructive tone

### 3. Performance Optimisation
- ✅ Cache analysis results to avoid redundant work
- ✅ Use incremental reviews for large PRs
- ✅ Enable parallel agent execution
- ✅ Batch comment operations efficiently

### 4. PR Templates

```markdown
<!-- .github/pull_request_template.md -->
## Swarm Configuration
- Topology: [mesh/hierarchical/ring/star]
- Max Agents: [number]
- Auto-spawn: [yes/no]
- Priority: [high/medium/low]

## Tasks for Swarm
- [ ] Task 1 description
- [ ] Task 2 description
- [ ] Task 3 description

## Review Focus Areas
- [ ] Security review
- [ ] Performance analysis
- [ ] Architecture validation
- [ ] Accessibility check
```
