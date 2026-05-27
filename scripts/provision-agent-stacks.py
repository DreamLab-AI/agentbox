#!/usr/bin/env python3
import json
import os
import pathlib
import shutil
import tomllib


WORKSPACE = pathlib.Path(os.getenv("WORKSPACE", "/workspace"))
SKILLS_TREE = pathlib.Path(os.getenv("SKILLS_TREE", "/opt/agentbox/skills"))
AGENTBOX_CONFIG = pathlib.Path(os.getenv("AGENTBOX_CONFIG", "/etc/agentbox.toml"))
SHARED_PROJECTS_ROOT = pathlib.Path(os.getenv("SHARED_PROJECTS_ROOT", "/projects"))


STACKS = {
    "claude-core": {
        "tools": ["claude", "openai-codex", "codex-companion", "skill-router", "lazy-fetch"],
        "skills": ["skill-router", "lazy-fetch", "codebase-memory", "openai-codex", "codex-companion"],
        "env": ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "OPENAI_DEFAULT_MODEL"],
    },
    "ruflo-orchestrator": {
        "tools": ["ruflo", "@claude-flow/cli", "ruvector"],
        "skills": ["build-with-quality", "swarm-advanced", "lazy-fetch", "bhil-methodology", "codebase-memory"],
        "env": ["RUVECTOR_PORT", "RUVECTOR_DATA_DIR", "NOSTR_RELAYS"],
    },
    "qe-fleet": {
        "tools": ["agentic-qe", "aqe", "playwright", "chromium"],
        "skills": ["build-with-quality", "browser-automation", "playwright", "chrome-cdp"],
        "env": ["PLAYWRIGHT_TIMEOUT", "DISPLAY", "SCREENSHOT_DIR"],
    },
    "nagual-qe": {
        "tools": ["nagual-qe", "agentic-qe", "aqe"],
        "skills": ["browser-automation", "build-with-quality"],
        "env": ["NAGUAL_API_KEY", "NAGUAL_BASE_URL"],
    },
    "rust-builder": {
        "tools": ["cargo", "rustc", "clippy", "rustfmt", "wasm-pack"],
        "skills": ["rust-development", "wasm-js", "agentic-jujutsu", "codebase-memory"],
        "env": ["RUST_BACKTRACE", "CARGO_HOME", "RUSTUP_HOME"],
    },
    "docs-latex": {
        "tools": ["pdflatex", "xelatex", "lualatex", "biber", "latexmk", "pandoc"],
        "skills": ["latex-documents", "report-builder", "mermaid-diagrams", "paperbanana", "wardley-maps"],
        "env": ["PERPLEXITY_API_KEY", "GOOGLE_GEMINI_API_KEY", "OPENAI_API_KEY"],
    },
    # ZAI profile: Claude Code routed through Z.AI GLM (Anthropic-compatible).
    # Z.AI has TWO endpoints:
    #   API (per-token): https://api.z.ai/api/anthropic
    #   Subscription (flat-rate, GLM Coding Plan): https://api.z.ai/api/coding/paas/v4
    #     Plans: Lite $9/mo | Pro $27/mo | Max $72/mo (quarterly billing)
    #     z.ai/subscribe
    # Set ZAI_URL to the subscription endpoint for flat-rate; leave unset for
    # the Anthropic-compatible relay (per-token). ZAI_API_KEY is the auth token.
    # Profile isolation prevents ANTHROPIC_BASE_URL from leaking to main Claude.
    "zai": {
        "tools": ["claude"],
        "skills": ["skill-router", "lazy-fetch", "codebase-memory"],
        "env": ["ZAI_API_KEY", "ZAI_URL"],
    },
    # OpenRouter profile: Claude Code routed through OpenRouter's Anthropic-
    # compatible API. OPENROUTER_API_KEY is injected via the dotenv credentials
    # system (providers.openrouter in agentbox.toml). The tmux-autostart.sh
    # Window 8 writes settings.local.json at runtime (not at build time) with
    # the live key value. Free NVIDIA models available:
    #   nvidia/nemotron-3-super-120b-a12b:free  (262k ctx, tool-calling)
    #   nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free (reasoning+vision)
    #   nvidia/nemotron-nano-12b-v2-vl:free     (fast vision-language)
    # Also strong free alternatives: qwen/qwen3-coder:free, deepseek/deepseek-v4-flash:free
    "openrouter": {
        "tools": ["claude"],
        "skills": ["skill-router", "lazy-fetch", "codebase-memory"],
        "env": ["OPENROUTER_API_KEY"],
    },
    # antigravity profile: Google Gemini CLI coding agent.
    # Uses Gemini's own config format under .antigravity/; no .claude/settings.json
    # is written for this profile.  GOOGLE_GEMINI_API_KEY is the primary auth token;
    # GOOGLE_API_KEY is the fallback used by some Gemini SDK variants.
    "antigravity": {
        "tools": ["gemini"],
        "skills": ["skill-router", "lazy-fetch", "codebase-memory"],
        "env": ["GOOGLE_GEMINI_API_KEY", "GOOGLE_API_KEY"],
        "no_claude_settings": True,
        "extra_dirs": [".antigravity"],
    },
    # deepseek profile: DeepSeek v4 via CodeWhale.
    # CodeWhale manages its own config; no .claude/settings.json needed.
    "deepseek": {
        "tools": ["codewhale", "deepseek"],
        "skills": ["skill-router", "lazy-fetch", "codebase-memory"],
        "env": ["DEEPSEEK_API_KEY"],
        "no_claude_settings": True,
    },
    # perplexity profile: Perplexity AI research shell.
    # Provides AI-powered research with citations; no .claude/settings.json needed.
    "perplexity": {
        "tools": ["perplexity"],
        "skills": ["perplexity-research", "web-researcher", "lazy-fetch"],
        "env": ["PERPLEXITY_API_KEY"],
        "no_claude_settings": True,
    },
    # ollama profile: local LLM via Nanocoder.
    # Zero-cost local model coding agent; no .claude/settings.json needed.
    # OLLAMA_BASE_URL defaults to http://localhost:11434 when unset.
    "ollama": {
        "tools": ["nanocoder", "ollama"],
        "skills": ["skill-router", "lazy-fetch", "codebase-memory"],
        "env": ["OLLAMA_BASE_URL", "OLLAMA_MODEL"],
        "no_claude_settings": True,
    },
    # codex profile: OpenAI Codex CLI (GPT-5.5 coding agent).
    # Uses .codex/ config directory; no .claude/settings.json needed.
    "codex": {
        "tools": ["openai-codex", "codex"],
        "skills": ["skill-router", "lazy-fetch", "codebase-memory", "openai-codex"],
        "env": ["OPENAI_API_KEY"],
        "no_claude_settings": True,
        "extra_dirs": [".codex"],
    },
}


