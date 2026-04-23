#!/usr/bin/env python3
"""
Report Builder — Preflight Check
Validates all prerequisites, API keys, skills, and MCP tools.
"""

import os
import shutil
import subprocess
import sys
import json

RESET = "\033[0m"
GREEN = "\033[32m"
RED = "\033[31m"
YELLOW = "\033[33m"
BLUE = "\033[34m"
BOLD = "\033[1m"

def check(label, condition, fix=""):
    status = f"{GREEN}OK{RESET}" if condition else f"{RED}MISSING{RESET}"
    line = f"  {'['+status+']':>16}  {label}"
    if not condition and fix:
        line += f"  {YELLOW}→ {fix}{RESET}"
    print(line)
    return condition

def cmd_exists(cmd):
    return shutil.which(cmd) is not None

def env_set(key):
    return bool(os.environ.get(key, "").strip())

def user_exists(username):
    try:
        subprocess.run(["id", username], capture_output=True, check=True)
        return True
    except (subprocess.CalledProcessError, FileNotFoundError):
        return False

def python_pkg(pkg):
    try:
        __import__(pkg)
        return True
    except ImportError:
        return False

def skill_exists(name):
    return os.path.isdir(os.path.expanduser(f"~/.claude/skills/{name}"))

def check_nano_banana():
    """Test if Nano Banana API is actually callable."""
    key = os.environ.get("GOOGLE_GEMINI_API_KEY", "")
    if not key:
        return False, "No API key"
    try:
        import urllib.request
        url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key={key}"
        payload = json.dumps({
            "contents": [{"parts": [{"text": "test"}]}],
            "generationConfig": {"responseModalities": ["TEXT"]}
        }).encode()
        req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            result = json.loads(resp.read())
            if "error" in result:
                return False, result["error"].get("message", "Unknown error")[:60]
            return True, "Working"
    except Exception as e:
        return False, str(e)[:60]

