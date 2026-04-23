import { execSync } from "child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join, relative, extname } from "path";

// --- Types ---

type Severity = "critical" | "high" | "medium" | "low";

interface Finding {
  severity: Severity;
  rule: string;
  file: string;
  line: number;
  snippet: string;
  description: string;
}

interface SecureReport {
  findings: Finding[];
  filesScanned: number;
  rulesChecked: number;
  duration: number;
}

// --- Ignore patterns (reuse context.ts pattern) ---

function getIgnoreDirs(root: string): Set<string> {
  const base = new Set([
    "node_modules", ".git", ".lazy", "dist", "build", ".next",
    "__pycache__", ".venv", "venv", ".cache", "coverage",
    "vendor", "target", ".turbo", ".vercel",
  ]);
  try {
    const content = readFileSync(join(root, ".gitignore"), "utf-8");
    for (const line of content.split("\n")) {
      const l = line.trim().replace(/\/$/, "");
      if (l && !l.startsWith("#") && !l.includes("*") && !l.startsWith("!")) {
        base.add(l);
      }
    }
  } catch {}
  return base;
}

const SCAN_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".rb", ".go", ".rs", ".java",
  ".php", ".cs", ".swift",
  ".sql", ".graphql", ".gql",
  ".yaml", ".yml", ".json", ".toml",
  ".env", ".sh", ".bash",
  ".html", ".htm", ".svelte", ".vue",
]);

// --- File walker ---

function walkFiles(root: string): { path: string; relative: string }[] {
  const ignoreDirs = getIgnoreDirs(root);
  const results: { path: string; relative: string }[] = [];

  function walk(dir: string): void {
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (ignoreDirs.has(entry.name)) continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!entry.name.startsWith(".")) walk(full);
        } else {
          const ext = extname(entry.name).toLowerCase();
          // Also scan dotfiles like .env
          if (SCAN_EXTENSIONS.has(ext) || entry.name.startsWith(".env")) {
            try {
              const stat = statSync(full);
              if (stat.size < 500_000) { // skip files > 500KB
                results.push({ path: full, relative: relative(root, full) });
              }
            } catch {}
          }
        }
      }
    } catch {}
  }

  walk(root);
  return results;
}

// --- Security Rules ---

interface Rule {
  id: string;
  severity: Severity;
  description: string;
  extensions?: string[]; // only check these extensions, undefined = all
  pattern: RegExp;
  exclude?: RegExp; // skip matches that also match this
}

