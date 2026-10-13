'use strict';
// Shared helpers for the ontomark migration tests (EXP-10, WP-D).
//
// This file is NOT a test: its name matches neither Jest's `testMatch`
// (`*.test.js`, `*.contract.spec.js`) nor `node --test` discovery of
// `*.test.js`, so nothing runs it directly. The five `ontomark-<resp>-migration`
// tests share one identical copy.
//
// House rules these helpers exist to enforce:
//   * Parse, do not grep. JS/MJS via @babel/parser, Cargo manifests via
//     tomllib, package.json/flake.lock via JSON.parse, Rust, Nix and shell via
//     small lexers that drop comments before anything is matched.
//   * A comment, an unused constant or an unreachable helper is not adoption.
//   * Identity, not spelling: removal checks name the defining construct (a
//     regex shape, a literal, a property read), not the identifier it happens
//     to be called today.
//   * A missing tool or an unparsable file fails an ASSERTION with a tagged
//     message (MISSING-TOOL / PARSE-ERROR), never an uncaught throw that could
//     be mistaken for a clean red.

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel) => {
  try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch { return ''; }
};
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

/** Directories whose non-test sources count as "the repository's code". */
const SRC_ROOTS = [
  'management-api/lib', 'management-api/routes', 'management-api/adapters', 'management-api/hooks',
  'management-api/utils', 'management-api/middleware', 'management-api/observability',
  'mcp/servers', 'skills', 'scripts', 'config/hooks',
];
const SKIP_DIRS = new Set(['node_modules', '.git', 'tests', '__tests__', 'test', 'docs', 'target', 'fixtures']);
const isTestFile = (n) => /\.(test|spec|node-test)\.[cm]?js$/.test(n) || /ontomark-migration-lib\.js$/.test(n);

/** Every non-test file under `roots` whose extension is in `exts` (repo-relative, sorted). */
function sourceFiles(roots, exts) {
  const out = [];
  const visit = (rel) => {
    let entries;
    try { entries = fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isSymbolicLink()) continue;
      const r = path.posix.join(rel, e.name);
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) visit(r); continue; }
      if (exts.includes(path.extname(e.name)) && !isTestFile(e.name)) out.push(r);
    }
  };
  for (const r of roots) visit(r);
  return out.sort();
}
const jsSources = () => sourceFiles(SRC_ROOTS, ['.js', '.mjs', '.cjs']);
/** The corpus-facing JS: where parse, slug, IRI and page-writing logic lives (or would move to). */
const ontologyScope = () => jsSources().filter((f) => f.startsWith('management-api/lib/')
  || f.startsWith('skills/podcast-knowledge-ingest/') || f.startsWith('skills/ontology-augment/')
  || /^mcp\/servers\/lib\/(ontology-|typed-spawn)/.test(f));

// ---------------------------------------------------------------- JS / AST

let babelParser = null;
function babel() {
  if (babelParser) return babelParser;
  try {
    babelParser = require(require.resolve('@babel/parser', { paths: [path.join(ROOT, 'management-api')] }));
  } catch (e) {
    assert.fail('MISSING-TOOL: @babel/parser is not resolvable from management-api/node_modules (' + e.message + ')');
  }
  return babelParser;
}

const astCache = new Map();
/** Parse one JS/MJS/CJS file; null when it does not exist. */
function parseJs(rel) {
  if (astCache.has(rel)) return astCache.get(rel);
  if (!exists(rel)) { astCache.set(rel, null); return null; }
  let ast;
  try {
    ast = babel().parse(read(rel), {
      sourceType: 'unambiguous', allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true,
      allowImportExportEverywhere: true, errorRecovery: false,
    });
  } catch (e) {
    assert.fail(`PARSE-ERROR: ${rel} does not parse as JavaScript: ${e.message}`);
  }
  astCache.set(rel, ast);
  return ast;
}

const SKIP_KEYS = new Set(['loc', 'start', 'end', 'extra', 'leadingComments', 'trailingComments', 'innerComments', 'comments', 'tokens', 'errors']);
/** Depth-first walk; `fn(node, parent, ancestors)` returning false prunes. */
function walk(node, fn, parent = null, ancestors = []) {
  if (!node || typeof node.type !== 'string') return;
  if (fn(node, parent, ancestors) === false) return;
  const next = ancestors.concat(node);
  for (const k of Object.keys(node)) {
    if (SKIP_KEYS.has(k)) continue;
    const v = node[k];
    if (Array.isArray(v)) { for (const c of v) if (c && typeof c.type === 'string') walk(c, fn, node, next); }
    else if (v && typeof v.type === 'string') walk(v, fn, node, next);
  }
}
const lineOf = (n) => (n && n.loc ? n.loc.start.line : 0);

/** Every string, template chunk and regex literal in code (comments are not AST). */
function literals(ast) {
  const out = [];
  walk(ast.program || ast, (n) => {
    if (n.type === 'StringLiteral') out.push({ kind: 'string', value: n.value, line: lineOf(n), node: n });
    else if (n.type === 'TemplateElement') out.push({ kind: 'template', value: n.value.cooked == null ? n.value.raw : n.value.cooked, line: lineOf(n), node: n });
    else if (n.type === 'RegExpLiteral') out.push({ kind: 'regex', value: n.pattern, flags: n.flags, line: lineOf(n), node: n });
  });
  return out;
}

const memberName = (n) => {
  if (!n) return null;
  if (n.type === 'Identifier') return n.name;
  if (n.type === 'StringLiteral') return n.value;
  if (n.type === 'TemplateLiteral' && n.expressions.length === 0 && n.quasis.length === 1) return n.quasis[0].value.cooked;
  return null;
};
/** Property names READ off an object: `.x`, `['x']`, `?.x`, destructuring keys. */
function propertyReads(ast) {
  const out = [];
  walk(ast.program || ast, (n) => {
    if (n.type === 'MemberExpression' || n.type === 'OptionalMemberExpression') {
      const name = n.computed ? memberName(n.property) : (n.property.type === 'Identifier' ? n.property.name : null);
      if (name != null) out.push({ name, line: lineOf(n) });
    } else if (n.type === 'ObjectPattern') {
      for (const p of n.properties) {
        if (p.type !== 'ObjectProperty') continue;
        const name = p.computed ? memberName(p.key) : (p.key.type === 'Identifier' ? p.key.name : memberName(p.key));
        if (name != null) out.push({ name, line: lineOf(p) });
      }
    }
  });
  return out;
}

/** Source text of an expression node, rebuilt from identifiers and literals (no comments). */
function exprWords(node) {
  const words = [];
  walk(node, (n) => {
    if (n.type === 'Identifier') words.push(n.name);
    else if (n.type === 'StringLiteral') words.push(n.value);
    else if (n.type === 'TemplateElement') words.push(n.value.cooked || '');
  });
  return words.join(' ');
}

