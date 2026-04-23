---
name: toprank
description: >
  AI-powered SEO/SEM automation suite with 6 specialised skills. Google Search Console
  integration, content writing (E-E-A-T), keyword research, meta tag optimisation,
  JSON-LD schema markup, and GEO (Generative Engine Optimisation) for AI citations.
version: 1.0.0
author: nowork-studio
tags:
  - seo
  - sem
  - google-search-console
  - content
  - keywords
  - schema-markup
  - geo
env_vars:
  - GOOGLE_APPLICATION_CREDENTIALS
---

# Toprank SEO Suite

AI-powered SEO and SEM automation through 6 specialised skills with Google Search Console integration.

## When to Use This Skill

- **SEO audits**: "analyse my SEO", "why is traffic down", "technical SEO audit"
- **Content creation**: "write blog post about X", "improve this page for SEO"
- **Keyword research**: "keyword research for [topic]", "content ideas", "search volume"
- **Meta tag optimisation**: "optimise title tag", "improve CTR", "social preview"
- **Schema markup**: "add schema markup", "rich snippets", "FAQ schema"
- **AI search optimisation**: "optimise for AI", "appear in AI answers", "GEO"

## When Not to Use

- For Answer Engine Optimisation without SEO context -- use `bencium-aeo` instead
- For general web research -- use `perplexity-research` instead
- For URL content analysis -- use `gemini-url-context` instead
- For LinkedIn/social media optimisation -- use `linkedin` instead

## Sub-Skills

| Skill | Trigger | What It Does |
|-------|---------|-------------|
| `seo-analysis` | "SEO audit", "traffic down", "search console" | Full audit with GSC data, technical crawl, search intent, 30-day action plan |
| `content-writer` | "write blog post", "improve page" | E-E-A-T compliant content, blog posts, landing pages |
| `keyword-research` | "keyword research", "content ideas" | Keyword discovery, intent classification, topic clusters |
| `meta-tags-optimizer` | "optimise title", "improve CTR" | Title/description/OG tags, social preview optimisation |
| `schema-markup-generator` | "schema markup", "rich snippets" | JSON-LD structured data for articles, FAQ, products, etc. |
| `geo-content-optimizer` | "optimise for AI", "AI answers" | Generative Engine Optimisation for ChatGPT/Perplexity/Claude citations |

## Setup

```bash
# Install dependencies
pip install -r ~/.claude/skills/toprank/requirements.txt

# Authenticate with Google Search Console
gcloud auth application-default login
```

The skill auto-detects your site URL when run inside a website repo.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GOOGLE_APPLICATION_CREDENTIALS` | For GSC | Path to service account JSON (or use `gcloud auth`) |

## Architecture

```
┌─────────────────────────────────┐
│  Claude Code / Skill Invocation │
└──────────────┬──────────────────┘
               │ Loads sub-skill SKILL.md
               ▼
┌─────────────────────────────────┐
│  Toprank Sub-Skill              │
│  (seo-analysis, content-writer, │
│   keyword-research, etc.)       │
└──────────────┬──────────────────┘
               │ Python scripts
               ▼
┌─────────────────────────────────┐
│  Google Search Console API      │
│  + Site crawling + Analysis     │
└─────────────────────────────────┘
```

## Integration with Other Skills

- `perplexity-research`: Research competitor strategies before keyword planning
- `bencium-aeo`: Complement traditional SEO with AI citation optimisation
- `report-builder`: Generate comprehensive SEO reports with charts and Wardley maps
- `wardley-maps`: Map SEO component evolution and competitive positioning