const RULES: Rule[] = [
  // === CRITICAL: Secrets & Credentials ===
  {
    id: "hardcoded-secret",
    severity: "critical",
    description: "Hardcoded API key or secret",
    pattern: /(?:api[_-]?key|api[_-]?secret|secret[_-]?key|access[_-]?token|auth[_-]?token|private[_-]?key)\s*[:=]\s*["'`][A-Za-z0-9+/=_-]{16,}/i,
    exclude: /example|placeholder|your[_-]|xxx|test|mock|fake|dummy|TODO|CHANGEME|process\.env/i,
  },
  {
    id: "hardcoded-password",
    severity: "critical",
    description: "Hardcoded password",
    pattern: /(?:password|passwd|pwd)\s*[:=]\s*["'`][^"'`\s]{4,}/i,
    exclude: /example|placeholder|your[_-]|xxx|test|mock|fake|dummy|TODO|CHANGEME|process\.env|schema|type|interface|validation|zod|yup|\*{3,}/i,
  },
  {
    id: "aws-key",
    severity: "critical",
    description: "AWS access key",
    pattern: /AKIA[0-9A-Z]{16}/,
  },
  {
    id: "private-key-inline",
    severity: "critical",
    description: "Private key embedded in source",
    pattern: /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----/,
  },
  {
    id: "jwt-secret-hardcoded",
    severity: "critical",
    description: "Hardcoded JWT secret",
    pattern: /(?:jwt[_-]?secret|token[_-]?secret)\s*[:=]\s*["'`][^"'`\s]{8,}/i,
    exclude: /process\.env|example|placeholder|TODO/i,
  },
  {
    id: "connection-string",
    severity: "critical",
    description: "Database connection string with credentials",
    pattern: /(?:postgres|mysql|mongodb|redis):\/\/[^:]+:[^@\s]+@[^\s"'`]+/i,
    exclude: /localhost|127\.0\.0\.1|example\.com|placeholder/i,
  },

  // === HIGH: Injection Vulnerabilities ===
  {
    id: "sql-injection",
    severity: "high",
    description: "Potential SQL injection — string concatenation in query",
    extensions: [".ts", ".tsx", ".js", ".jsx", ".py", ".rb", ".php", ".go"],
    pattern: /(?:query|execute|exec|raw)\s*\(\s*[`"'].*\$\{|(?:query|execute|exec|raw)\s*\(\s*[^)]*\+\s*(?:req|params|query|body|input|user)/i,
    exclude: /prisma\.|drizzle\.|knex\.|supabase\./i,
  },
  {
    id: "command-injection",
    severity: "high",
    description: "Potential command injection — user input in exec/spawn",
    extensions: [".ts", ".tsx", ".js", ".jsx", ".py", ".rb"],
    pattern: /(?:exec|execSync|spawn|spawnSync|system|popen)\s*\([^)]*(?:req\.|params\.|query\.|body\.|input|user|args)/i,
  },
  {
    id: "path-traversal",
    severity: "high",
    description: "Potential path traversal — unsanitized path from user input",
    extensions: [".ts", ".tsx", ".js", ".jsx", ".py", ".go"],
    pattern: /(?:readFile|writeFile|createReadStream|open|access)\s*\([^)]*(?:req\.|params\.|query\.|body\.|input)/i,
    exclude: /path\.resolve|path\.join.*__dirname|sanitize/i,
  },
  {
    id: "xss-dangerous-html",
    severity: "high",
    description: "dangerouslySetInnerHTML — potential XSS",
    extensions: [".tsx", ".jsx", ".ts", ".js"],
    pattern: /dangerouslySetInnerHTML\s*=\s*\{\s*\{\s*__html\s*:/,
    exclude: /sanitize|DOMPurify|purify|escape/i,
  },
  {
    id: "eval-usage",
    severity: "high",
    description: "eval() usage — code injection risk",
    extensions: [".ts", ".tsx", ".js", ".jsx"],
    pattern: /\beval\s*\(/,
    exclude: /eslint|jshint|webpack|rollup|vite/i,
  },
  {
    id: "unsafe-regex",
    severity: "high",
    description: "User input passed directly to RegExp constructor",
    extensions: [".ts", ".tsx", ".js", ".jsx"],
    pattern: /new\s+RegExp\s*\(\s*(?:req\.|params\.|query\.|body\.|input|user)/i,
  },

  // === MEDIUM: Configuration & Auth Issues ===
  {
    id: "cors-wildcard",
    severity: "medium",
    description: "CORS allows all origins",
    extensions: [".ts", ".tsx", ".js", ".jsx"],
    pattern: /(?:cors|access-control-allow-origin)\s*[:(]\s*["'`]\*["'`]/i,
  },
  {
    id: "no-auth-check",
    severity: "medium",
    description: "API route without authentication check",
    extensions: [".ts", ".tsx", ".js", ".jsx"],
    pattern: /export\s+(?:async\s+)?function\s+(?:GET|POST|PUT|DELETE|PATCH)\s*\(/,
    exclude: /auth|session|token|middleware|getServerSession|getSession|requireAuth|protect/i,
  },
  {
    id: "http-not-https",
    severity: "medium",
    description: "HTTP URL in production code (should be HTTPS)",
    pattern: /["'`]http:\/\/(?!localhost|127\.0\.0\.1|0\.0\.0\.0|::1)/,
    exclude: /test|spec|mock|example|readme|comment|\.md$/i,
  },
  {
    id: "insecure-cookie",
    severity: "medium",
    description: "Cookie without secure/httpOnly flags",
    extensions: [".ts", ".tsx", ".js", ".jsx"],
    pattern: /(?:set-cookie|setCookie|cookie)\s*[=(].*(?:secure\s*:\s*false|httponly\s*:\s*false)/i,
  },
  {
    id: "missing-rate-limit",
    severity: "medium",
    description: "Public API endpoint without rate limiting",
    extensions: [".ts", ".tsx", ".js", ".jsx"],
    pattern: /export\s+(?:async\s+)?function\s+(?:GET|POST|PUT|DELETE|PATCH)\s*\(/,
    exclude: /rateLimit|rateLimiter|throttle|middleware.*limit/i,
  },
  {
    id: "unsafe-deserialize",
    severity: "medium",
    description: "Unsafe deserialization of user input",
    extensions: [".ts", ".tsx", ".js", ".jsx", ".py"],
    pattern: /JSON\.parse\s*\(\s*(?:req\.|params\.|body\.|input|user)|(?:pickle|yaml)\.(?:load|unsafe_load)\s*\(/i,
    exclude: /schema|validate|zod|yup|joi/i,
  },
  {
    id: "exposed-error-details",
    severity: "medium",
    description: "Stack trace or internal error exposed to client",
    extensions: [".ts", ".tsx", ".js", ".jsx"],
    pattern: /(?:res|response)\.(?:json|send|status)\s*\([^)]*(?:err\.stack|error\.stack|err\.message)/i,
    exclude: /development|dev|debug|NODE_ENV/i,
  },

  // === LOW: Code Quality / Information Disclosure ===
  {
    id: "console-log-sensitive",
    severity: "low",
    description: "console.log with potentially sensitive data",
    extensions: [".ts", ".tsx", ".js", ".jsx"],
    pattern: /console\.log\s*\([^)]*(?:password|secret\b|token|credential|cookie)\b/i,
    exclude: /test|spec|debug|\.test\.|\.spec\.|CLI|status|stored|memory|Keywords|symbols|Stored keys/i,
  },
  {
    id: "todo-security",
    severity: "low",
    description: "Security-related TODO/FIXME/HACK comment",
    pattern: /(?:TODO|FIXME|HACK|XXX)\s*:?\s*.*(?:security|auth|vuln|inject|xss|csrf|sanitize|escape)/i,
  },
  {
    id: "debug-mode",
    severity: "low",
    description: "Debug mode enabled in config",
    pattern: /(?:debug|verbose|DEBUG)\s*[:=]\s*(?:true|1|"true")/,
    exclude: /test|spec|\.test\.|\.spec\.|development|dev\.config/i,
  },
  {
    id: "weak-crypto",
    severity: "low",
    description: "Weak cryptographic algorithm (MD5/SHA1)",
    extensions: [".ts", ".tsx", ".js", ".jsx", ".py", ".go"],
    pattern: /(?:createHash|hashlib\.)\s*\(\s*["'`](?:md5|sha1)["'`]/i,
    exclude: /checksum|etag|cache|fingerprint/i,
  },
];

// === Env file checks (separate — check for committed .env files) ===

function checkEnvFiles(root: string): Finding[] {
  const findings: Finding[] = [];

  // Check if .env files exist and aren't gitignored
  const envPatterns = [".env", ".env.local", ".env.production", ".env.staging"];
  for (const envFile of envPatterns) {
    const envPath = join(root, envFile);
    if (existsSync(envPath)) {
      // Check if it's gitignored
      try {
        execSync(`git check-ignore -q "${envPath}"`, { cwd: root, stdio: "pipe" });
        // If no error, file IS ignored — safe
      } catch {
        // File is NOT ignored — could be committed
        try {
          const tracked = execSync(`git ls-files "${envFile}"`, { cwd: root, encoding: "utf-8" }).trim();
          if (tracked) {
            findings.push({
              severity: "critical",
              rule: "env-committed",
              file: envFile,
              line: 0,
              snippet: `${envFile} is tracked by git`,
              description: `.env file committed to repository — secrets may be in git history`,
            });
          }
        } catch {}
      }
    }
  }

  // Check if .gitignore includes .env
  try {
    const gitignore = readFileSync(join(root, ".gitignore"), "utf-8");
    if (!gitignore.includes(".env")) {
      findings.push({
        severity: "high",
        rule: "env-not-gitignored",
        file: ".gitignore",
        line: 0,
        snippet: ".env not found in .gitignore",
        description: ".env files are not in .gitignore — risk of committing secrets",
      });
    }
  } catch {
    // No .gitignore at all
    if (existsSync(join(root, ".env"))) {
      findings.push({
        severity: "high",
        rule: "no-gitignore",
        file: "(project root)",
        line: 0,
        snippet: "No .gitignore file",
        description: "No .gitignore found — .env files could be committed",
      });
    }
  }

  return findings;
}

// === Dependency audit ===

function checkDependencies(root: string): Finding[] {
  const findings: Finding[] = [];

  // npm audit
  if (existsSync(join(root, "package-lock.json"))) {
    try {
      const output = execSync("npm audit --json 2>/dev/null", {
        cwd: root,
        encoding: "utf-8",
        timeout: 30000,
      });
      try {
        const audit = JSON.parse(output);
        const vulns = audit.metadata?.vulnerabilities ?? {};
        const critical = vulns.critical ?? 0;
        const high = vulns.high ?? 0;
        const moderate = vulns.moderate ?? 0;

        if (critical > 0) {
          findings.push({
            severity: "critical",
            rule: "npm-audit-critical",
            file: "package-lock.json",
            line: 0,
            snippet: `${critical} critical vulnerabilit${critical === 1 ? "y" : "ies"}`,
            description: `npm audit found ${critical} critical vulnerability/ies in dependencies`,
          });
        }
        if (high > 0) {
          findings.push({
            severity: "high",
            rule: "npm-audit-high",
            file: "package-lock.json",
            line: 0,
            snippet: `${high} high-severity vulnerabilit${high === 1 ? "y" : "ies"}`,
            description: `npm audit found ${high} high-severity vulnerability/ies in dependencies`,
          });
        }
        if (moderate > 0) {
          findings.push({
            severity: "medium",
            rule: "npm-audit-moderate",
            file: "package-lock.json",
            line: 0,
            snippet: `${moderate} moderate vulnerabilit${moderate === 1 ? "y" : "ies"}`,
            description: `npm audit found ${moderate} moderate vulnerability/ies in dependencies`,
          });
        }
      } catch {}
    } catch (err: any) {
      // npm audit exits non-zero when vulnerabilities found
      try {
        const output = err.stdout || "";
        const audit = JSON.parse(output);
        const vulns = audit.metadata?.vulnerabilities ?? {};
        const total = (vulns.critical ?? 0) + (vulns.high ?? 0) + (vulns.moderate ?? 0);
        if (total > 0) {
          findings.push({
            severity: (vulns.critical ?? 0) > 0 ? "critical" : (vulns.high ?? 0) > 0 ? "high" : "medium",
            rule: "npm-audit",
            file: "package-lock.json",
            line: 0,
            snippet: `${total} vulnerabilit${total === 1 ? "y" : "ies"} (${vulns.critical ?? 0} critical, ${vulns.high ?? 0} high, ${vulns.moderate ?? 0} moderate)`,
            description: "npm audit found vulnerabilities in dependencies",
          });
        }
      } catch {}
    }
  }

  return findings;
}

// --- Scanner ---

function scanFile(filePath: string, relativePath: string, content: string): Finding[] {
  // Skip the security scanner itself — it contains patterns as data
  if (relativePath.endsWith("secure.ts") || relativePath.endsWith("secure.js")) return [];

  const ext = extname(filePath).toLowerCase();
  const findings: Finding[] = [];
  const lines = content.split("\n");

  for (const rule of RULES) {
    // Check extension filter
    if (rule.extensions && !rule.extensions.includes(ext)) continue;

    // Reset regex state
    rule.pattern.lastIndex = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Skip comments (basic heuristic)
      const trimmed = line.trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("#") || trimmed.startsWith("*")) {
        // Still check for security TODOs in comments
        if (rule.id !== "todo-security") continue;
      }

      if (rule.pattern.test(line)) {
        // Check exclusion
        if (rule.exclude && rule.exclude.test(line)) continue;
        // Also check surrounding context (2 lines before/after)
        if (rule.exclude) {
          const context = lines.slice(Math.max(0, i - 2), i + 3).join("\n");
          if (rule.exclude.test(context)) continue;
        }

        findings.push({
          severity: rule.severity,
          rule: rule.id,
          file: relativePath,
          line: i + 1,
          snippet: line.trim().slice(0, 120),
          description: rule.description,
        });
      }

      // Reset global regex for next line
      rule.pattern.lastIndex = 0;
    }
  }

  return findings;
}

// --- Public API ---

const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const SEVERITY_ICON: Record<Severity, string> = { critical: "!!!", high: " !!", medium: "  !", low: "  ." };

export async function secure(root: string, gate: boolean = false): Promise<void> {
  const start = performance.now();

  console.log(`\n  Security Audit${gate ? " (gate mode)" : ""}`);
  console.log("─".repeat(55));

  const files = walkFiles(root);
  const allFindings: Finding[] = [];

  // Scan source files
  for (const file of files) {
    try {
      const content = readFileSync(file.path, "utf-8");
      allFindings.push(...scanFile(file.path, file.relative, content));
    } catch {}
  }

  // Check env files
  allFindings.push(...checkEnvFiles(root));

  // Dependency audit (skip in gate mode for speed)
  if (!gate) {
    allFindings.push(...checkDependencies(root));
  }

  // Sort by severity
  allFindings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

  // Deduplicate (same rule + same file + same line)
  const seen = new Set<string>();
  const findings = allFindings.filter(f => {
    const key = `${f.rule}:${f.file}:${f.line}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const duration = Math.round(performance.now() - start);

  // Count by severity
  const counts: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of findings) counts[f.severity]++;

  // Summary line
  console.log(`  Files scanned: ${files.length}`);
  console.log(`  Rules checked: ${RULES.length + 3}`); // +3 for env/dep checks
  console.log(`  Duration: ${duration}ms\n`);

  if (findings.length === 0) {
    console.log("  ✓ No security issues found\n");
  } else {
    // Summary counts
    if (counts.critical) console.log(`  CRITICAL:  ${counts.critical}`);
    if (counts.high) console.log(`  HIGH:      ${counts.high}`);
    if (counts.medium) console.log(`  MEDIUM:    ${counts.medium}`);
    if (counts.low) console.log(`  LOW:       ${counts.low}`);
    console.log("");

    // Detail — show all in gate mode (usually few), show grouped in full mode
    if (gate) {
      // Gate mode: only show critical + high
      const blocking = findings.filter(f => f.severity === "critical" || f.severity === "high");
      if (blocking.length > 0) {
        for (const f of blocking) {
          console.log(`  ${SEVERITY_ICON[f.severity]} [${f.severity.toUpperCase()}] ${f.description}`);
          console.log(`     ${f.file}:${f.line}`);
          console.log(`     ${f.snippet}`);
          console.log("");
        }
      }
    } else {
      // Full mode: group by file
      const byFile = new Map<string, Finding[]>();
      for (const f of findings) {
        const arr = byFile.get(f.file) ?? [];
        arr.push(f);
        byFile.set(f.file, arr);
      }

      for (const [file, fileFindings] of byFile) {
        console.log(`  ${file}`);
        for (const f of fileFindings) {
          console.log(`    ${SEVERITY_ICON[f.severity]} L${f.line}: [${f.severity.toUpperCase()}] ${f.description}`);
          console.log(`       ${f.snippet}`);
        }
        console.log("");
      }
    }
  }

  console.log("─".repeat(55));
  console.log(`  Total: ${findings.length} finding(s) (${counts.critical} critical, ${counts.high} high, ${counts.medium} medium, ${counts.low} low)`);

  // Set exit code for gate mode
  if (gate && (counts.critical > 0 || counts.high > 0)) {
    process.exitCode = 1;
  }
}

/** Quick gate check for yolo — returns { pass, output } like runValidation */
export async function secureGate(root: string): Promise<{ pass: boolean; output: string; critical: number; high: number }> {
  const lines: string[] = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...args: any[]) => lines.push(args.map(String).join(" "));
  console.error = (...args: any[]) => lines.push(args.map(String).join(" "));

  const origExitCode = process.exitCode;
  try {
    await secure(root, true);
  } finally {
    console.log = origLog;
    console.error = origErr;
  }

  const output = lines.join("\n");
  const failed = process.exitCode === 1;
  process.exitCode = origExitCode;

  // Parse counts from output
  const critMatch = output.match(/CRITICAL:\s+(\d+)/);
  const highMatch = output.match(/HIGH:\s+(\d+)/);

  return {
    pass: !failed,
    output,
    critical: critMatch ? parseInt(critMatch[1], 10) : 0,
    high: highMatch ? parseInt(highMatch[1], 10) : 0,
  };
}