const EXEC_FAMILY = new Set(['execFile', 'execFileSync', 'execFileAsync', 'spawn', 'spawnSync', 'exec', 'execSync', 'fork']);
const calleeName = (callee) => {
  if (!callee) return null;
  if (callee.type === 'Identifier') return callee.name;
  if (callee.type === 'MemberExpression' || callee.type === 'OptionalMemberExpression') {
    return callee.computed ? memberName(callee.property) : (callee.property.type === 'Identifier' ? callee.property.name : null);
  }
  return null;
};

/** Names referenced (not declared, not plain keys) more than their declaration. */
function referenceCounts(ast) {
  const counts = new Map();
  walk(ast.program || ast, (n, parent) => {
    if (n.type !== 'Identifier') return;
    if (parent && (parent.type === 'ObjectProperty' || parent.type === 'ObjectMethod') && parent.key === n && !parent.computed && !parent.shorthand) return;
    if (parent && (parent.type === 'MemberExpression' || parent.type === 'OptionalMemberExpression') && parent.property === n && !parent.computed) return;
    counts.set(n.name, (counts.get(n.name) || 0) + 1);
  });
  return counts;
}

function enclosingFunctionName(ancestors) {
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const a = ancestors[i];
    if (a.type === 'FunctionDeclaration' && a.id) return a.id.name;
    if ((a.type === 'FunctionExpression' || a.type === 'ArrowFunctionExpression')) {
      const p = ancestors[i - 1];
      if (p && p.type === 'VariableDeclarator' && p.id.type === 'Identifier') return p.id.name;
      if (p && p.type === 'AssignmentExpression' && p.left.type === 'MemberExpression') return memberName(p.left.property);
      return null; // anonymous callback: lives where it is passed
    }
    if ((a.type === 'ObjectMethod' || a.type === 'ClassMethod') && !a.computed) return memberName(a.key);
  }
  return null;
}

/** Variable name -> ArrayExpression initialiser, for `const args = ['verb', ...]`. */
function arrayBindings(ast) {
  const m = new Map();
  walk(ast.program || ast, (n) => {
    if (n.type === 'VariableDeclarator' && n.id.type === 'Identifier' && n.init && n.init.type === 'ArrayExpression') m.set(n.id.name, n.init);
  });
  return m;
}

/** The verb of an argv array: first string element, skipping a leading `--repo <x>` pair. */
function argvVerb(arr) {
  const el = arr.elements;
  let i = 0;
  if (el[0] && el[0].type === 'StringLiteral' && el[0].value === '--repo') i = 2;
  const v = el[i];
  return v && v.type === 'StringLiteral' ? v.value : null;
}

/**
 * Every place a command-line tool is invoked with a literal-verb argv, with
 * the binary it is routed to: 'ontomark', 'vault' or 'unknown'. A call site
 * inside a function nobody references is dead and is not returned.
 *
 * Handles `runner(['find', ...])`, `execFile(BIN, ['find', ...])`,
 * `runner(argsVar)` with `const argsVar = ['propose', ...]`, and
 * `{ bin: <expr>, argv: ['propose', ...] }`.
 */
function toolInvocations(rel) {
  const ast = parseJs(rel);
  if (!ast) return [];
  const bindings = arrayBindings(ast);
  const refs = referenceCounts(ast);
  const classify = (text) => {
    if (/ontomark/i.test(text)) return 'ontomark';
    if (/vault/i.test(text)) return 'vault';
    return 'unknown';
  };
  const out = [];
  const live = (ancestors) => {
    const name = enclosingFunctionName(ancestors);
    return name == null || (refs.get(name) || 0) > 1;
  };
  walk(ast.program, (n, parent, ancestors) => {
    if (n.type === 'CallExpression' || n.type === 'OptionalCallExpression') {
      const name = calleeName(n.callee);
      const exec = EXEC_FAMILY.has(name);
      n.arguments.forEach((arg, idx) => {
        let arr = null;
        if (arg.type === 'ArrayExpression') arr = arg;
        else if (arg.type === 'Identifier' && bindings.has(arg.name)) arr = bindings.get(arg.name);
        else if (arg.type === 'SpreadElement') return;
        if (!arr) return;
        const verb = argvVerb(arr);
        if (!verb) return;
        let route;
        if (exec) route = idx > 0 ? classify(exprWords(n.arguments[0])) : 'unknown';
        else {
          // a runner called as run(ontomarkBin(), [...]) is routed by that argument too
          const others = n.arguments.filter((_, j) => j !== idx && n.arguments[j].type !== 'ArrayExpression').map(exprWords).join(' ');
          route = classify(`${name || ''} ${others}`);
        }
        if (!live(ancestors)) return;
        out.push({ verb, route, line: lineOf(n), via: name });
      });
    } else if (n.type === 'ObjectExpression') {
      const props = new Map();
      for (const p of n.properties) if (p.type === 'ObjectProperty' && !p.computed) props.set(memberName(p.key), p);
      if (props.has('bin') && props.has('argv')) {
        const a = props.get('argv').value;
        const arr = a.type === 'ArrayExpression' ? a : (a.type === 'Identifier' ? bindings.get(a.name) : null);
        const verb = arr && argvVerb(arr);
        if (verb && live(ancestors)) out.push({ verb, route: classify(exprWords(props.get('bin').value)), line: lineOf(n), via: 'bin/argv' });
      }
    }
  });
  return out;
}

/** The §2.1 routing table. The adapter owns the governance verbs, ontomark owns the rest (D4). */
const ADAPTER_VERBS = new Set(['propose', 'apply', 'panel']);
const ONTOMARK_VERBS = new Set(['validate', 'build', 'gate', 'conflicts', 'repair', 'find', 'retrieve', 'tree', 'edit', 'create', 'slug']);
/** `vault query find`, `vault report validate` style group words. */
const GROUP_WORDS = new Set(['query', 'report']);

/** Violations of the routing table among the invocations in one JS file. */
function routingViolations(rel) {
  const bad = [];
  for (const inv of toolInvocations(rel)) {
    if (ONTOMARK_VERBS.has(inv.verb) && inv.route !== 'ontomark') bad.push(`${rel}:${inv.line} \`${inv.verb}\` goes to ${inv.route} (via ${inv.via}); ontomark owns it`);
    if (ADAPTER_VERBS.has(inv.verb) && inv.route !== 'vault') bad.push(`${rel}:${inv.line} \`${inv.verb}\` goes to ${inv.route} (via ${inv.via}); the vault adapter owns it (D4)`);
  }
  return bad;
}

