---
name: reddit
description: >
  Reddit integration for browsing subreddits, searching content, analyzing
  user profiles, and fetching post details with comment threads. Supports
  anonymous, app-only, and authenticated modes with tiered rate limits.
version: 1.0.0
author: agentbox-claude
mcp_server: true
protocol: stdio
entry_point: npx reddit-mcp-buddy
dependencies: []
env_vars:
  - REDDIT_CLIENT_ID
  - REDDIT_CLIENT_SECRET
  - REDDIT_USERNAME
  - REDDIT_PASSWORD
---

# Reddit MCP Skill

Read-only Reddit integration that browses subreddits, searches content, fetches post details with full comment threads, and analyzes user profiles. Three authentication tiers provide escalating rate limits from anonymous browsing to full authenticated access.

## When to Use This Skill

- **Subreddit Browsing**: Fetch hot, new, top, or rising posts from any subreddit
- **Content Search**: Search Reddit globally or within specific subreddits by keyword
- **Post Analysis**: Get full post details including comment trees with nested replies
- **User Research**: Analyze user activity, karma breakdown, posting patterns, and top content
- **Community Insights**: Understand subreddit culture, popular topics, and sentiment
- **Technical Research**: Find solutions, discussions, and opinions on technical topics

## When Not To Use

- For posting, commenting, voting, or any write operations -- this skill is read-only
- For Reddit Ads management or promoted content -- not supported
- For real-time streaming or live thread monitoring -- polling only, no WebSocket support
- For accessing quarantined or private subreddits -- requires manual browser access
- For scraping large datasets or bulk export -- use Reddit's official data API or Pushshift

## Architecture

```
┌─────────────────────────────────┐
│  Claude Code / Skill Invocation │
└──────────────┬──────────────────┘
               │ MCP Protocol (stdio)
               ▼
┌─────────────────────────────────┐
│  Reddit MCP Buddy (Node.js)     │
│  Auth tier auto-detection       │
└──────────────┬──────────────────┘
               │ HTTPS (OAuth2 / Anonymous)
               ▼
┌─────────────────────────────────┐
│  Reddit API (oauth.reddit.com)  │
│  or old.reddit.com (anonymous)  │
└─────────────────────────────────┘
```

## Authentication Tiers

| Tier | Env Vars Required | Rate Limit | Best For |
|------|-------------------|------------|----------|
| **Anonymous** | None | 10 req/min | Quick lookups, casual browsing |
| **App-Only** | `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET` | 60 req/min | Regular research, search |
| **Authenticated** | All 4 vars | 100 req/min | Heavy usage, user analysis |

The server auto-detects the highest available tier based on which environment variables are set.

## Tools

| Tool | Description |
|------|-------------|
| `browse_subreddit` | Fetch posts from a subreddit with sorting (hot, new, top, rising) and time filters |
| `search_reddit` | Search Reddit globally or within a subreddit by keywords with sort and time options |
| `get_post_details` | Fetch a post's full content and comment tree with configurable depth and sorting |
| `user_analysis` | Analyze a Reddit user's profile: karma, activity, top posts, subreddit distribution |
| `reddit_explain` | Explain Reddit-specific terminology, culture, or subreddit purpose |

## Examples

```python
# Browse a subreddit
browse_subreddit({
    "subreddit": "MachineLearning",
    "sort": "top",
    "time_filter": "week",
    "limit": 10
})

# Search for content
search_reddit({
    "query": "transformer architecture explained",
    "subreddit": "MachineLearning",
    "sort": "relevance",
    "limit": 5
})

# Get post with comments
get_post_details({
    "url": "https://www.reddit.com/r/programming/comments/abc123/title/",
    "comment_sort": "top",
    "comment_depth": 3
})

# Analyze a user profile
user_analysis({
    "username": "spez",
    "include_top_posts": true,
    "include_subreddit_breakdown": true
})

# Explain Reddit terminology
reddit_explain({
    "term": "what is karma and how does it work"
})
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `REDDIT_CLIENT_ID` | No | Reddit app client ID (from https://www.reddit.com/prefs/apps) |
| `REDDIT_CLIENT_SECRET` | No | Reddit app client secret |
| `REDDIT_USERNAME` | No | Reddit account username (for authenticated tier) |
| `REDDIT_PASSWORD` | No | Reddit account password (for authenticated tier) |

## Setup

```bash
# Anonymous mode (no setup needed)
npx reddit-mcp-buddy

# App-only mode (create app at reddit.com/prefs/apps, type "script")
export REDDIT_CLIENT_ID="your-client-id"
export REDDIT_CLIENT_SECRET="your-client-secret"

# Authenticated mode (adds username/password)
export REDDIT_USERNAME="your-username"
export REDDIT_PASSWORD="your-password"

# Or add to .env
cat >> /home/devuser/.claude/skills/.env << 'EOF'
REDDIT_CLIENT_ID=your-client-id
REDDIT_CLIENT_SECRET=your-client-secret
EOF
```

## Troubleshooting

**Rate Limited (429 Errors):**
```bash
# Upgrade auth tier for higher limits
# Anonymous: 10/min → App-only: 60/min → Authenticated: 100/min
export REDDIT_CLIENT_ID="..."
export REDDIT_CLIENT_SECRET="..."
```

**Authentication Failed:**
```bash
# Verify credentials
curl -X POST -d "grant_type=client_credentials" \
  --user "$REDDIT_CLIENT_ID:$REDDIT_CLIENT_SECRET" \
  https://www.reddit.com/api/v1/access_token
```

**Subreddit Not Found:**
- Check spelling and capitalization (subreddit names are case-insensitive but must exist)
- Private or quarantined subreddits are not accessible through this tool

**Empty Search Results:**
- Reddit search can be inconsistent; try broader keywords
- Use `time_filter` to narrow results to recent content
- Search within specific subreddits for better relevance

## Integration with Other Skills

Combine with:
- `perplexity-research`: Cross-reference Reddit discussions with broader web research
- `gemini-url-context`: Expand URLs shared in Reddit posts
- `report-builder`: Generate trend analysis reports from subreddit data
- `linkedin`: Compare professional profiles discussed on Reddit
