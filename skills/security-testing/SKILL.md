---
name: security-testing
description: "Application security testing with the baked semgrep, gitleaks and trivy: SAST, secrets scanning, dependency and misconfiguration scans, plus OWASP Top 10, authentication, signed-request and API review methods. Use to validate a web service or codebase. Not for host hardening or CIS benchmarks, nor quality checks of a running page (qe-browser)."
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

- Linux host hardening, firewall rules, CIS compliance: out of scope (no installed skill hardens hosts; this container is not the target)
- Code quality gates and TDD → use `visioncraft`
- Infrastructure and container image scanning: `trivy image` / `trivy config` (below)

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

- **Baked in the image** (present after the next image build; `command -v semgrep gitleaks trivy` to check): `semgrep`, `gitleaks`, `trivy`
- **Not baked**: bandit, gosec, pip-audit, cargo-audit, trufflehog, OWASP ZAP; use them only if already on PATH
- **Dependency scanning**: `trivy fs`, plus `npm audit` where Node is present
- **Dynamic testing**: custom request sequences against a running service (ZAP needs Docker, which is denied here)
- **Browser-based**: `qe-browser` for URL validation and in-page checks via the agentic-qe tools

## Signed-request and stateful API reviews

Trace each route to the verifier it actually calls, including the consumer's
pinned dependency. Test valid requests as well as rejected ones; a first-request
panic is not a replay reproduction. Where the protocol binds a body, test the
transmitted bytes, missing tags, altered bodies and query/authority changes.
Distinguish signature verification, authorisation, replay admission and durable
operation idempotency. State what happens to a token after rejection and after
a business-operation failure, and whether admission spans processes/restarts.

Inspect durable effects after errors: a charge can succeed before response
construction fails, and two file writes are not one transaction. Verify scanner
claims against available upstream source before treating unknown behaviour as a
vulnerability. Gate PASS means only that the configured threshold was not crossed;
read separate bug categories and skipped coverage as well.

For findings intake and evidence boundaries, follow
[review-evidence.md](../visioncraft/references/review-evidence.md).
Keep inconclusive findings open rather than labelling them false positives.

For optional binding, distinguish an absent input from a present empty value.
Exercise valid non-empty and empty requests, missing binding tags, changed
content and removal of signed content. Verify both the producer's signing
helper and the real route's stored result; helper-only acceptance is not proof
of an authorisation bypass. Check that a rejected substitution leaves the
original credential usable when that is the intended admission policy.

For replay retention, compare eviction time with the entire remaining token
acceptance window, including clock skew and inclusive timestamp boundaries.
Test just before, at and after expiry with controlled clocks where available;
check direct constructors as well as environment validation. A short-TTL probe
does not prove a default-TTL defect. For URL scope policies, compare parsed
authority and path boundaries; test sibling names and host-prefix collisions
against the intended policy, then trace the caller before claiming exposure.

For approval, moderation or mirror pipelines, test publication separately from
discovery. Name a rejected object's identifier directly through every reader of
the backing store, including raw, rendered, API and archive paths, and probe the
window between ingest and verdict. An integrity check or hidden reference is
not a publication boundary when local readers share the object store. Include a
pre-repair stored fixture so a future-ingest fix cannot conceal migration debt.

## Quick Start

### Network needs (read first)

The binaries are local; some data is not. `semgrep --config auto` and `--config p/...` fetch rules from the semgrep registry, `trivy` downloads its vulnerability DB (and Java DB) on first use, and `npm audit` queries the registry. Offline, use the forms marked offline below.

### Dependency and misconfiguration scan
```bash
# Offline: misconfiguration and secrets need no vulnerability DB
trivy fs --scanners misconfig,secret .

# Online (first run downloads the DB): known CVEs in lockfiles
trivy fs --scanners vuln .

# Offline only when a DB is already cached under ~/.cache/trivy
trivy fs --scanners vuln --skip-db-update .

# Container images: scan an exported tarball, no Docker daemon needed
trivy image --input image.tar
```

### Secrets scan
```bash
# Working tree only (offline)
gitleaks dir --verbose .

# Git history (offline)
gitleaks git --verbose .
```
Older gitleaks releases use `gitleaks detect --source .`; check `gitleaks --help`. Treat any hit as live: report the file and rule, never print the secret value into shared output (`--redact`).

### SAST with semgrep
```bash
# Offline: your own rule files
semgrep --config rules/ --metrics=off .

# Online: registry rulesets (fetches rules at run time)
semgrep --config p/owasp-top-ten --metrics=off .
```
`--metrics=off` stops telemetry. An offline run only finds what your local rules describe; say so when reporting a clean result.

## Integration with visioncraft

Security testing integrates with `visioncraft` as a quality gate:
- Run security tests in Phase 3 (QE Verification) of the EDD pipeline
- Failed security gates block the truth-score from reaching 0.95
- Use `verification-quality` to track security gate pass/fail history

## See also

- `visioncraft` — Full development pipeline with integrated security agents
- `qe-browser` — URL validation and browser-based checks via agentic-qe tools
