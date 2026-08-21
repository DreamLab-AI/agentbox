# Security Scanner

The `lazy_secure` tool runs a 23-rule pattern-based security audit across all
source files. It scans `.ts`, `.tsx`, `.js`, `.jsx`, `.py`, `.rb`, `.go`,
`.rs`, `.java`, `.php`, `.sql`, `.yaml`, `.json`, `.env`, `.sh`, `.html`,
and more.

## Rule Categories

**Critical** (6 rules): hardcoded API keys, hardcoded passwords, AWS access
keys, inline private keys, hardcoded JWT secrets, database connection strings
with embedded credentials, committed .env files.

**High** (6 rules): SQL injection via string concatenation, command injection
via unsanitised user input in exec/spawn, path traversal, XSS via
dangerouslySetInnerHTML, eval() usage, unsafe RegExp from user input.

**Medium** (7 rules): CORS wildcard, API routes without auth, HTTP URLs in
production code, insecure cookies, missing rate limiting, unsafe
deserialisation, exposed error details to clients.

**Low** (4 rules): console.log with sensitive data, security-related TODOs,
debug mode enabled, weak crypto algorithms (MD5/SHA1).

## Gate Mode

`lazy_secure(gate: true)` runs only critical and high rules, skipping the
dependency audit. This mode is used as a validation gate in yolo mode and
by `lazy_check` for quick security feedback.

## Dependency Audit

In full mode, the scanner also runs `npm audit` (if `package-lock.json`
exists) and reports critical, high, and moderate vulnerabilities.