/** True when `rel` really invokes ontomark with one of `verbs` from live code. */
function invokesOntomark(rel, verbs = ONTOMARK_VERBS) {
  return toolInvocations(rel).some((i) => i.route === 'ontomark' && verbs.has(i.verb));
}

/** `require`/`import` specifiers of a file. */
function moduleSpecifiers(rel) {
  const ast = parseJs(rel);
  if (!ast) return [];
  const out = [];
  walk(ast.program, (n) => {
    if (n.type === 'CallExpression' && n.callee.type === 'Identifier' && n.callee.name === 'require' && n.arguments[0] && n.arguments[0].type === 'StringLiteral') out.push({ spec: n.arguments[0].value, line: lineOf(n) });
    else if (n.type === 'ImportDeclaration' || ((n.type === 'ExportNamedDeclaration' || n.type === 'ExportAllDeclaration') && n.source)) out.push({ spec: n.source.value, line: lineOf(n) });
    else if (n.type === 'Import' || n.type === 'ImportExpression') out.push({ spec: '<dynamic>', line: lineOf(n) });
  });
  return out;
}

/** Names bound from `require('<spec>')` / `import {…} from '<spec>'` matching `specRe`, per file. */
function importedNames(rel, specRe) {
  const ast = parseJs(rel);
  const names = [];
  if (!ast) return names;
  walk(ast.program, (n) => {
    if (n.type === 'VariableDeclarator' && n.init && n.init.type === 'CallExpression' && n.init.callee.name === 'require'
      && n.init.arguments[0] && n.init.arguments[0].type === 'StringLiteral' && specRe.test(n.init.arguments[0].value)) {
      if (n.id.type === 'ObjectPattern') for (const p of n.id.properties) if (p.type === 'ObjectProperty') names.push(memberName(p.key));
    } else if (n.type === 'ImportDeclaration' && specRe.test(n.source.value)) {
      for (const s of n.specifiers) names.push(s.imported ? memberName(s.imported) : s.local.name);
    }
  });
  return names;
}

// ---------------------------------------------------------------- construct detectors (identity, not spelling)

/** Callee names whose string argument is a recognition/lookup test, not construction. */
const TEST_CALLEES = new Set(['startsWith', 'endsWith', 'includes', 'indexOf', 'lastIndexOf', 'split', 'match', 'test', 'search']);
const isTestArg = (parent, node) => parent && parent.type === 'CallExpression' && parent.arguments.includes(node) && TEST_CALLEES.has(calleeName(parent.callee));
const isCompare = (parent) => parent && parent.type === 'BinaryExpression' && ['==', '===', '!=', '!=='].includes(parent.operator);
const regexSourcesOf = (n) => {
  if (n.type === 'RegExpLiteral') return [n.pattern];
  if (n.type === 'NewExpression' && n.callee.type === 'Identifier' && n.callee.name === 'RegExp' && n.arguments[0] && n.arguments[0].type === 'StringLiteral') return [n.arguments[0].value];
  return [];
};

/** Sites that PARSE a frontmatter fence or read the `status:` line by pattern. */
function frontmatterParseSites(ast) {
  const hits = [];
  walk(ast.program, (n, parent) => {
    for (const src of regexSourcesOf(n)) {
      if (/(^|\^|\\n|\\r\?\\n)\s*-{3}/.test(src) && src !== '^--- ' && !/^\^?--- /.test(src)) hits.push({ line: lineOf(n), what: `pattern /${src}/ matches a frontmatter fence` });
      if (/\^status:/.test(src)) hits.push({ line: lineOf(n), what: `pattern /${src}/ reads the status line` });
    }
    if (n.type === 'StringLiteral' && (n.value === '---' || /^---\r?\n/.test(n.value)) && (isTestArg(parent, n) || isCompare(parent))) hits.push({ line: lineOf(n), what: `'---' compared or searched for as a fence` });
  });
  return hits;
}

/** Sites that BUILD a frontmatter page line by line. */
function frontmatterBuildSites(ast) {
  const hits = [];
  const starters = /^(type: Class|title: |resource: |status: draft|public: false|domain: |generated:|aliases:|sources:)/;
  walk(ast.program, (n, parent) => {
    if (n.type === 'StringLiteral' && n.value === '---' && parent && (parent.type === 'ArrayExpression' || (parent.type === 'CallExpression' && !isTestArg(parent, n)))) hits.push({ line: lineOf(n), what: "'---' emitted as a fence line" });
    if ((n.type === 'StringLiteral' || n.type === 'TemplateElement')) {
      const v = n.type === 'StringLiteral' ? n.value : (n.value.cooked || '');
      if (/^---\r?\n/.test(v) && !isTestArg(parent, n)) hits.push({ line: lineOf(n), what: 'string starts with a fence' });
      if (starters.test(v) && parent && parent.type !== 'ObjectProperty') hits.push({ line: lineOf(n), what: `frontmatter line \`${v.slice(0, 18)}\` assembled in code` });
    }
  });
  return hits;
}

/** Sites that mint (or hold the namespace of) a `urn:ngm:class:` IRI. A startsWith/includes test is recognition, not minting. */
function iriMintSites(ast) {
  const hits = [];
  const frag = /urn:ngm:class|ngm:class|^:?class:$|^urn:ngm:?$/;
  walk(ast.program, (n, parent) => {
    if (n.type === 'StringLiteral' || n.type === 'TemplateElement') {
      const v = n.type === 'StringLiteral' ? n.value : (n.value.cooked || '');
      const holder = n.type === 'TemplateElement' ? null : parent;
      if (frag.test(v) && !isTestArg(holder, n)) hits.push({ line: lineOf(n), what: `namespace text \`${v.slice(0, 24)}\`` });
    }
  });
  return hits;
}

/** The slug rule: collapse non-alphanumerics to `-` (replace/split-join) and trim hyphens. */
function slugRuleSites(ast) {
  const hits = [];
  const nonAlnum = /\[\^[^\]]*(a-z|\\w)|\\W/;
  const hasNonAlnum = (node) => { let f = false; walk(node, (m) => { for (const src of regexSourcesOf(m)) if (nonAlnum.test(src)) f = true; if (m.type === 'StringLiteral' && nonAlnum.test(m.value)) f = true; }); return f; };
  walk(ast.program, (n) => {
    if (n.type !== 'CallExpression') return;
    const name = calleeName(n.callee);
    if ((name === 'replace' || name === 'replaceAll') && n.arguments.length >= 2) {
      const [pat, rep] = n.arguments;
      const srcs = regexSourcesOf(pat).concat(pat.type === 'StringLiteral' ? [pat.value] : []);
      if (rep.type === 'StringLiteral' && rep.value === '-' && srcs.some((s) => nonAlnum.test(s))) hits.push({ line: lineOf(n), what: 'collapses non-alphanumerics to `-`' });
      if (rep.type === 'StringLiteral' && rep.value === '' && srcs.some((s) => /^\^-\+?\|-\+?\$$|^\^-\|-\$$/.test(s))) hits.push({ line: lineOf(n), what: 'trims leading/trailing `-`' });
    }
    if (name === 'join' && n.arguments[0] && n.arguments[0].type === 'StringLiteral' && n.arguments[0].value === '-' && hasNonAlnum(n.callee)) hits.push({ line: lineOf(n), what: 'split on non-alphanumerics then join with `-`' });
  });
  return hits;
}

