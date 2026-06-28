#!/usr/bin/env python3
"""
slop_scan.py - scan prose / markdown for AI writing tells (the text counterpart
to unslop-ui's devibe_scan.py).

Plain Python, standard library only. Detection patterns mirror Section B of the
prose-sanitiser SKILL.md (lexical, structural and spelling tells) plus the
file-level density checks (em-dash, transitions, Tier-2 cluster). Severity
follows the Tier-1/Tier-2 weighting in the skill, so the report tells you where
to spend effort. It catches the MECHANICAL tells only; narrative defaults
(Section C) and altitude/voice need a human read.

Usage:
    python3 slop_scan.py <path>                 # scan a dir or file
    python3 slop_scan.py <path> --severity high # only high-signal tells
    python3 slop_scan.py <path> --json          # machine-readable (for CI)
    python3 slop_scan.py <path> --max 8         # cap examples shown per rule

Respecting intentional choices: any line containing `slop-ignore` (e.g. an HTML
comment `<!-- slop-ignore -->`) is skipped, so a deliberate stylistic choice
does not nag the audit.

Exit code is the number of HIGH-severity findings (0 = none), so CI can gate on
it.
"""
import os, re, sys, json, argparse

EXTS = {".md", ".markdown", ".mdx", ".txt", ".rst", ".text"}
SKIP_DIRS = {"node_modules", ".git", "dist", "build", ".next", "out", "vendor",
             "coverage", ".svelte-kit", ".astro", ".turbo", ".cache",
             "__pycache__", "site-packages"}
W = {"high": 3, "medium": 2, "low": 1}
IGNORE_MARK = "slop-ignore"

