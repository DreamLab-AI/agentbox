import { execSync } from "child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join, relative, extname } from "path";
import { readLazyFile, writeLazyFile, readLazyJson, writeLazyJson, ensureLazyDir } from "./store.js";

// --- .gitignore-aware ignore patterns ---

let _cachedIgnore: Set<string> | null = null;
let _cachedRoot: string | null = null;

function loadGitignorePatterns(root: string): string[] {
  try {
    const content = readFileSync(join(root, ".gitignore"), "utf-8");
    return content.split("\n")
      .map(l => l.trim())
      .filter(l => l && !l.startsWith("#"))
      .map(l => l.replace(/\/$/, ""))  // strip trailing slash
      .filter(l => !l.includes("*") && !l.startsWith("!"));  // only simple dir/file names for now
  } catch {
    return [];
  }
}

function getIgnoreDirs(root: string): Set<string> {
  if (_cachedRoot === root && _cachedIgnore) return _cachedIgnore;
  const base = new Set([
    "node_modules", ".git", ".lazy", "dist", "build", ".next",
    "__pycache__", ".venv", "venv", ".cache", "coverage",
  ]);
  for (const p of loadGitignorePatterns(root)) {
    base.add(p);
  }
  _cachedIgnore = base;
  _cachedRoot = root;
  return base;
}

// --- Symbol extraction patterns (lightweight repo-map) ---

interface Symbol {
  name: string;
  kind: "function" | "class" | "type" | "interface" | "const" | "method" | "export";
  file: string;
  line: number;
}

const SYMBOL_PATTERNS: Record<string, RegExp[]> = {
  ".ts": [
    /^export\s+(?:async\s+)?function\s+(\w+)/gm,
    /^export\s+class\s+(\w+)/gm,
    /^export\s+interface\s+(\w+)/gm,
    /^export\s+type\s+(\w+)/gm,
    /^export\s+const\s+(\w+)/gm,
    /^(?:async\s+)?function\s+(\w+)/gm,
    /^class\s+(\w+)/gm,
    /^interface\s+(\w+)/gm,
    /^type\s+(\w+)\s*=/gm,
  ],
  ".js": [
    /^export\s+(?:async\s+)?function\s+(\w+)/gm,
    /^export\s+class\s+(\w+)/gm,
    /^export\s+const\s+(\w+)/gm,
    /^(?:async\s+)?function\s+(\w+)/gm,
    /^class\s+(\w+)/gm,
    /module\.exports\s*=\s*\{([^}]+)\}/gm,
  ],
  ".py": [
    /^def\s+(\w+)/gm,
    /^class\s+(\w+)/gm,
    /^async\s+def\s+(\w+)/gm,
  ],
  ".rs": [
    /^pub\s+(?:async\s+)?fn\s+(\w+)/gm,
    /^pub\s+struct\s+(\w+)/gm,
    /^pub\s+enum\s+(\w+)/gm,
    /^pub\s+trait\s+(\w+)/gm,
  ],
  ".go": [
    /^func\s+(\w+)/gm,
    /^func\s+\([^)]+\)\s+(\w+)/gm,
    /^type\s+(\w+)\s+struct/gm,
    /^type\s+(\w+)\s+interface/gm,
  ],
  ".rb": [
    /^\s*def\s+(\w+)/gm,
    /^\s*class\s+(\w+)/gm,
    /^\s*module\s+(\w+)/gm,
  ],
};

function extractSymbols(filePath: string): Symbol[] {
  const ext = extname(filePath);
  const patterns = SYMBOL_PATTERNS[ext];
  if (!patterns) return [];

  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch {
    return [];
  }

  const symbols: Symbol[] = [];
  const lines = content.split("\n");

  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const beforeMatch = content.slice(0, match.index);
      const lineNum = beforeMatch.split("\n").length;
      const name = match[1];
      if (!name) continue;

      const kind = inferKind(match[0]);
      symbols.push({ name, kind, file: filePath, line: lineNum });
    }
  }

  return symbols;
}

function inferKind(matchStr: string): Symbol["kind"] {
  if (/function|fn|def/.test(matchStr)) return "function";
  if (/class/.test(matchStr)) return "class";
  if (/interface/.test(matchStr)) return "interface";
  if (/type|enum/.test(matchStr)) return "type";
  if (/const/.test(matchStr)) return "const";
  if (/export/.test(matchStr)) return "export";
  return "function";
}

function buildSymbolMap(root: string): Symbol[] {
  const allSymbols: Symbol[] = [];
  const ignoreDirs = getIgnoreDirs(root);

  function walk(dir: string): void {
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (ignoreDirs.has(entry.name) || entry.name.startsWith(".")) continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else {
          const ext = extname(entry.name);
          if (SYMBOL_PATTERNS[ext]) {
            allSymbols.push(...extractSymbols(full));
          }
        }
      }
    } catch {}
  }

  walk(root);
  return allSymbols;
}