/** The ```json-ld fence that the legacy class index parses. */
function jsonldFenceSites(ast) {
  const hits = [];
  walk(ast.program, (n) => {
    const vals = regexSourcesOf(n);
    if (n.type === 'StringLiteral') vals.push(n.value);
    if (n.type === 'TemplateElement') vals.push(n.value.cooked || '');
    for (const v of vals) if (/json-?ld/i.test(v) && /`{3}|\\u0060|\\x60/.test(v)) hits.push({ line: lineOf(n), what: 'json-ld fence pattern' });
  });
  return hits;
}

/**
 * Reads of the relation keys named in `names` off any object (`.x`, `['x']`,
 * destructuring) and bare string uses of them that are not an object key being
 * written (so `{ is_subclass_of: parents }` output is allowed, `v['is-a']` is not).
 */
function relationKeyReads(ast, names, { strings = true } = {}) {
  const hits = propertyReads(ast).filter((r) => names.includes(r.name)).map((r) => ({ line: r.line, what: `reads \`${r.name}\`` }));
  if (strings) walk(ast.program, (n, parent) => {
    if (n.type === 'StringLiteral' && names.includes(n.value) && !(parent && parent.type === 'ObjectProperty' && parent.key === n)
      && !(parent && (parent.type === 'MemberExpression' || parent.type === 'OptionalMemberExpression') && parent.property === n)) {
      hits.push({ line: lineOf(n), what: `string \`${n.value}\` used as a lookup key` });
    }
  });
  return hits;
}

// ---------------------------------------------------------------- Rust

/**
 * A small Rust lexer: returns `code` with comments (nested block comments
 * included) blanked and string/char literals replaced by `""`/`''`, plus the
 * literal contents in `strings`.
 */
function lexRust(src) {
  let code = '';
  const strings = [];
  const n = src.length;
  let i = 0;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') {
      let depth = 1; i += 2;
      while (i < n && depth > 0) {
        if (src[i] === '/' && src[i + 1] === '*') { depth++; i += 2; }
        else if (src[i] === '*' && src[i + 1] === '/') { depth--; i += 2; }
        else { if (src[i] === '\n') code += '\n'; i++; }
      }
      code += ' ';
      continue;
    }
    // raw strings: r"..", r#".."#, br#".."#
    const raw = /^(b?r)(#*)"/.exec(src.slice(i, i + 12));
    if (raw && (i === 0 || !/[A-Za-z0-9_]/.test(src[i - 1]))) {
      const close = '"' + raw[2];
      const start = i + raw[0].length;
      const end = src.indexOf(close, start);
      const stop = end === -1 ? n : end;
      strings.push(src.slice(start, stop));
      code += '""';
      for (const ch of src.slice(i, stop + close.length)) if (ch === '\n') code += '\n';
      i = stop + close.length;
      continue;
    }
    if (c === '"' || (c === 'b' && d === '"' && (i === 0 || !/[A-Za-z0-9_]/.test(src[i - 1])))) {
      i += c === 'b' ? 2 : 1;
      let s = '';
      while (i < n && src[i] !== '"') {
        if (src[i] === '\\') { s += src[i + 1] === '\n' ? '' : src[i] + src[i + 1]; if (src[i + 1] === '\n') code += '\n'; i += 2; continue; }
        if (src[i] === '\n') code += '\n';
        s += src[i]; i++;
      }
      i++;
      strings.push(s);
      code += '""';
      continue;
    }
    if (c === '\'') {
      // char literal 'x' / '\n' / '\u{..}' versus a lifetime 'a
      const m = /^'(\\(?:u\{[0-9a-fA-F_]+\}|x[0-9a-fA-F]{2}|.)|[^\\'\n])'/.exec(src.slice(i, i + 14));
      if (m) { strings.push(m[1]); code += "''"; i += m[0].length; continue; }
    }
    code += c;
    i++;
  }
  return { code, strings };
}

/** Remove `#[cfg(test)]` items (a `mod tests { ... }` block or a single item) from lexed code. */
function stripCfgTest(code) {
  let out = '';
  let i = 0;
  const re = /#\[\s*cfg\s*\(\s*test\s*\)\s*\]/g;
  let m;
  while ((m = re.exec(code)) !== null) {
    out += code.slice(i, m.index);
    let j = m.index + m[0].length;
    // skip further attributes
    for (;;) {
      const a = /^\s*#\[[^\]]*\]/.exec(code.slice(j));
      if (!a) break;
      j += a[0].length;
    }
    const brace = code.indexOf('{', j);
    const semi = code.indexOf(';', j);
    if (brace === -1 || (semi !== -1 && semi < brace)) { i = semi === -1 ? code.length : semi + 1; }
    else {
      let depth = 0;
      let k = brace;
      for (; k < code.length; k++) {
        if (code[k] === '{') depth++;
        else if (code[k] === '}') { depth--; if (depth === 0) { k++; break; } }
      }
      i = k;
    }
    re.lastIndex = i;
  }
  return out + code.slice(i);
}

/** The body (between braces) of `fn <name>` in lexed code, or null. */
function rustFnBody(code, name) {
  const m = new RegExp(`\\bfn\\s+${name}\\b`).exec(code);
  if (!m) return null;
  const open = code.indexOf('{', m.index);
  if (open === -1) return null;
  let depth = 0;
  for (let k = open; k < code.length; k++) {
    if (code[k] === '{') depth++;
    else if (code[k] === '}') { depth--; if (depth === 0) return code.slice(open + 1, k); }
  }
  return null;
}

/** Lex a Rust file into non-test code and strings; empty when the file is absent. */
function rustFile(rel) {
  const src = read(rel);
  if (!src) return { code: '', strings: [], exists: false };
  const lexed = lexRust(src);
  return { code: stripCfgTest(lexed.code), strings: lexed.strings, exists: true };
}