def main():
    print(f"\n{BOLD}{BLUE}{'='*60}{RESET}")
    print(f"{BOLD}{BLUE}  Report Builder — Preflight Check{RESET}")
    print(f"{BOLD}{BLUE}{'='*60}{RESET}\n")

    score = 0
    total = 0

    # --- REQUIRED: LaTeX ---
    print(f"{BOLD}LaTeX Toolchain (REQUIRED){RESET}")
    total += 5
    score += check("pdflatex", cmd_exists("pdflatex"), "Install texlive-basic")
    score += check("biber", cmd_exists("biber"), "Install texlive-bibtexextra")
    score += check("makeglossaries", cmd_exists("makeglossaries"), "Install texlive-latexextra")
    score += check("makeindex", cmd_exists("makeindex"), "Install texlive-basic")
    # Check key packages
    try:
        r = subprocess.run(["kpsewhich", "pgfplots.sty"], capture_output=True, text=True)
        score += check("pgfplots/tikz/tcolorbox", bool(r.stdout.strip()), "Install texlive-pictures texlive-latexextra")
    except FileNotFoundError:
        check("pgfplots/tikz/tcolorbox", False, "kpsewhich not found")

    # --- REQUIRED: Python ---
    print(f"\n{BOLD}Python Environment (REQUIRED){RESET}")
    total += 5
    score += check("Python 3.10+", sys.version_info >= (3, 10))
    score += check("matplotlib", python_pkg("matplotlib"), "pip install matplotlib")
    score += check("pandas", python_pkg("pandas"), "pip install pandas")
    score += check("numpy", python_pkg("numpy"), "pip install numpy")
    score += check("PyMuPDF (fitz)", python_pkg("fitz"), "pip install pymupdf")

    # --- OPTIONAL: Diagram Tools ---
    print(f"\n{BOLD}Diagram Tools (OPTIONAL){RESET}")
    total += 2
    score += check("Mermaid CLI (mmdc)", cmd_exists("mmdc"), "npm install -g @mermaid-js/mermaid-cli")
    score += check("seaborn", python_pkg("seaborn"), "pip install seaborn")

    # --- OPTIONAL: API Keys ---
    print(f"\n{BOLD}API Keys (OPTIONAL — enables enhanced features){RESET}")
    total += 4
    score += check("GOOGLE_GEMINI_API_KEY", env_set("GOOGLE_GEMINI_API_KEY"), "Export key for Nano Banana")
    score += check("PERPLEXITY_API_KEY", env_set("PERPLEXITY_API_KEY"), "Export key for web research")
    score += check("OPENAI_API_KEY", env_set("OPENAI_API_KEY"), "Export key for cross-LLM review")
    score += check("DEEPSEEK_API_KEY", env_set("DEEPSEEK_API_KEY"), "Export key for reasoner review")

    # --- Nano Banana live test ---
    print(f"\n{BOLD}Nano Banana Image Generation{RESET}")
    total += 1
    nb_ok, nb_msg = check_nano_banana()
    score += check(f"Nano Banana API ({nb_msg})", nb_ok, "Needs billing-enabled Gemini key")

    # --- OPTIONAL: Multi-user LLMs ---
    print(f"\n{BOLD}Multi-User LLM Agents (OPTIONAL){RESET}")
    total += 3
    score += check("gemini-user", user_exists("gemini-user"), "Container multi-user setup")
    score += check("openai-user", user_exists("openai-user"), "Container multi-user setup")
    score += check("deepseek-user", user_exists("deepseek-user"), "Container multi-user setup")

    # --- OPTIONAL: Skills ---
    print(f"\n{BOLD}Complementary Skills{RESET}")
    total += 5
    score += check("latex-documents", skill_exists("latex-documents"))
    score += check("perplexity-research", skill_exists("perplexity-research"))
    score += check("ui-ux-pro-max-skill", skill_exists("ui-ux-pro-max-skill"))
    score += check("build-with-quality", skill_exists("build-with-quality"))
    score += check("skill-builder", skill_exists("skill-builder"))

    # --- OPTIONAL: MCP & Claude Flow ---
    print(f"\n{BOLD}Claude Flow / MCP{RESET}")
    total += 2
    try:
        r = subprocess.run(["npx", "@claude-flow/cli@latest", "--version"], capture_output=True, text=True, timeout=10)
        score += check("claude-flow CLI", r.returncode == 0)
    except (FileNotFoundError, subprocess.TimeoutExpired):
        check("claude-flow CLI", False, "npx @claude-flow/cli@latest")
        pass
    # Check if claude-flow MCP is registered
    settings_path = os.path.expanduser("~/.claude/settings.json")
    has_mcp = False
    if os.path.exists(settings_path):
        with open(settings_path) as f:
            try:
                settings = json.load(f)
                has_mcp = "claude-flow" in str(settings.get("mcpServers", {}))
            except json.JSONDecodeError:
                pass
    score += check("claude-flow MCP server", has_mcp, "claude mcp add claude-flow -- npx -y @claude-flow/cli@latest")

    # --- Summary ---
    pct = int(100 * score / total) if total > 0 else 0
    colour = GREEN if pct >= 80 else (YELLOW if pct >= 50 else RED)
    print(f"\n{BOLD}{colour}{'='*60}{RESET}")
    print(f"{BOLD}{colour}  Score: {score}/{total} ({pct}%){RESET}")

    if pct >= 80:
        print(f"{BOLD}{GREEN}  Status: READY — all core requirements met{RESET}")
    elif pct >= 50:
        print(f"{BOLD}{YELLOW}  Status: PARTIAL — core features work, some enhancements unavailable{RESET}")
    else:
        print(f"{BOLD}{RED}  Status: NOT READY — install required dependencies{RESET}")

    print(f"{BOLD}{colour}{'='*60}{RESET}\n")
    return 0 if pct >= 50 else 1


if __name__ == "__main__":
    sys.exit(main())