# ---------------------------------------------------------------------------
# Per-line rules. Each: id, label, severity, fix, and patterns (case-insensitive
# unless the rule sets "cased": True). Keep patterns specific to avoid drowning
# the report in false positives.
# ---------------------------------------------------------------------------
RULES = [
    # ---- HIGH: Tier-1 vocabulary and the strongest structural tells ----
    {"id": "tier1-vocab", "label": "Tier-1 banned vocabulary", "sev": "high",
     "fix": "Replace with a plain word (delve->look at, leverage->use, robust->solid, seamless->smooth, utilise->use). See SKILL.md B4.",
     "pats": [r"\b(delve|leverage|leverages|leveraging|leveraged|robust|seamless|seamlessly"
              r"|comprehensive|cutting-edge|transformative|groundbreaking|innovative|holistic"
              r"|testament|tapestry|vibrant|utilize|utilise|utilizes|utilises|harness(?:es|ing|ed)?"
              r"|unlock(?:s|ing|ed)?|unleash(?:es|ing|ed)?|streamline(?:s|d)?|streamlining"
              r"|empower(?:s|ing|ed|ment)?|elevate(?:s|d)?|elevating|paradigm|unprecedented"
              r"|synergy|synergies|foster(?:s|ing|ed)?|underscore(?:s|d)?|underscoring"
              r"|game-changing|enterprise-scale|enterprise-grade|extraordinary)\b"]},
    {"id": "the-heading", "label": "\"The X\" heading", "sev": "high",
     "fix": "Drop the leading 'The' unless it is a proper noun (The Guardian). See SKILL.md B2.",
     "pats": [r"^#{1,6}\s+The\s+\S"], "cased": True},
    {"id": "negative-parallelism", "label": "Negative parallelism (not X - Y / not just X but Y)", "sev": "high",
     "fix": "Lead with the positive claim, or delete the negative half. See SKILL.md B3.",
     "pats": [r"\bnot\s+(just|only|merely|simply)\b[^.?!]{1,60}?(,?\s*but\b|\s+—)",
              r"\bit'?s\s+not\b[^.?!]{1,50}?—",
              r"\bisn'?t\s+(just\s+)?about\b[^.?!]{1,60}?\bit'?s\s+about\b",
              r"\bthis\s+isn'?t\b[^.?!]{1,50}?\bit'?s\b"]},
    {"id": "throat-clearing", "label": "Throat-clearing opener", "sev": "high",
     "fix": "Delete the warm-up. Lead with the value. See SKILL.md B6.",
     "pats": [r"\bin\s+today'?s\s+(rapidly\s+)?(evolving|changing|fast-paced)\b",
              r"\bin\s+the\s+world\s+of\b", r"\bhere'?s\s+the\s+thing\b",
              r"\blet\s+me\s+be\s+clear\b", r"\bit\s+turns\s+out\b",
              r"\blet'?s\s+(dive\s+in|explore|unpack)\b",
              r"\bit'?s\s+(worth|important)\s+(noting|to\s+note)\s+that\b",
              r"\bat\s+its\s+core\b", r"\bat\s+the\s+end\s+of\s+the\s+day\b",
              r"\bwhen\s+it\s+comes\s+to\b"]},
    {"id": "sycophantic-filler", "label": "Sycophantic filler", "sev": "high",
     "fix": "Delete entirely. See SKILL.md B7.",
     "pats": [r"\byou'?re\s+absolutely\s+right\b", r"\bgreat\s+question\b",
              r"\bthat'?s\s+a\s+(really\s+)?(interesting|great)\s+(point|question)\b",
              r"\b(certainly|absolutely)!\B", r"\bi'?d\s+be\s+happy\s+to\s+help\b"]},

    # ---- MEDIUM: hedge words, copula substitution, US spelling ----
    {"id": "hedge-words", "label": "Hedge word", "sev": "medium",
     "fix": "Cut it, or replace with a specific qualifier (\"in staging\", \"for payloads <10KB\"). See SKILL.md B8.",
     "pats": [r"\b(basically|actually|essentially|fundamentally|somewhat)\b"]},
    {"id": "copula-substitution", "label": "Copula substitution (serves as / marks the)", "sev": "medium",
     "fix": "Use 'is'. 'serves as a' -> 'is'; 'marks the' -> 'is'. See SKILL.md B9.",
     "pats": [r"\bserves?\s+as\s+a\b", r"\bmarks?\s+the\b", r"\bstands?\s+as\s+a\b",
              r"\bacts?\s+as\s+a\b", r"\brepresents?\s+a\s+(key|major|significant)\b"]},
    {"id": "us-spelling", "label": "US spelling (enforce UK)", "sev": "medium",
     "fix": "Use UK spelling: -ize->-ise, -or->-our, -er->-re, etc. See SKILL.md B12.",
     "pats": [r"\b(optimiz(e|es|ed|ing|ation)|organiz(e|es|ed|ing|ation)|recogniz(e|es|ed|ing)"
              r"|analyz(e|es|ed|ing)|categoriz(e|es|ed|ing|ation)|customiz(e|es|ed|ing|ation)"
              r"|prioritiz(e|es|ed|ing|ation)|emphasiz(e|es|ed|ing)|realiz(e|es|ed|ing)"
              r"|color|colors|behavior|behaviors|favor|favors|honor|honors|labor"
              r"|center|centers|fiber|fibers|liter|meter|theater"
              r"|defense|offense|license[ds]?|catalog|catalogs|fulfill(s|ed|ing)?"
              r"|traveler|traveled|traveling|canceled|canceling|modeling|modeled)\b"]},
    {"id": "passive-tell", "label": "Passive / agentless construction", "sev": "medium",
     "fix": "Make it active. 'can be seen that' -> 'this shows'; 'the decision was made to' -> 'we decided to'. See SKILL.md B11.",
     "pats": [r"\bit\s+can\s+be\s+seen\s+that\b", r"\bthe\s+decision\s+was\s+made\s+to\b",
              r"\bit\s+(should|must)\s+be\s+noted\b", r"\bit\s+is\s+recommended\s+that\b",
              r"\bis\s+designed\s+to\b"]},

    # ---- LOW: bold-label bullets, Tier-2 singletons (cluster handled below) ----
    {"id": "bold-label-bullet", "label": "Bold-label bullet (**Term:** prefix)", "sev": "low",
     "fix": "Reserve **Bold:** bullet prefixes for reference material; not every bullet needs one. See SKILL.md B9.",
     "pats": [r"^\s*[-*+]\s+\*\*[^*]{1,40}\*\*\s*:", r"^\s*[-*+]\s+\*\*[^*]{1,40}:\s*\*\*"], "cased": True},
]