// --- Context commands ---

export async function context(root: string, query?: string): Promise<void> {
  if (query) {
    await searchContext(root, query);
  } else {
    await showRepoMap(root);
  }

  // Silently regenerate .lazy/CONTEXT.md
  const origLog = console.log;
  console.log = () => {};
  try { await claudemd(root); } catch {}
  finally { console.log = origLog; }
}

export async function gather(root: string, task: string): Promise<void> {
  if (!task.trim()) {
    process.exitCode = 1;
    console.error("Usage: lazy gather <task description>");
    return;
  }

  console.log(`\n  Gathering context for: "${task}"`);
  console.log("─".repeat(55));

  const keywords = extractKeywords(task);
  console.log(`  Keywords: ${keywords.join(", ")}`);

  const files = new Set<string>();
  const relevantSymbols: Symbol[] = [];

  // 1. Search file names
  for (const kw of keywords) {
    findFilesByName(root, kw).forEach((f) => files.add(f));
  }

  // 2. Search file contents
  for (const kw of keywords) {
    grepFiles(root, kw).slice(0, 5).forEach((f) => files.add(f));
  }

  // 3. Search symbols
  const allSymbols = buildSymbolMap(root);
  for (const kw of keywords) {
    const kwLower = kw.toLowerCase();
    for (const sym of allSymbols) {
      if (sym.name.toLowerCase().includes(kwLower)) {
        relevantSymbols.push(sym);
        files.add(sym.file);
      }
    }
  }

  // Cache the symbol map
  ensureLazyDir(root);
  writeLazyJson(root, {
    built: new Date().toISOString(),
    symbolCount: allSymbols.length,
    symbols: allSymbols.map((s) => ({
      ...s,
      file: relative(root, s.file),
    })),
  }, "context", "symbols.json");

  if (files.size === 0) {
    console.log("  No relevant files found.");
    return;
  }

  // Show results
  const sorted = [...files].sort();
  console.log(`\n  Relevant files (${sorted.length}):`);
  for (const f of sorted.slice(0, 15)) {
    const rel = relative(root, f);
    const lines = countLines(f);
    console.log(`    ${rel} (${lines} lines)`);
  }

  if (relevantSymbols.length > 0) {
    console.log(`\n  Matching symbols (${relevantSymbols.length}):`);
    for (const s of relevantSymbols.slice(0, 15)) {
      console.log(`    ${s.kind} ${s.name} — ${relative(root, s.file)}:${s.line}`);
    }
  }

  // Output as @-mentions for Claude Code
  console.log("\n  For Claude Code:");
  console.log("─".repeat(55));
  for (const f of sorted.slice(0, 10)) {
    console.log(`  @${relative(root, f)}`);
  }
}

export async function watch(root: string): Promise<void> {
  // Log which files are being accessed — learns relevance over time
  const accessLog = readLazyJson<Record<string, number>>(root, {}, "context", "access.json");

  // Read git log to see what files are being changed recently
  try {
    const output = execSync(
      'git log --name-only --pretty=format: -20 2>/dev/null | sort | uniq -c | sort -rn | head -20',
      { cwd: root, encoding: "utf-8" }
    );

    console.log("\n  Most active files (recent git history):");
    console.log("─".repeat(55));

    const lines = output.trim().split("\n").filter(Boolean);
    for (const line of lines) {
      const match = line.trim().match(/^(\d+)\s+(.+)/);
      if (match) {
        const [, count, file] = match;
        accessLog[file] = (accessLog[file] ?? 0) + parseInt(count, 10);
        console.log(`    ${count.padStart(3)} changes  ${file}`);
      }
    }

    // Decay old entries — halve counts each time watch runs
    for (const key of Object.keys(accessLog)) {
      if (!lines.some(l => l.includes(key))) {
        accessLog[key] = Math.floor(accessLog[key] * 0.5);
        if (accessLog[key] === 0) delete accessLog[key];
      }
    }

    writeLazyJson(root, accessLog, "context", "access.json");
    console.log("\n  Access patterns saved to .lazy/context/access.json");
  } catch {
    console.log("  Could not read git history.");
  }
}

