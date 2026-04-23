# Security Tests

## Canary Pattern

The `secret-canary.sh` test verifies that gitleaks detection is operational. It creates a temporary file containing a test AWS access key (`AKIAIOSFODNN7EXAMPLE`) and asserts that gitleaks detects it.

### Exit Codes

- **0**: Canary secret was detected (expected, test passes)
- **1**: Canary secret was NOT detected (test fails, CI should be alerted)
- **77**: gitleaks not installed (test skipped)

### CI Integration

The secret-scan workflow runs automatically on push and PR. To test locally:

```bash
./tests/security/secret-canary.sh
```

The `.gitleaks.toml` configuration allowlists `.env.example` and `.env.template` files containing placeholder keys, while the canary regex ensures test keys in the canary test are tolerated only by explicit allowlist entry.