# Tier-2 cluster words: not flagged singly, only when >=3 distinct appear in one file (B5).
TIER2 = ["crucial", "notable", "noteworthy", "remarkable", "fascinating", "profound",
         "compelling", "intriguing", "elegant", "meticulous", "intricate", "deliberate",
         "thoughtful", "sophisticated", "sprawling", "bustling", "evocative", "poignant",
         "cornerstone", "linchpin", "bedrock", "nexus", "interplay", "realm", "arena",
         "sphere", "endeavour", "myriad", "plethora"]
# Transition words for the per-page density check (B10).
TRANSITIONS = ["furthermore", "moreover", "additionally", "consequently", "notably",
               "crucially", "importantly", "ultimately", "fundamentally", "indeed",
               "significantly", "subsequently", "accordingly"]

EMDASH = "—"
WORDS_PER_PAGE = 500          # density window (B1, B10)
EMDASH_PER_WINDOW = 2         # B1 threshold
TRANS_PER_WINDOW = 2          # B10 threshold


def compile_rules(min_sev):
    order = ["high", "medium", "low"]
    floor = order.index(min_sev) if min_sev else len(order) - 1
    out = []
    for r in RULES:
        if order.index(r["sev"]) > floor:
            continue
        r = dict(r)
        flags = 0 if r.get("cased") else re.IGNORECASE
        r["rx"] = [re.compile(p, flags) for p in r["pats"]]
        out.append(r)
    return out


def iter_files(path):
    if os.path.isfile(path):
        yield path
        return
    for root, dirs, files in os.walk(path):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for f in files:
            if os.path.splitext(f)[1].lower() in EXTS:
                yield os.path.join(root, f)


def is_list_line(line):
    return re.match(r"^\s*([-*+]|\d+\.)\s+", line) is not None


def scan_file(fp, rules, min_sev):
    """Return (line_findings, aggregate_findings) for one file."""
    try:
        with open(fp, "r", encoding="utf-8", errors="ignore") as fh:
            lines = fh.readlines()
    except Exception:
        return [], []

    order = ["high", "medium", "low"]
    floor = order.index(min_sev) if min_sev else len(order) - 1

    findings = []
    in_fence = False
    word_count = 0
    emdash_total = 0
    emdash_list_lines = []
    trans_total = 0
    tier2_seen = {}

    trans_rx = re.compile(r"\b(" + "|".join(TRANSITIONS) + r")\b", re.IGNORECASE)
    tier2_rx = re.compile(r"\b(" + "|".join(TIER2) + r")\b", re.IGNORECASE)

    for i, raw in enumerate(lines, 1):
        line = raw.rstrip("\n")
        stripped = line.strip()

        # Toggle fenced code blocks; never scan code.
        if stripped.startswith("```") or stripped.startswith("~~~"):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        # Skip blockquotes (often other people's words) and explicit opt-out.
        if stripped.startswith(">") or IGNORE_MARK in line.lower():
            continue

        word_count += len(re.findall(r"\S+", stripped))

        # File-level accumulation.
        n_em = line.count(EMDASH)
        if n_em:
            emdash_total += n_em
            if is_list_line(line):
                emdash_list_lines.append((i, stripped[:160]))
        trans_total += len(trans_rx.findall(line))
        for m in tier2_rx.findall(line):
            tier2_seen.setdefault(m.lower(), i)

        # Per-line rules.
        for r in rules:
            for rx in r["rx"]:
                m = rx.search(line)
                if m:
                    findings.append({"rule": r["id"], "label": r["label"], "sev": r["sev"],
                                     "fix": r["fix"], "file": fp, "line": i,
                                     "snippet": stripped[:160]})
                    break

    # ---- Aggregate (file-level) findings ----
    agg = []
    windows = max(1, word_count / WORDS_PER_PAGE)

    def emit(sev, label, fix, line, snippet):
        if order.index(sev) <= floor:
            agg.append({"rule": "agg", "label": label, "sev": sev, "fix": fix,
                        "file": fp, "line": line, "snippet": snippet})

    if emdash_total > EMDASH_PER_WINDOW * windows:
        emit("high", "Em-dash density over threshold",
             f"Max {EMDASH_PER_WINDOW} per {WORDS_PER_PAGE} words. Replace with comma / full stop / colon. See SKILL.md B1.",
             0, f"{emdash_total} em-dashes across ~{int(word_count)} words "
                f"(budget {int(EMDASH_PER_WINDOW * windows)})")
    for ln, snip in emdash_list_lines:
        emit("medium", "Em-dash inside a list item",
             "Zero em-dashes in lists. Recast the bullet. See SKILL.md B1.", ln, snip)
    if trans_total > TRANS_PER_WINDOW * windows:
        emit("medium", "Transition-word overuse",
             f"Max {TRANS_PER_WINDOW} per {WORDS_PER_PAGE} words (furthermore, moreover, ...). See SKILL.md B10.",
             0, f"{trans_total} transition words across ~{int(word_count)} words")
    if len(tier2_seen) >= 3:
        words = ", ".join(sorted(tier2_seen))
        first_line = min(tier2_seen.values())
        emit("low", "Tier-2 cluster words (3+ distinct in file)",
             "Vary the register; these read as AI when stacked. See SKILL.md B5.",
             first_line, words)

    return findings, agg


