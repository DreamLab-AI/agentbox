---
name: perplexity
description: >
  Perplexity AI research assistant with real-time web search, source citations,
  and optimized UK-centric prompts. Access live web data, current events, market
  research, and comprehensive analysis backed by verified sources.
version: 2.0.0
author: turbo-flow-claude
mcp_server: true
protocol: mcp-sdk
entry_point: mcp-server/server.js
dependencies:
  - perplexity-sdk
---

# Perplexity AI Research Skill

Access Perplexity's powerful real-time web search and research capabilities directly from Claude Code and claude-flow.

## Overview

This skill provides:
- **Real-time web search** via Perplexity's Sonar API
- **Source citations** with every response
- **Prompt optimization** for maximum research quality
- **UK-centric focus** with European context
- **Multiple research modes** (quick, balanced, deep)

## MCP Server

The skill includes an MCP server that exposes Perplexity research tools:

### Tools

1. **perplexity_search** - Quick factual search
   - Fast, cited answers to direct questions
   - Current data and live web access

2. **perplexity_research** - Deep research analysis
   - Multi-source synthesis
   - Comprehensive reports with citations
   - Structured output formats

3. **perplexity_generate_prompt** - Prompt optimization
   - Transform vague queries into effective prompts
   - Apply best practices for Perplexity
   - UK/European context integration

## Usage from Claude Code

```bash
# Quick search
perplexity_search "current UK mortgage rates major banks"

# Deep research
perplexity_research --topic "AI trends UK enterprise 2025" \
  --format "executive summary" \
  --sources 10

# Generate optimized prompt
perplexity_generate_prompt --goal "market research for renewable energy ETFs" \
  --context "UK retail investor £10K budget"
```

## Configuration

API key configured via environment variable:
```bash
PERPLEXITY_API_KEY=pplx-xxxxx
```

Set in `.env` file or docker-compose environment.

## Models Available

- **sonar** - Fast, balanced (default)
- **sonar-pro** - Deep research, more sources
- **sonar-reasoning** - Complex analysis

## Features

### Prompt Optimization

Automatically structures queries using five-element framework:
1. **Instruction** - Clear goal
2. **Context** - Background framing
3. **Input** - Specific constraints
4. **Keywords** - Focus terms
5. **Output format** - Structured results

### UK-Centric Research

- British English spelling/terminology
- UK laws and regulations
- European context priority
- .gov.uk and UK source preference

### Citation Management

Every response includes:
- Source URLs
- Publication dates
- Credibility indicators
- Verification links

## Integration with Claude Flow

### Swarm Mode
```bash
cf-swarm "research UK fintech regulations using perplexity skill"
```

### Hive Mind
```bash
cf-hive "comprehensive market analysis UK renewable energy sector" \
  --tools perplexity \
  --agents 5
```

### Hooks Integration
```javascript
// Pre-task hook: Generate optimized prompt
hooks.preTask((task) => {
  if (task.requiresResearch) {
    return perplexity.generatePrompt(task.description);
  }
});
```

## Examples

### Market Research
```javascript
{
  "tool": "perplexity_research",
  "params": {
    "topic": "Top 10 UK SaaS companies by ARR 2025",
    "context": "B2B software market analysis",
    "format": "table",
    "timeframe": "last 90 days",
    "sources": 15
  }
}
```

### Regulatory Compliance
```javascript
{
  "tool": "perplexity_search",
  "params": {
    "query": "UK GDPR requirements for e-commerce 2025",
    "domain_filter": [".gov.uk", ".ico.org.uk"],
    "uk_focus": true
  }
}
```

### Competitive Analysis
```javascript
{
  "tool": "perplexity_research",
  "params": {
    "topic": "Compare Stripe vs GoCardless UK market share payment processing",
    "format": "comparison table",
    "include_pricing": true,
    "uk_focus": true
  }
}
```

## Advanced Features

### Search Options

- **domain_filter**: Limit to specific domains
- **timeframe**: Recency constraint (24h, 7d, 30d, 90d)
- **uk_focus**: Prioritize UK/EU sources
- **citation_style**: APA, MLA, Chicago, IEEE
- **temperature**: Creativity vs precision (0.0-1.0)

### Output Formats

- **prose**: Natural language summary
- **table**: Structured comparison
- **bullet**: Concise bullet points
- **executive**: Executive summary with TL;DR
- **report**: Full research report

### Rate Limiting

- 50 requests/minute (default tier)
- 500 requests/hour
- Automatic retry with backoff
- Queue management for burst requests

## Troubleshooting

### API Key Issues
```bash
# Test API key
curl -H "Authorization: Bearer $PERPLEXITY_API_KEY" \
  https://api.perplexity.ai/chat/completions
```

### MCP Server Not Responding
```bash
# Check supervisord status
supervisorctl status perplexity-mcp

# View logs
tail -f /var/log/perplexity-mcp.log
```

### Rate Limit Errors
- Reduce concurrent requests
- Increase delay between calls
- Upgrade Perplexity tier

## Performance

- **Quick search**: 2-5 seconds
- **Deep research**: 10-30 seconds
- **Source count**: 5-20 citations typical
- **Memory usage**: ~50MB per MCP server

## Best Practices

1. **Be specific** - Narrow scope, clear constraints
2. **Request citations** - Always verify sources
3. **Use UK context** - Specify regional needs
4. **Optimize prompts** - Use generate_prompt tool first
5. **Check recency** - Set timeframe for time-sensitive queries
6. **Verify sources** - Review citation quality

## Security

- API keys stored in environment variables only
- No credential logging
- User-specific isolation (zai-user can't access devuser keys)
- TLS for all API communication

## Resources

- [Perplexity API Docs](https://docs.perplexity.ai/)
- 
- [Research Templates](./docs/templates.md)
- 