def write_text(path: pathlib.Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def symlink_skills(target: pathlib.Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists() or target.is_symlink():
        if target.is_symlink() or target.is_file():
            target.unlink()
        else:
            shutil.rmtree(target)
    target.symlink_to(SKILLS_TREE, target_is_directory=True)


def symlink_shared(target: pathlib.Path, source: pathlib.Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists() or target.is_symlink():
        if target.is_symlink() or target.is_file():
            target.unlink()
        else:
            shutil.rmtree(target)
    target.symlink_to(source, target_is_directory=True)


def build_profile(name: str, config: dict) -> None:
    root = WORKSPACE / "profiles" / name
    claude_dir = root / ".claude"
    env_lines = ["# Generated by Agentbox", f"AGENT_STACK={name}"]

    for key in config["env"]:
        env_lines.append(f"{key}={os.getenv(key, '')}")

    symlink_shared(root / "projects", SHARED_PROJECTS_ROOT)
    symlink_shared(root / "workspace", WORKSPACE)
    write_text(root / ".env", "\n".join(env_lines) + "\n")

    # Create any stack-specific config directories (e.g. .antigravity/, .codex/).
    for extra in config.get("extra_dirs", []):
        (root / extra).mkdir(parents=True, exist_ok=True)

    write_text(
        root / "README.md",
        "\n".join(
            [
                f"# {name}",
                "",
                "Provisioned stack profile for Agentbox.",
                "",
                f"Shared external projects mount: {SHARED_PROJECTS_ROOT}",
                f"Shared workspace mount: {WORKSPACE}",
                f"Shared skills tree: {SKILLS_TREE}",
                f"Zellij layout: {WORKSPACE / '.config' / 'zellij' / 'layouts' / f'{name}.kdl'}",
                f"Agent URN: urn:agentbox:agent:{name}",
                "",
                "Tools:",
                *[f"- {tool}" for tool in config["tools"]],
                "",
                "Recommended skills:",
                *[f"- {skill}" for skill in config["skills"]],
                "",
                f"Progressive disclosure index: {SKILLS_TREE / 'SKILL-DIRECTORY.md'}",
                "",
            ]
        ),
    )

    # Profiles that use a non-Claude agent (Gemini, DeepSeek, Perplexity, Ollama,
    # Codex) manage their own config format — skip writing .claude/settings.json.
    if config.get("no_claude_settings"):
        return

    settings = {
        "stack": name,
        "skillsDirectory": str(SKILLS_TREE),
        "progressiveDisclosureIndex": str(SKILLS_TREE / "SKILL-DIRECTORY.md"),
        "sharedProjectsRoot": str(SHARED_PROJECTS_ROOT),
        "zellijLayout": str(WORKSPACE / ".config" / "zellij" / "layouts" / f"{name}.kdl"),
        "recommendedSkills": config["skills"],
        "tooling": config["tools"],
        "agentUrn": f"urn:agentbox:agent:{name}",
        "didTemplate": "did:nostr:{AGENTBOX_PUBKEY_HEX}",
    }

    symlink_skills(claude_dir / "skills")
    write_text(claude_dir / "settings.json", json.dumps(settings, indent=2) + "\n")


def main() -> None:
    config = tomllib.loads(AGENTBOX_CONFIG.read_text(encoding="utf-8"))
    manifest = {
        "generated_from": str(AGENTBOX_CONFIG),
        "skills_tree": str(SKILLS_TREE),
        "shared_projects_root": str(SHARED_PROJECTS_ROOT),
        "stacks": STACKS,
        "toolchains": config.get("toolchains", {}),
    }

    for name, stack in STACKS.items():
        build_profile(name, stack)

    write_text(WORKSPACE / ".agentbox" / "stack-manifest.json", json.dumps(manifest, indent=2) + "\n")


if __name__ == "__main__":
    main()