/** Does lexed non-test code actually USE crate `ontomark_parse` (a path in an expression, not just an import)? */
function usesCrate(code, crate) {
  const usesOutsideUse = code.split(';').filter((stmt) => !/^\s*(pub\s+)?use\b/.test(stmt) && !/^\s*extern\s+crate\b/.test(stmt)).join(';');
  if (new RegExp(`(^|[^A-Za-z0-9_])${crate}\\s*::\\s*[A-Za-z_]`).test(usesOutsideUse)) return true;
  // `use ontomark_parse::x::name;` / `use ontomark_parse::{a, b as c};` then `name(`
  const names = [];
  for (const m of code.matchAll(new RegExp(`\\buse\\s+${crate}\\s*::\\s*([^;]+);`, 'g'))) {
    for (const part of m[1].replace(/[{}]/g, ',').split(',')) {
      const seg = part.trim().split('::').pop().trim();
      const alias = /\bas\s+([A-Za-z_][A-Za-z0-9_]*)$/.exec(seg);
      const nm = alias ? alias[1] : seg;
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(nm) && nm !== 'self' && nm !== '_') names.push(nm);
    }
  }
  return names.some((nm) => new RegExp(`(^|[^A-Za-z0-9_:.])${nm}\\s*(::|\\(|!)`).test(usesOutsideUse.replace(new RegExp(`\\bfn\\s+${nm}\\b`, 'g'), '')));
}

// ---------------------------------------------------------------- TOML (Cargo)

/** Parse a TOML file with python3 tomllib; assertion failure (not a throw) when the tool is missing. */
function toml(rel) {
  if (!exists(rel)) return null;
  const script = 'import sys,json,tomllib\nprint(json.dumps(tomllib.load(open(sys.argv[1],"rb"))))';
  const r = cp.spawnSync('python3', ['-I', '-c', script, path.join(ROOT, rel)], { encoding: 'utf8' });
  if (r.error) assert.fail(`MISSING-TOOL: python3 is required to parse ${rel}: ${r.error.message}`);
  if (r.status !== 0) assert.fail(`PARSE-ERROR: ${rel} is not valid TOML: ${(r.stderr || '').trim().split('\n').pop()}`);
  return JSON.parse(r.stdout);
}

/**
 * Normal (non-dev, non-build) dependency entries of a parsed Cargo manifest,
 * `[dependencies]` and `[target.*.dependencies]` only, with `package = "x"`
 * renames resolved. `[package.metadata.*]`, comments and dev/build deps never count.
 */
function cargoNormalDeps(manifest) {
  const out = [];
  const take = (table) => {
    for (const [key, spec] of Object.entries(table || {})) {
      const s = typeof spec === 'string' ? { version: spec } : (spec || {});
      out.push({ key, crate: s.package || key, spec: s });
    }
  };
  take(manifest.dependencies);
  for (const t of Object.values(manifest.target || {})) take(t && t.dependencies);
  return out;
}

/** A dependency that really pulls the crate from a registry: version set, not `*`, not optional, no path/git. */
function realRegistryDep(dep) {
  const s = dep.spec;
  return typeof s.version === 'string' && s.version.trim() !== '' && s.version.trim() !== '*'
    && s.optional !== true && s.path === undefined && s.git === undefined;
}

// ---------------------------------------------------------------- shell

/** Remove shell comments with quote awareness; `: <<'EOF'` heredocs (a classic comment block) are blanked too. */
function stripShell(text) {
  const lines = text.split('\n');
  const out = [];
  let heredoc = null; // { tag, blank }
  for (const line of lines) {
    if (heredoc) {
      if (line.trim() === heredoc.tag || (heredoc.dash && line.replace(/^\t+/, '') === heredoc.tag)) heredoc = null;
      out.push(heredoc && heredoc.blank ? '' : (heredoc ? line : ''));
      continue;
    }
    let s = '';
    let q = null;
    let cut = false;
    for (let i = 0; i < line.length && !cut; i++) {
      const c = line[i];
      if (q) {
        s += c;
        if (c === '\\' && q === '"') { s += line[i + 1] || ''; i++; continue; }
        if (c === q) q = null;
        continue;
      }
      if (c === '\\') { s += c + (line[i + 1] || ''); i++; continue; }
      if (c === '"' || c === '\'') { q = c; s += c; continue; }
      if (c === '#') {
        const prev = i === 0 ? ' ' : line[i - 1];
        if (/[\s;|&()]/.test(prev) || i === 0) { cut = true; continue; }
      }
      s += c;
    }
    const h = /(^|[\s;])(:|true)\s+<<(-?)\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\4/.exec(s);
    const any = /<<(-?)\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\2/.exec(s);
    if (h) heredoc = { tag: h[5], blank: true, dash: h[3] === '-' };
    else if (any && !/<<</.test(s)) heredoc = { tag: any[3], blank: false, dash: any[1] === '-' };
    out.push(s);
  }
  return out.join('\n');
}

