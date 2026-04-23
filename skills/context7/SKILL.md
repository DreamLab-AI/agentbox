---
name: context7
description: >
  Version-specific documentation for 800+ libraries via Context7 MCP. Two tools:
  resolve-library-id (library name → canonical ID) and query-docs (ID + query → live docs
  and code examples). Eliminates hallucination in agent code generation. Use when Claude
  is writing code for an external library and needs current API docs, when the user says
  "use context7", "check the docs for X", or "get current docs for library Y".
version: 1.0.0
author: Upstash
mcp_server: true
protocol: stdio
entry_point: npx -y @upstash/context7-mcp@latest
tags:
  - documentation
  - mcp
  - libraries
  - on-demand
  - anti-hallucination
env_vars:
  - CONTEXT7_API_KEY
---

# Context7 — Version-Specific Library Documentation

Fetches up-to-date, version-specific documentation and code examples from 800+ libraries
directly into Claude's context. Eliminates hallucination from training data cutoffs.

## When to Use This Skill

- **Current API docs**: "How do I do X in Next.js 15?" — gets real docs, not cached training data
- **Version-specific patterns**: Supabase, React, LangChain, etc. APIs that change between versions
- **Anti-hallucination**: When Claude generates code for external libraries that may have changed
- **User triggers**: "use context7", "check docs for X", "use library /nextjs/nextjs", "get current API for Y"

## When Not to Use

- For internal codebase understanding — use `codebase-memory`
- For arbitrary web pages — use `gemini-url-context` or `web-summary`
- For research synthesis — use `notebooklm` or `perplexity-research`

## Setup

```bash
# Get your API key (free tier available)
npx ctx7 setup

# Or add CONTEXT7_API_KEY to your .env
export CONTEXT7_API_KEY=your_key_here
```

No key required for basic public library queries. Key unlocks higher rate limits and private libraries.

## MCP Tools (2)

| Tool | Input | Output | Use |
|------|-------|--------|-----|
| `resolve-library-id` | Library name (e.g., "next.js", "supabase") | Context7-compatible library ID | Convert human name → canonical ID |
| `query-docs` | Context7 ID + query string | Version-specific docs + code examples | Fetch relevant documentation |

## Usage Patterns

### Pattern 1: Natural language trigger
```
User: "How do I set up middleware in Next.js 15? Use context7."
Claude calls: resolve-library-id("next.js") → /nextjs/nextjs
Claude calls: query-docs("/nextjs/nextjs", "middleware configuration Next.js 15")
Claude returns: Current, accurate code with Next.js 15 syntax
```

### Pattern 2: Direct library ID
```
User: "Show me how to use Supabase Row Level Security. Library: /supabase/supabase"
Claude calls: query-docs("/supabase/supabase", "row level security RLS policies")
```

### Pattern 3: Integrated in code generation
When writing code that uses an external library, proactively call context7 for the key APIs
to ensure the generated code matches the current version.

## Supported Libraries (800+)

Covers: Next.js, React, Supabase, LangChain, Vercel, Tailwind, Prisma, Drizzle, Astro,
SvelteKit, Nuxt, Vue, Angular, Express, Fastify, tRPC, Zod, shadcn/ui, Radix UI, Framer Motion,
PyTorch, TensorFlow, Pandas, FastAPI, Django, Flask, SQLAlchemy, and hundreds more.

Full list: https://context7.com/libraries

## Configuration in MCP Settings

```json
{
  "context7": {
    "command": "npx",
    "args": ["-y", "@upstash/context7-mcp@latest"],
    "env": {
      "CONTEXT7_API_KEY": "<your_key>"
    }
  }
}
```

## Integration with Other Skills

| Skill | Relationship |
|-------|-------------|
| `codebase-memory` | Use together: codebase-memory for internal architecture, context7 for external library docs |
| `build-with-quality` | Context7 reduces hallucination in generated code; use before implementation phases |
| `codex-companion` | If GPT-5.4 is doing the implementation, context7 docs still help ground the generation |
| `perplexity-research` | Perplexity for general web search; context7 for structured library documentation |

## Attribution

Context7 by Upstash. https://github.com/upstash/context7
