---
name: security-testing
description: "Application security testing: OWASP Top 10 validation, authentication/authorisation testing, API security, dependency vulnerability scanning, secrets detection, injection testing, SAST/DAST workflows. Use for web application and API security validation — not for Linux system hardening (use defense-security for that)."
---

# Security Testing

Application-layer security testing for web services, APIs, and codebases.

## When to use

- Validating OWASP Top 10 vulnerabilities in a web application
- Testing authentication and authorisation flows for bypass vulnerabilities
- API security testing (endpoint exposure, rate limiting, input validation)
- Scanning dependencies for known CVEs
- Detecting secrets and credentials accidentally committed to code
- SAST (static analysis) or DAST (dynamic analysis) workflows

## When NOT to use

- Linux system hardening, firewall rules, CIS compliance → use `defense-security`
- Code quality gates and TDD → use `build-with-quality`
- Infrastructure security scanning → use `defense-security`

## Core Capabilities

### OWASP Top 10 Coverage

| Category | Tests |
|----------|-------|
| A01 Broken Access Control | Path traversal, IDOR, privilege escalation |
| A02 Cryptographic Failures | Weak ciphers, exposed secrets, insecure transport |
| A03 Injection | SQL, XSS, command injection, SSTI |
| A04 Insecure Design | Business logic flaws, missing rate limits |
| A05 Security Misconfiguration | Default credentials, exposed debug, CORS |
| A06 Vulnerable Components | Dependency CVE scanning |
| A07 Auth Failures | Session fixation, weak tokens, brute force |
| A08 Software Integrity | Supply chain checks, SBOM |
| A09 Logging Failures | Missing audit trails, sensitive data in logs |
| A10 SSRF | Server-side request forgery testing |

### Tools Used

- **Static analysis**: semgrep, bandit (Python), gosec (Go), eslint-plugin-security
- **Dependency scanning**: npm audit, pip-audit, cargo audit, trivy
- **Secrets detection**: gitleaks, trufflehog
- **Dynamic testing**: OWASP ZAP (via Docker), custom request sequences
- **Browser-based**: `qe-browser` for injection scanner (install with `aqe init`)

## Quick Start

### Dependency vulnerability scan
```bash
# Node.js
npm audit --audit-level=moderate

# Python
pip-audit

# Rust
cargo audit

# Container image
docker run --rm -v /var/run/docker.sock:/var/run/docker.sock \
  aquasec/trivy image <your-image>
```

### Secrets scan
```bash
# Install gitleaks if not present
which gitleaks || brew install gitleaks

# Scan current repo
gitleaks detect --source . --verbose
```

### SAST with semgrep
```bash
# Install semgrep
pip install semgrep

# Run OWASP ruleset
semgrep --config p/owasp-top-ten .
```

## Integration with build-with-quality

Security testing integrates with `build-with-quality` as a quality gate:
- Run security tests in Phase 3 (QE Verification) of the EDD pipeline
- Failed security gates block the truth-score from reaching 0.95
- Use `verification-quality` to track security gate pass/fail history

## See also

- `defense-security` — Linux system hardening, CIS/HIPAA/SOC2 compliance
- `build-with-quality` — Full development pipeline with integrated security agents
- `qe-browser` — Browser-based injection and XSS scanning (after `aqe init`)