def verdict(by_sev, weighted):
    if by_sev.get("high", 0) >= 5 or weighted >= 20:
        return "STRONG AI writing fingerprint"
    if by_sev.get("high", 0) >= 1 or weighted >= 6:
        return "Some AI tells present"
    if weighted > 0:
        return "Mostly clean, minor tells"
    return "Clean, no mechanical tells detected"


def main():
    ap = argparse.ArgumentParser(description="Scan prose/markdown for AI writing tells.")
    ap.add_argument("path")
    ap.add_argument("--severity", choices=["high", "medium", "low"], default="low",
                    help="minimum severity to report (default: low = everything)")
    ap.add_argument("--json", action="store_true", help="machine-readable output")
    ap.add_argument("--max", type=int, default=10, help="max examples shown per rule (text mode)")
    args = ap.parse_args()

    if not os.path.exists(args.path):
        print(f"path not found: {args.path}", file=sys.stderr)
        sys.exit(2)

    rules = compile_rules(args.severity)
    findings = []
    files_scanned = 0
    for fp in iter_files(args.path):
        files_scanned += 1
        line_f, agg_f = scan_file(fp, rules, args.severity)
        findings.extend(line_f)
        findings.extend(agg_f)

    by_sev, by_rule = {}, {}
    for f in findings:
        by_sev[f["sev"]] = by_sev.get(f["sev"], 0) + 1
        by_rule.setdefault(f["rule"] + "|" + f["label"], []).append(f)
    weighted = sum(W[s] * n for s, n in by_sev.items())

    if args.json:
        print(json.dumps({"path": args.path, "files_scanned": files_scanned,
                          "counts": by_sev, "slop_score": weighted,
                          "verdict": verdict(by_sev, weighted), "findings": findings}, indent=2))
        sys.exit(by_sev.get("high", 0))

    sev_order = {"high": 0, "medium": 1, "low": 2}
    keys = sorted(by_rule, key=lambda k: (sev_order[by_rule[k][0]["sev"]], -len(by_rule[k])))
    print(f"\n  prose-sanitiser slop scan: {args.path}")
    print(f"  files scanned: {files_scanned}   findings: {len(findings)}   slop score: {weighted}")
    print(f"  verdict: {verdict(by_sev, weighted)}")
    print(f"  high: {by_sev.get('high',0)}   medium: {by_sev.get('medium',0)}   low: {by_sev.get('low',0)}\n")
    if not findings:
        print("  Nothing flagged. Either it is clean or the tells are narrative/voice ones a"
              "\n  regex cannot see. Read it against Section C of SKILL.md.\n")
        return
    for k in keys:
        items = by_rule[k]
        f0 = items[0]
        print(f"  [{f0['sev'].upper()}] {f0['label']}  ({len(items)} hit{'s' if len(items)!=1 else ''})")
        print(f"        fix: {f0['fix']}")
        for it in items[:args.max]:
            loc = f"{it['file']}:{it['line']}" if it["line"] else it["file"]
            print(f"        {loc}  {it['snippet']}")
        if len(items) > args.max:
            print(f"        ... +{len(items) - args.max} more")
        print()
    top = [by_rule[k][0]["label"] for k in keys[:3]]
    print("  Top things to change: " + "; ".join(top))
    print("  Narrative and voice tells need eyes too. See Section C of SKILL.md.\n")
    sys.exit(by_sev.get("high", 0))


if __name__ == "__main__":
    main()