export async function claudemd(root: string): Promise<void> {
  console.log("\n  Generating CLAUDE.md context...");
  console.log("─".repeat(55));

  const sections: string[] = [];

  // 1. Project overview from symbols
  const allSymbols = buildSymbolMap(root);
  const stats = getRepoStats(root);

  sections.push("# Project Context (auto-generated by lazy fetch)");
  sections.push("");
  sections.push(`Languages: ${stats.languages.join(", ")}`);
  sections.push(`Files: ${stats.files} | Directories: ${stats.dirs} | Symbols: ${allSymbols.length}`);
  sections.push("");

  // 2. Key exports / API surface
  const exports = allSymbols.filter((s) => s.kind === "export" || s.kind === "function" || s.kind === "class");
  if (exports.length > 0) {
    sections.push("## Key Symbols");
    sections.push("");

    // Group by file
    const byFile = new Map<string, Symbol[]>();
    for (const s of exports) {
      const rel = relative(root, s.file);
      if (!byFile.has(rel)) byFile.set(rel, []);
      byFile.get(rel)!.push(s);
    }

    for (const [file, syms] of byFile) {
      sections.push(`### ${file}`);
      for (const s of syms.slice(0, 10)) {
        sections.push(`- \`${s.kind} ${s.name}\` (line ${s.line})`);
      }
      sections.push("");
    }
  }

  // 3. Active plan
  const plan = readLazyFile(root, "plan.md");
  if (plan) {
    sections.push("## Current Plan");
    sections.push("");
    sections.push(plan);
  }

  // 4. Memory
  const mem = readLazyJson<Record<string, { value: string }>>(root, {}, "memory.json");
  const memKeys = Object.keys(mem);
  if (memKeys.length > 0) {
    sections.push("## Persistent Knowledge");
    sections.push("");
    for (const k of memKeys) {
      sections.push(`- **${k}**: ${mem[k].value}`);
    }
    sections.push("");
  }

  // 5. Hot files from access patterns
  const accessLog = readLazyJson<Record<string, number>>(root, {}, "context", "access.json");
  const hotFiles = Object.entries(accessLog)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10);

  if (hotFiles.length > 0) {
    sections.push("## Frequently Changed Files");
    sections.push("");
    for (const [file, count] of hotFiles) {
      sections.push(`- ${file} (${count} recent changes)`);
    }
    sections.push("");
  }

  const content = sections.join("\n");

  // Write to .lazy/CONTEXT.md (not directly to CLAUDE.md — user decides)
  writeLazyFile(root, content, "CONTEXT.md");
  console.log("  Generated .lazy/CONTEXT.md");
  console.log(`  ${allSymbols.length} symbols indexed across ${stats.files} files`);
  console.log("");
  console.log("  To use with Claude Code, either:");
  console.log("    1. Copy sections you want into your CLAUDE.md");
  console.log("    2. Reference with: @.lazy/CONTEXT.md");
}

// --- Repo map display ---

async function showRepoMap(root: string): Promise<void> {
  const allSymbols = buildSymbolMap(root);
  const stats = getRepoStats(root);

  console.log("\n  Repo Map");
  console.log("─".repeat(55));

  const tree = buildTree(root, 3, root);
  printTree(tree, "  ");

  console.log("─".repeat(55));
  console.log(`  Files: ${stats.files} | Dirs: ${stats.dirs} | Symbols: ${allSymbols.length}`);
  console.log(`  Languages: ${stats.languages.join(", ")}`);

  // Show top-level symbols
  if (allSymbols.length > 0) {
    console.log("\n  Key symbols:");
    const grouped = new Map<string, Symbol[]>();
    for (const s of allSymbols) {
      const rel = relative(root, s.file);
      if (!grouped.has(rel)) grouped.set(rel, []);
      grouped.get(rel)!.push(s);
    }

    for (const [file, syms] of [...grouped.entries()].slice(0, 8)) {
      const names = syms.slice(0, 4).map((s) => s.name).join(", ");
      const more = syms.length > 4 ? ` +${syms.length - 4} more` : "";
      console.log(`    ${file}: ${names}${more}`);
    }
  }
}

async function searchContext(root: string, query: string): Promise<void> {
  console.log(`\n  Searching for: "${query}"`);
  console.log("─".repeat(55));

  const nameMatches = findFilesByName(root, query);
  if (nameMatches.length > 0) {
    console.log(`\n  Files matching "${query}":`);
    for (const f of nameMatches.slice(0, 10)) {
      console.log(`    ${relative(root, f)}`);
    }
  }

  const contentMatches = grepFiles(root, query);
  if (contentMatches.length > 0) {
    console.log(`\n  Content matching "${query}":`);
    for (const f of contentMatches.slice(0, 10)) {
      console.log(`    ${relative(root, f)}`);
    }
  }

  // Symbol search
  const allSymbols = buildSymbolMap(root);
  const q = query.toLowerCase();
  const symMatches = allSymbols.filter((s) => s.name.toLowerCase().includes(q));
  if (symMatches.length > 0) {
    console.log(`\n  Symbols matching "${query}":`);
    for (const s of symMatches.slice(0, 10)) {
      console.log(`    ${s.kind} ${s.name} — ${relative(root, s.file)}:${s.line}`);
    }
  }

  if (nameMatches.length === 0 && contentMatches.length === 0 && symMatches.length === 0) {
    console.log("  No matches found.");
  }
}