/** Shell command words: quotes removed so `run_vault "query"` reads like `run_vault query`. */
const unquoteShell = (s) => s.replace(/["']/g, '');

/**
 * Functions defined in a (comment-stripped) shell script: name -> body text.
 * Brace matching is line based, which is how this repository formats them.
 */
function shellFunctions(text) {
  const fns = new Map();
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*(?:function\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*\(\)\s*\{?\s*$/.exec(lines[i]) || /^\s*function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{?\s*$/.exec(lines[i]);
    if (!m) continue;
    let depth = 0;
    let body = '';
    let started = false;
    for (let j = i; j < lines.length; j++) {
      const l = j === i ? lines[j].replace(/^[^{]*/, '') : lines[j];
      for (const ch of l) { if (ch === '{') { depth++; started = true; } else if (ch === '}') depth--; }
      if (j !== i) body += lines[j] + '\n';
      if (started && depth <= 0) { i = j; break; }
    }
    fns.set(m[1], body);
  }
  return fns;
}

// ---------------------------------------------------------------- Nix

/**
 * Lex Nix: drops `#` and block comments, keeps strings. `''...''` bodies are
 * passed through `indentedTransform` (used to strip shell comments inside).
 * Returns { code, strings }: `code` has every string replaced by `"S<n>"`
 * (so structural matching cannot be fooled by text inside a string) and
 * `strings[n]` is the string body (interpolations kept verbatim).
 */
function lexNix(src, indentedTransform = (s) => s) {
  const strings = [];
  let i = 0;
  const n = src.length;
  function code(untilBrace) {
    let out = '';
    let depth = 0;
    while (i < n) {
      const c = src[i];
      const d = src[i + 1];
      if (c === '#') { while (i < n && src[i] !== '\n') i++; continue; }
      if (c === '/' && d === '*') { const e = src.indexOf('*/', i + 2); const stop = e === -1 ? n : e + 2; for (const ch of src.slice(i, stop)) if (ch === '\n') out += '\n'; i = stop; out += ' '; continue; }
      if (c === '"') { out += str(); continue; }
      if (c === '\'' && d === '\'') { out += indented(); continue; }
      if (untilBrace) {
        if (c === '{') depth++;
        else if (c === '}') { if (depth === 0) return out; depth--; }
      }
      out += c;
      i++;
    }
    return out;
  }
  function str() {
    i++; // opening quote
    let body = '';
    while (i < n && src[i] !== '"') {
      if (src[i] === '\\') { body += src[i] + (src[i + 1] || ''); i += 2; continue; }
      if (src[i] === '$' && src[i + 1] === '{') { i += 2; const inner = code(true); body += '${' + inner + '}'; i++; continue; }
      body += src[i]; i++;
    }
    i++;
    strings.push(body);
    return `"S${strings.length - 1}"`;
  }
  function indented() {
    i += 2;
    let body = '';
    while (i < n) {
      if (src[i] === '\'' && src[i + 1] === '\'') {
        const t = src[i + 2];
        if (t === '\'') { body += '\'\''; i += 3; continue; }
        if (t === '$') { body += '$'; i += 3; continue; }
        if (t === '\\') { body += src[i + 3] || ''; i += 4; continue; }
        i += 2;
        break;
      }
      if (src[i] === '$' && src[i + 1] === '{') { i += 2; const inner = code(true); body += '${' + inner + '}'; i++; continue; }
      body += src[i]; i++;
    }
    strings.push(indentedTransform(body));
    return `"S${strings.length - 1}"`;
  }
  return { code: code(false), strings };
}

// ---------------------------------------------------------------- manifests

/** JSON.parse a repo file; assertion failure when it is missing or not JSON. */
function json(rel) {
  const t = read(rel);
  if (!t) assert.fail(`${rel} does not exist`);
  try { return JSON.parse(t); } catch (e) { assert.fail(`PARSE-ERROR: ${rel} is not JSON: ${e.message}`); }
  return null;
}

/**
 * The finding-9 gate: the migration test must be in the command CI runs. CI
 * runs `npm test` in management-api (`jest && npm run test:node`); Jest's
 * roots exclude `tests/`, so the file belongs in `test:node` (`node --test`).
 */
function wiredIntoTestNode(testFileBase) {
  const pkg = json('management-api/package.json');
  const script = (pkg.scripts || {})['test:node'] || '';
  const want = path.join(ROOT, 'management-api', 'tests', testFileBase);
  return script.split(/\s+/).filter(Boolean).some((tok) => path.resolve(ROOT, 'management-api', tok) === want);
}

// ---------------------------------------------------------------- stub binaries (behavioural tests)

/**
 * Put stub `ontomark` and `vault` executables first on PATH. Each logs its
 * argv as one JSON line and answers every verb with `answers[verb]` (stdout
 * JSON text), defaulting to `null`. Environment overrides that could bypass
 * PATH resolution (`ONTOMARK_BIN`, `VAULT_BIN`) are cleared so the DEFAULT
 * binary names are what is exercised. Everything is restored by `t.after`.
 */
function stubTools(t, { answers = {}, repoFiles = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ontomark-route-'));
  const repo = path.join(dir, 'repo');
  fs.mkdirSync(path.join(repo, 'ontology'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'knowledge', 'pages'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'ontology', 'vocabulary.yaml'), 'version: 1\n');
  fs.writeFileSync(path.join(repo, 'vault.toml'), '[vault]\nname = "t"\n');
  for (const [rel, body] of Object.entries(repoFiles)) {
    fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
    fs.writeFileSync(path.join(repo, rel), body);
  }
  const answersFile = path.join(dir, 'answers.json');
  fs.writeFileSync(answersFile, JSON.stringify(answers));
  const logs = {};
  for (const name of ['ontomark', 'vault']) {
    logs[name] = path.join(dir, `${name}.log`);
    fs.writeFileSync(path.join(dir, name), `#!/usr/bin/env node
const fs = require('fs');
const argv = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(logs[name])}, JSON.stringify(argv) + '\\n');
if (argv.includes('--version')) { process.stdout.write('${name} 0.0.0-stub\\n'); process.exit(0); }
const i = argv[0] === '--repo' ? 2 : 0;
const verb = argv[i];
const answers = JSON.parse(fs.readFileSync(${JSON.stringify(answersFile)}, 'utf8'));
process.stdout.write(JSON.stringify(Object.prototype.hasOwnProperty.call(answers, verb) ? answers[verb] : null));
`, { mode: 0o755 });
  }
  const saved = { PATH: process.env.PATH, ONTOMARK_BIN: process.env.ONTOMARK_BIN, VAULT_BIN: process.env.VAULT_BIN, VAULT_REPO: process.env.VAULT_REPO };
  process.env.PATH = `${dir}${path.delimiter}${saved.PATH}`;
  process.env.VAULT_REPO = repo;
  delete process.env.ONTOMARK_BIN;
  delete process.env.VAULT_BIN;
  t.after(() => {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const calls = (name) => (fs.existsSync(logs[name]) ? fs.readFileSync(logs[name], 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  /** The verb of each logged call (skipping a leading `--repo <x>`). */
  const verbs = (name) => calls(name).map((a) => (a[0] === '--repo' ? a[2] : a[0]));
  return { dir, repo, calls, verbs };
}


// ---------------------------------------------------------------- flake (Nix + lock)

const SEMVER_TAG = /^v\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/;
const REV40 = /^[0-9a-f]{40}$/;
const LEGACY_VAULT_REV = '3213e314f82491f338660c79b77332da6610ed9c';

/** Lex flake.nix (comments gone, shell comments inside `''` bodies gone) and read its structure. */
function flake() {
  const raw = read('flake.nix');
  const { code, strings } = lexNix(raw, stripShell);
  const str = (tok) => { const m = /^"S(\d+)"$/.exec(String(tok).trim()); return m ? strings[Number(m[1])] : null; };
  const inputs = new Map();
  const addInput = (name, url) => {
    const u = str(url);
    const m = u && /^github:([^/]+)\/([^/]+)\/(.+)$/.exec(u);
    if (m) inputs.set(name, { owner: m[1], repo: m[2], ref: m[3], url: u });
  };
  for (const m of code.matchAll(/([A-Za-z_][\w'-]*)\s*=\s*\{([^{}]*)\}\s*;/g)) {
    const u = /\burl\s*=\s*("S\d+")\s*;/.exec(m[2]);
    if (u) addInput(m[1], u[1]);
  }
  for (const m of code.matchAll(/\binputs\.([A-Za-z_][\w'-]*)\.url\s*=\s*("S\d+")\s*;/g)) addInput(m[1], m[2]);
  const outputs = /\boutputs\s*=\s*\{([^}]*)\}\s*:/.exec(code);
  const outputsArgs = new Set(outputs ? outputs[1].split(',').map((x) => x.trim().replace(/\s.*$/, '')).filter(Boolean) : []);
  const imports = [];
  for (const m of code.matchAll(/([A-Za-z_][\w'-]*)\s*=\s*import\s+(\.\/[\w./-]+\.nix)\s*\{([^{}]*)\}/g)) {
    const src = /\bsrc\s*=\s*([A-Za-z_][\w'-]*)\s*;/.exec(m[3]);
    imports.push({ binding: m[1], file: m[2].replace(/^\.\//, ''), src: src ? src[1] : null });
  }
  /** `ln -s ${pkg}/bin/<x> $out/opt/agentbox/bin/<y>` lines found in the real (indented) strings. */
  const links = [];
  for (const body of strings) {
    for (const m of body.matchAll(/\bln\s+-s[fn]*\s+\$\{([A-Za-z_][\w'-]*)\}\/bin\/([\w-]+)\s+\$out\/opt\/agentbox\/bin\/([\w-]+)/g)) links.push({ binding: m[1], from: m[2], to: m[3] });
  }
  /** Is `binding` part of an image package list (`++ X` where X is a list holding it)? */
  const inClosure = (binding) => {
    const holders = new Set([binding]);
    for (const m of code.matchAll(/([A-Za-z_][\w'-]*)\s*=\s*[^;]*\[[^\]]*\b([A-Za-z_][\w'-]*)\b[^\]]*\]\s*;/g)) if (m[0].includes(binding)) holders.add(m[1]);
    return [...holders].some((h) => new RegExp(`\\+\\+\\s*${h.replace(/[-']/g, '\\$&')}(?![\\w'-])`).test(code));
  };
  return { raw, code, strings, inputs, outputsArgs, imports, links, inClosure };
}

/**
 * Everything wrong with the ontomark pin in flake.nix + flake.lock; [] when sound.
 * Name-agnostic: the ontomark input is whichever input is `github:<owner>/ontomark/<tag>`.
 */
function ontomarkPinProblems() {
  const f = flake();
  const problems = [];
  const found = [...f.inputs.entries()].filter(([, v]) => v.repo === 'ontomark');
  if (found.length !== 1) return [`flake.nix must declare exactly one github:<owner>/ontomark/<tag> input (found ${found.length})`];
  const [name, input] = found[0];
  if (!SEMVER_TAG.test(input.ref)) problems.push(`ontomark input ref \`${input.ref}\` is not a release tag v<semver>[-pre]`);
  if (!f.outputsArgs.has(name)) problems.push(`\`${name}\` is not a formal argument of \`outputs\`, so nothing can use it`);
  if (!f.imports.some((i) => i.src === name)) problems.push(`no \`import ./lib/*.nix { src = ${name}; }\`: the pinned input is never built`);
  const lock = json('flake.lock');
  const rootInputs = (lock.nodes && lock.nodes.root && lock.nodes.root.inputs) || {};
  const nodeName = rootInputs[name];
  const node = typeof nodeName === 'string' ? lock.nodes[nodeName] : null;
  if (!node) { problems.push(`flake.lock root has no resolved node for input \`${name}\``); return problems; }
  const l = node.locked || {};
  const o = node.original || {};
  if (l.type !== 'github' || l.repo !== 'ontomark' || l.owner !== input.owner) problems.push(`flake.lock node for \`${name}\` is not locked to github:${input.owner}/ontomark`);
  if (!REV40.test(l.rev || '')) problems.push('flake.lock locked.rev is not a 40-hex commit');
  if (!/^sha256-[A-Za-z0-9+/]{43}=$/.test(l.narHash || '')) problems.push('flake.lock locked.narHash is not a sha256 SRI hash');
  if (o.ref !== input.ref) problems.push(`flake.lock original.ref (${o.ref}) differs from the flake.nix tag (${input.ref})`);
  return problems;
}

// ---------------------------------------------------------------- boot gate (shell)

/**
 * Which binaries the Phase 5d(ii) liveness gate probes with `--version` from a
 * condition, in a gate that is not dead (`if false`, `: <<EOF`, comments).
 */
function bootGateProbes(rel = 'config/entrypoint-unified.sh') {
  const lines = stripShell(read(rel)).split('\n');
  const start = lines.findIndex((l) => /^\s*if\b.*AGENTBOX_VAULT_ENABLED/.test(l));
  if (start === -1) return { found: false, probed: new Set(), dead: false };
  let depth = 0;
  const region = [];
  for (let i = start; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*if\b/.test(l)) depth++;
    region.push(l);
    if (/^\s*fi\b/.test(l)) { depth--; if (depth === 0) break; }
  }
  const text = region.join('\n');
  const vars = new Map();
  for (const m of text.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)=["']?(\/opt\/agentbox\/bin\/([\w-]+))["']?/g)) vars.set(m[1], m[3]);
  const probed = new Set();
  for (const l of region) {
    if (!/--version/.test(l) || !/\b(if|elif)\b|&&|\|\|/.test(l)) continue;
    for (const m of l.matchAll(/["']?\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?["']?\s+--version/g)) if (vars.has(m[1])) probed.add(vars.get(m[1]));
    for (const m of l.matchAll(/\/opt\/agentbox\/bin\/([\w-]+)["']?\s+--version/g)) probed.add(m[1]);
  }
  const dead = /^\s*if\s+(false|:)\b|\[\s*0\s*(=|-eq)\s*1\s*\]/m.test(text);
  return { found: true, probed, dead };
}

/**
 * Shell callers of vault/ontomark in a script: for every function that reaches
 * the vault (or ontomark) binary, the verbs it is invoked with.
 */
function shellRouting(rel) {
  const text = stripShell(read(rel));
  const fns = shellFunctions(text);
  const reaches = (re) => {
    const set = new Set([...fns].filter(([, body]) => re.test(unquoteShell(body))).map(([n]) => n));
    let grew = true;
    while (grew) {
      grew = false;
      for (const [n, body] of fns) {
        if (set.has(n)) continue;
        if ([...set].some((m) => new RegExp(`(^|[\\s;(|&$])${m}(\\s|$)`).test(unquoteShell(body)))) { set.add(n); grew = true; }
      }
    }
    return set;
  };
  const vaultFns = reaches(/command -v vault|\/opt\/agentbox\/bin\/vault|\$\{?VAULT_BIN\}?/);
  const ontoFns = reaches(/command -v ontomark|\/opt\/agentbox\/bin\/ontomark|\$\{?ONTOMARK_BIN\}?/);
  for (const n of [...vaultFns]) if (ontoFns.has(n)) vaultFns.delete(n);
  const flat = unquoteShell(text);
  const verbs = (names) => {
    const out = [];
    for (const name of names) {
      const re = new RegExp(`(^|[\\s;(|&$\`])${name}\\s+(?:(?:query|report)\\s+)?([a-z][a-z-]*)`, 'g');
      for (const m of flat.matchAll(re)) out.push({ name, verb: m[2], line: flat.slice(0, m.index).split('\n').length });
    }
    return out;
  };
  return { vaultFns, ontoFns, vaultCalls: verbs(vaultFns), ontoCalls: verbs(ontoFns) };
}

// ---------------------------------------------------------------- behavioural scenarios

const NPUB = 'npub1testhuman';
const AT = '2026-09-22T12:00:00.000Z';

/**
 * Drive the real apply path (`applyOntologyDecision`, default runner) through a
 * promote of a draft page, a create proposal and an amend proposal against two
 * stub binaries, and report which stub saw which argv. No runner is injected:
 * this exercises whatever the module resolves by default.
 */
async function applyScenarios(t) {
  const apply = require(path.join(ROOT, 'management-api', 'lib', 'ontology-apply'));
  const IRI = 'urn:ngm:class:knowledge-graph';
  const PAGE = 'Knowledge Graph';
  const NEW_IRI = 'urn:ngm:class:photon-sieve';
  const NEW_PAGE = 'Photon Sieve';
  const HEX = 'ef'.repeat(32);
  const md = `---\ntype: Class\nresource: ${NEW_IRI}\npublic: false\nstatus: draft\n---\nA diffractive optic.\n`;
  const diff = ['--- /dev/null', `+++ b/${NEW_PAGE}`, `@@ -0,0 +1,${md.split('\n').length - 1} @@`, ...md.replace(/\n$/, '').split('\n').map((l) => `+${l}`), ''].join('\n');
  const stub = stubTools(t, {
    answers: {
      find: [{ id: PAGE, title: PAGE, type: 'Class', score: 1 }],
      edit: { ok: true, docs: 1, blocks: 2 },
      create: { created: true },
      apply: { applied: true, page: PAGE, path: `knowledge/pages/${PAGE}.md`, digest: 'sha256:00' },
    },
    repoFiles: { [`knowledge/pages/${PAGE}.md`]: `---\ntype: Class\nresource: ${IRI}\nstatus: draft\n---\nbody\n` },
  });
  const fetchFn = async () => ({ ok: true, status: 200 });
  const scenarios = {};
  const run = async (name, decision) => {
    const before = { ontomark: stub.calls('ontomark').length, vault: stub.calls('vault').length };
    let error = null;
    try { await apply.applyOntologyDecision(decision, { fetchFn }); } catch (e) { error = e; }
    scenarios[name] = {
      error,
      ontomark: stub.calls('ontomark').slice(before.ontomark),
      vault: stub.calls('vault').slice(before.vault),
    };
  };
  await run('promote', { outcome: 'promote', iri: IRI, signerNpub: NPUB, at: AT, caseId: 'case-a', digest: 'sha256:abc' });
  await run('create', {
    outcome: 'promote', iri: NEW_IRI, signerNpub: NPUB, at: AT, caseId: HEX, digest: HEX,
    proposal: { kind: 'create', level: 'content', iri: NEW_IRI, page: NEW_PAGE, diff, digest: `sha256:${HEX}`, blockers: [] },
  });
  await run('amend', {
    outcome: 'promote', iri: IRI, signerNpub: NPUB, at: AT, caseId: HEX, digest: HEX, eventId: 'f'.repeat(64),
    proposal: { level: 'content', kind: 'amend', iri: IRI, page: PAGE, hypothesis: 'tighten the definition', diff: `--- a/${PAGE}\n+++ b/${PAGE}\n@@ -1 +1 @@\n-x\n+y\n`, digest: `sha256:${HEX}`, blockers: [], pages: [PAGE] },
  });
  return scenarios;
}

/** Verb of an argv, skipping a leading `--repo <x>`. */
const argvVerbOf = (argv) => (argv[0] === '--repo' ? argv[2] : argv[0]);
/** Argv entries following `flag`. */
const flagValue = (argv, flag) => { const i = argv.indexOf(flag); return i === -1 ? null : argv[i + 1]; };

/** Run `gateElevation` for one candidate against the two stubs. */
async function elevationScenario(t) {
  const stage = require(path.join(ROOT, 'management-api', 'lib', 'elevation-stage'));
  const { extractProposals } = require(path.join(ROOT, 'management-api', 'lib', 'kg-proposal-extractor'));
  const OWNER = 'a'.repeat(64);
  const env = { AGENTBOX_DID: 'did:nostr:test', AGENTBOX_X_ONLY_PUBKEY_HEX: OWNER };
  const stub = stubTools(t, {
    answers: { validate: { knowledge: { issues: [] } }, propose: { proposal: { level: 'content', blockers: [] }, event: { kind: 31402 } } },
  });
  const { proposals } = await Promise.resolve(extractProposals([{ key: 'k1', value: {
    preferred_term: 'Photon Sieve',
    definition: 'A diffractive optic that focuses light through a pattern of pinholes rather than zones.',
    domain: 'robotics', physicality: 'physical', role: 'component', working_page: 'Photon sieve notes',
  } }], { ownerPubkey: OWNER, env, minScore: 0 }));
  let error = null;
  try { await stage.gateElevation(proposals[0], { env, repo: stub.repo }); } catch (e) { error = e; }
  return { error, ontomark: stub.calls('ontomark'), vault: stub.calls('vault') };
}

module.exports = {
  ROOT, read, exists, SRC_ROOTS, sourceFiles, jsSources, ontologyScope,
  parseJs, walk, literals, propertyReads, exprWords, toolInvocations, routingViolations, invokesOntomark,
  moduleSpecifiers, importedNames, memberName, lineOf,
  ADAPTER_VERBS, ONTOMARK_VERBS, GROUP_WORDS,
  lexRust, stripCfgTest, rustFnBody, rustFile, usesCrate,
  toml, cargoNormalDeps, realRegistryDep,
  stripShell, unquoteShell, shellFunctions, lexNix,
  json, wiredIntoTestNode, stubTools,
  frontmatterParseSites, frontmatterBuildSites, iriMintSites, slugRuleSites, jsonldFenceSites, relationKeyReads,
  SEMVER_TAG, REV40, LEGACY_VAULT_REV, flake, ontomarkPinProblems, bootGateProbes, shellRouting,
  NPUB, AT, applyScenarios, elevationScenario, argvVerbOf, flagValue,
};
