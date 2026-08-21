# web-researcher deployment & Nix pin

Depth relocated from SKILL.md (progressive discovery). Load when bumping the binary
version or debugging registration.

## Current deployment (verified 2026-08-21)

The deployed Nix binary is **`web-researcher-mcp-1.43.0`** (resolved on `$PATH` from
`/nix/store/…-web-researcher-mcp-1.43.0/bin`). The full v1.33+ toolset is registered and
live — confirmed against the running server's `tools/list` (21 tools; see SKILL.md table).

> Historical note: an earlier deployment shipped only the original 8 v1.2.2 tools
> (web/image/news/academic/patent/sequential search + `scrape_page` + `search_and_scrape`).
> That gap is **closed** — the domain-search, citation-integrity, session/memory and
> research tools are all exposed now. Always confirm with `tools/list` (Health Check in
> SKILL.md) rather than trusting any documented count.

## Registration

MCP stdio server registered as `web-researcher` in `mcp/mcp.json`. Binary resolved from
`$PATH` (Nix-baked when `[skills.research].web_researcher = true`, else
`go install github.com/zoharbabin/web-researcher-mcp/cmd/web-researcher-mcp@latest`).

```bash
# Manual registration (auto-registered at boot):
claude mcp add --scope user --transport stdio web-researcher -- web-researcher-mcp
```

## Bumping the pinned version

To move the pin (e.g. a future `vX.Y.Z`), edit `flake.nix` `webResearcherMcpPkg`:

1. Set `version = "X.Y.Z"` and the source `rev = "vX.Y.Z"`.
2. Refresh `hash` via `nix-prefetch-github zoharbabin web-researcher-mcp --rev vX.Y.Z`.
3. Refresh `vendorHash` from the first build's printed value (set it wrong once, copy the
   expected hash Nix reports).
4. Rebuild agentbox, then re-run the Health Check `tools/list` and reconcile the SKILL.md
   tool table against what the server actually exposes.

## Provider-gated tools

The live tool *set* is fixed, but several tools are inert without provider keys/config:

- `search_and_scrape`, `web_search` etc. need at least one search provider (see Required
  Configuration in SKILL.md). With none configured the server falls back to DuckDuckGo.
- `citation_graph` needs a citation-capable provider; `academic_search` needs the academic
  providers (OpenAlex/Semantic Scholar are keyless).

`docs/TOOLS.md` upstream is the authoritative, CI-verified tool list + schemas.