// --- Helpers ---

interface TreeNode {
  name: string;
  isDir: boolean;
  children: TreeNode[];
}

function buildTree(dir: string, maxDepth: number, root: string, depth = 0): TreeNode {
  const name = dir.split("/").pop() ?? dir;
  const node: TreeNode = { name, isDir: true, children: [] };
  if (depth >= maxDepth) return node;
  const ignoreDirs = getIgnoreDirs(root);

  try {
    const entries = readdirSync(dir, { withFileTypes: true })
      .filter((e: any) => !e.name.startsWith("."))
      .filter((e: any) => !ignoreDirs.has(e.name))
      .sort((a: any, b: any) => {
        if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        node.children.push(buildTree(fullPath, maxDepth, root, depth + 1));
      } else {
        node.children.push({ name: entry.name, isDir: false, children: [] });
      }
    }
  } catch {}

  return node;
}

function printTree(node: TreeNode, prefix: string, isLast = true): void {
  const connector = prefix.length > 2 ? (isLast ? "└── " : "├── ") : "";
  console.log(`${prefix}${connector}${node.isDir ? node.name + "/" : node.name}`);

  const childPrefix = prefix + (prefix.length > 2 ? (isLast ? "    " : "│   ") : "  ");
  node.children.forEach((child, i) => {
    printTree(child, childPrefix, i === node.children.length - 1);
  });
}

function findFilesByName(root: string, query: string): string[] {
  const results: string[] = [];
  const q = query.toLowerCase();
  const ignoreDirs = getIgnoreDirs(root);

  function walk(dir: string): void {
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (ignoreDirs.has(entry.name) || entry.name.startsWith(".")) continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.toLowerCase().includes(q)) results.push(full);
      }
    } catch {}
  }

  walk(root);
  return results;
}

function grepFiles(root: string, query: string): string[] {
  try {
    const escaped = query.replace(/"/g, '\\"').replace(/[$()|*+?{\\]/g, '\\$&');
    const ignoreDirs = getIgnoreDirs(root);
    const excludeArgs = [...ignoreDirs].map(d => `--exclude-dir='${d}'`).join(" ");
    const output = execSync(
      `grep -rl ${excludeArgs} --include='*.ts' --include='*.js' --include='*.py' --include='*.rs' --include='*.go' --include='*.rb' --include='*.md' -i "${escaped}" . 2>/dev/null || true`,
      { cwd: root, encoding: "utf-8", timeout: 5000 }
    );
    return output
      .split("\n")
      .filter(Boolean)
      .map((f) => join(root, f.replace(/^\.\//, "")));
  } catch {
    return [];
  }
}

function extractKeywords(task: string): string[] {
  const stopWords = new Set([
    "the", "a", "an", "is", "are", "was", "were", "be", "been",
    "being", "have", "has", "had", "do", "does", "did", "will",
    "would", "could", "should", "may", "might", "can", "shall",
    "to", "of", "in", "for", "on", "with", "at", "by", "from",
    "as", "into", "through", "during", "before", "after", "and",
    "but", "or", "not", "no", "add", "create", "implement", "build",
    "make", "fix", "update", "change", "modify", "use", "using",
  ]);

  // Split camelCase and snake_case before extracting
  const expanded = task
    .replace(/([a-z])([A-Z])/g, "$1 $2")  // camelCase → camel Case
    .replace(/_/g, " ")                     // snake_case → snake case
    .replace(/-/g, " ");                    // kebab-case → kebab case

  return expanded
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !stopWords.has(w));
}

function countLines(filePath: string): number {
  try {
    const content = readFileSync(filePath, "utf-8");
    return content.split("\n").length;
  } catch {
    return 0;
  }
}

function getRepoStats(root: string): { files: number; dirs: number; languages: string[] } {
  let files = 0;
  let dirs = 0;
  const exts = new Set<string>();
  const ignoreDirs = getIgnoreDirs(root);

  const extToLang: Record<string, string> = {
    ".ts": "TypeScript", ".js": "JavaScript", ".py": "Python",
    ".rs": "Rust", ".go": "Go", ".rb": "Ruby", ".java": "Java",
    ".md": "Markdown", ".json": "JSON", ".yaml": "YAML", ".yml": "YAML",
  };

  function walk(dir: string): void {
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (ignoreDirs.has(entry.name) || entry.name.startsWith(".")) continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) { dirs++; walk(full); }
        else {
          files++;
          const ext = extname(entry.name);
          if (ext && extToLang[ext]) exts.add(extToLang[ext]);
        }
      }
    } catch {}
  }

  walk(root);
  return { files, dirs, languages: [...exts].sort() };
}
