# Specialized Review Agents

Deploy specialized AI agents for comprehensive code review. Each agent focuses on
one domain and can run in parallel with the others.

## Multi-Agent Review System

```bash
# Initialize review swarm with GitHub CLI integration
PR_DATA=$(gh pr view 123 --json files,additions,deletions,title,body)
PR_DIFF=$(gh pr diff 123)

# Start multi-agent review
npx ruv-swarm github review-init \
  --pr 123 \
  --pr-data "$PR_DATA" \
  --diff "$PR_DIFF" \
  --agents "security,performance,style,architecture,accessibility" \
  --depth comprehensive

# Post initial review status
gh pr comment 123 --body "🔍 Multi-agent code review initiated"
```

**Benefits:**
- ✅ Parallel review by specialized agents
- ✅ Comprehensive coverage across multiple domains
- ✅ Faster review cycles with coordinated analysis
- ✅ Consistent quality standards enforcement

---

## Security Review Agent

**Focus:** Identify security vulnerabilities and suggest fixes

```bash
# Get changed files from PR
CHANGED_FILES=$(gh pr view 123 --json files --jq '.files[].path')

# Run security-focused review
SECURITY_RESULTS=$(npx ruv-swarm github review-security \
  --pr 123 \
  --files "$CHANGED_FILES" \
  --check "owasp,cve,secrets,permissions" \
  --suggest-fixes)

# Post findings based on severity
if echo "$SECURITY_RESULTS" | grep -q "critical"; then
  # Request changes for critical issues
  gh pr review 123 --request-changes --body "$SECURITY_RESULTS"
  gh pr edit 123 --add-label "security-review-required"
else
  # Post as comment for non-critical issues
  gh pr comment 123 --body "$SECURITY_RESULTS"
fi
```

<details>
<summary><strong>Security Checks Performed</strong></summary>

```javascript
{
  "checks": [
    "SQL injection vulnerabilities",
    "XSS attack vectors",
    "Authentication bypasses",
    "Authorization flaws",
    "Cryptographic weaknesses",
    "Dependency vulnerabilities",
    "Secret exposure",
    "CORS misconfigurations"
  ],
  "actions": [
    "Block PR on critical issues",
    "Suggest secure alternatives",
    "Add security test cases",
    "Update security documentation"
  ]
}
```

</details>

<details>
<summary><strong>Comment Template: Security Issue</strong></summary>

```markdown
🔒 **Security Issue: [Type]**

**Severity**: 🔴 Critical / 🟡 High / 🟢 Low

**Description**:
[Clear explanation of the security issue]

**Impact**:
[Potential consequences if not addressed]

**Suggested Fix**:
```language
[Code example of the fix]
```

**References**:
- [OWASP Guide](link)
- [Security Best Practices](link)
```

</details>

---

## Performance Review Agent

**Focus:** Analyse performance impact and optimisation opportunities

```bash
# Run performance analysis
npx ruv-swarm github review-performance \
  --pr 123 \
  --profile "cpu,memory,io" \
  --benchmark-against main \
  --suggest-optimizations
```

<details>
<summary><strong>Performance Metrics Analyzed</strong></summary>

```javascript
{
  "metrics": [
    "Algorithm complexity (Big O analysis)",
    "Database query efficiency",
    "Memory allocation patterns",
    "Cache utilization",
    "Network request optimization",
    "Bundle size impact",
    "Render performance"
  ],
  "benchmarks": [
    "Compare with baseline",
    "Load test simulations",
    "Memory leak detection",
    "Bottleneck identification"
  ]
}
```

</details>

---

## Architecture Review Agent

**Focus:** Evaluate design patterns and architectural decisions

```bash
# Architecture review
npx ruv-swarm github review-architecture \
  --pr 123 \
  --check "patterns,coupling,cohesion,solid" \
  --visualize-impact \
  --suggest-refactoring
```

<details>
<summary><strong>Architecture Analysis</strong></summary>

```javascript
{
  "patterns": [
    "Design pattern adherence",
    "SOLID principles",
    "DRY violations",
    "Separation of concerns",
    "Dependency injection",
    "Layer violations",
    "Circular dependencies"
  ],
  "metrics": [
    "Coupling metrics",
    "Cohesion scores",
    "Complexity measures",
    "Maintainability index"
  ]
}
```

</details>

---

## Style & Convention Agent

**Focus:** Enforce coding standards and best practices

```bash
# Style enforcement with auto-fix
npx ruv-swarm github review-style \
  --pr 123 \
  --check "formatting,naming,docs,tests" \
  --auto-fix "formatting,imports,whitespace"
```

<details>
<summary><strong>Style Checks</strong></summary>

```javascript
{
  "checks": [
    "Code formatting",
    "Naming conventions",
    "Documentation standards",
    "Comment quality",
    "Test coverage",
    "Error handling patterns",
    "Logging standards"
  ],
  "auto-fix": [
    "Formatting issues",
    "Import organization",
    "Trailing whitespace",
    "Simple naming issues"
  ]
}
```

</details>

---

## Custom Review Agents

### Create Custom Agent

```javascript
// custom-review-agent.js
class CustomReviewAgent {
  constructor(config) {
    this.config = config;
    this.rules = config.rules || [];
  }

  async review(pr) {
    const issues = [];

    // Custom logic: Check for TODO comments in production code
    if (await this.checkTodoComments(pr)) {
      issues.push({
        severity: 'warning',
        file: pr.file,
        line: pr.line,
        message: 'TODO comment found in production code',
        suggestion: 'Resolve TODO or create issue to track it'
      });
    }

    // Custom logic: Verify API versioning
    if (await this.checkApiVersioning(pr)) {
      issues.push({
        severity: 'error',
        file: pr.file,
        line: pr.line,
        message: 'API endpoint missing versioning',
        suggestion: 'Add /v1/, /v2/ prefix to API routes'
      });
    }

    return issues;
  }

  async checkTodoComments(pr) {
    // Implementation
    const todoRegex = /\/\/\s*TODO|\/\*\s*TODO/gi;
    return todoRegex.test(pr.diff);
  }

  async checkApiVersioning(pr) {
    // Implementation
    const apiRegex = /app\.(get|post|put|delete)\(['"]\/api\/(?!v\d+)/;
    return apiRegex.test(pr.diff);
  }
}

module.exports = CustomReviewAgent;
```

### Register Custom Agent

```bash
# Register custom review agent
npx ruv-swarm github register-agent \
  --name "custom-reviewer" \
  --file "./custom-review-agent.js" \
  --category "standards"
```
