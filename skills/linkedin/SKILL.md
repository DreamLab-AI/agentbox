---
name: linkedin
description: >
  LinkedIn integration via MCP for profile scraping, job search, messaging,
  company analysis, and people search. Uses Patchright browser automation
  with persistent session for authenticated access without API keys.
  Use when searching LinkedIn profiles, jobs, companies, or managing LinkedIn messaging.
version: 1.0.0
author: agentbox-claude
mcp_server: true
protocol: stdio
entry_point: uvx linkedin-scraper-mcp
dependencies:
  - patchright
env_vars:
  - LINKEDIN_TIMEOUT
  - CHROME_PATH
---

# LinkedIn MCP Skill

Browser-automated LinkedIn integration that scrapes profiles, searches jobs, sends messages, and analyzes companies through a persistent authenticated session.

## When to Use This Skill

- **Profile Research**: Fetch detailed person profiles including experience, education, and skills
- **Job Search**: Search and retrieve job listings with filters
- **Company Analysis**: Get company profiles, employee counts, and recent posts
- **People Search**: Find professionals by role, location, company, or keywords
- **Messaging**: Send connection requests or messages to existing connections
- **Inbox Management**: Read conversations and search message history

## When Not To Use

- For general web scraping or non-LinkedIn sites -- use the playwright or browser skills instead
- For job board aggregation across multiple platforms -- handle manually or use dedicated aggregators
- For LinkedIn Ads management or campaign creation -- not supported by this tool
- For bulk automated outreach or spam -- violates LinkedIn ToS; this skill is for targeted research
- For data that requires LinkedIn Premium or Sales Navigator -- session uses your account tier

## Architecture

```
┌─────────────────────────────────┐
│  Claude Code / Skill Invocation │
└──────────────┬──────────────────┘
               │ MCP Protocol (stdio)
               ▼
┌─────────────────────────────────┐
│  LinkedIn Scraper MCP Server    │
│  (uvx / Patchright)            │
└──────────────┬──────────────────┘
               │ Browser Automation
               ▼
┌─────────────────────────────────┐
│  Chromium (Patchright-managed)  │
│  Persistent profile at          │
│  ~/.linkedin-mcp/profile/       │
└──────────────┬──────────────────┘
               │ HTTPS
               ▼
┌─────────────────────────────────┐
│  LinkedIn.com                   │
└─────────────────────────────────┘
```

## Authentication

No API key required. The server uses browser-based login with a persistent Chromium profile stored at `~/.linkedin-mcp/profile/`. On first use, the browser opens a login page; after authenticating once, the session persists across restarts.

## Tools

| Tool | Description |
|------|-------------|
| `get_person_profile` | Fetch a person's full LinkedIn profile by URL or public identifier |
| `connect_with_person` | Send a connection request with optional message |
| `get_sidebar_profiles` | Get "People also viewed" sidebar profiles from a profile page |
| `get_inbox` | Retrieve recent inbox conversations |
| `get_conversation` | Fetch messages from a specific conversation thread |
| `search_conversations` | Search inbox by keyword |
| `send_message` | Send a message to an existing connection |
| `get_company_profile` | Fetch company details: size, industry, headquarters, description |
| `get_company_posts` | Retrieve recent posts from a company page |
| `search_jobs` | Search job listings with keyword, location, and filter parameters |
| `search_people` | Search for people by name, title, company, location |
| `get_job_details` | Fetch full details of a specific job posting |
| `close_session` | Gracefully close the browser session |

## Examples

```python
# Fetch a person's profile
get_person_profile({
    "url": "https://www.linkedin.com/in/satyanadella/"
})

# Search for jobs
search_jobs({
    "keywords": "machine learning engineer",
    "location": "San Francisco Bay Area",
    "job_type": "full-time"
})

# Search for people at a company
search_people({
    "keywords": "VP Engineering",
    "company": "Anthropic"
})

# Get company profile and recent posts
get_company_profile({
    "url": "https://www.linkedin.com/company/anthropic/"
})

# Send a connection request
connect_with_person({
    "profile_url": "https://www.linkedin.com/in/example/",
    "message": "Would love to connect regarding our shared interest in AI safety."
})
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `LINKEDIN_TIMEOUT` | No | Request timeout in milliseconds (default: 30000) |
| `CHROME_PATH` | No | Path to Chromium binary (auto-detected by Patchright if omitted) |

## Setup

```bash
# Install via uvx (recommended)
uvx linkedin-scraper-mcp

# Or add to MCP config
# The server will prompt for browser login on first run
```

## Troubleshooting

**Login Session Expired:**
```bash
# Remove persistent profile and re-authenticate
rm -rf ~/.linkedin-mcp/profile/
# Restart the MCP server -- browser will open login page
```

**Browser Not Found:**
```bash
# Install Patchright browsers
uvx patchright install chromium

# Or specify Chrome path explicitly
export CHROME_PATH="/usr/bin/chromium-browser"
```

**Rate Limiting / CAPTCHA:**
- LinkedIn may throttle automated browsing; reduce request frequency
- If CAPTCHA appears, solve it manually in the browser window
- The persistent session reduces CAPTCHA frequency significantly

**Timeout Errors:**
```bash
# Increase timeout for slow connections
export LINKEDIN_TIMEOUT=60000
```

## Integration with Other Skills

Combine with:
- `perplexity-research`: Cross-reference LinkedIn profiles with web research
- `gemini-url-context`: Expand company blog posts found via LinkedIn
- `report-builder`: Generate hiring pipeline or competitive analysis reports
