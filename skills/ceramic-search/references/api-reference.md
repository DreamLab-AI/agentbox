# Ceramic Search — API Reference

Full endpoint, parameter, response, and error-handling reference for the
Ceramic search API.

## Prerequisites

- `CERAMIC_API_KEY` environment variable (get one at https://platform.ceramic.ai/keys)
- Free tier: 1,000 credits on signup
- Rate limits: 20 QPS (pay-as-you-go), 50 QPS (pro)

## Search (`POST https://api.ceramic.ai/search`)

Single endpoint. Returns 10 structured results with rich descriptions.

```bash
curl https://api.ceramic.ai/search \
  -H "Authorization: Bearer $CERAMIC_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query": "California rental laws"}'
```

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `query` | string | yes | — | Keyword search query, 1–50 words |
| `maxDescriptionLength` | integer | no | 3000 | Character limit per result description (1,000–8,000) |

### Response

```json
{
  "requestId": "ae2ebd93-194f-4460-9996-15e3f86b05d8",
  "result": {
    "results": [
      {
        "title": "California Tenant Rights Guide",
        "url": "https://example.com/tenant-rights",
        "description": "Comprehensive guide to California rental laws..."
      }
    ],
    "searchMetadata": {
      "executionTime": 0.097
    },
    "totalResults": 10
  }
}
```

## Error Handling

| HTTP Status | Meaning | Action |
|-------------|---------|--------|
| 200 | Success | — |
| 401 | Invalid or missing API key | Check `CERAMIC_API_KEY` |
| 422 | Invalid request (query too long, bad params) | Fix request body |
| 429 | Rate limited | Back off; check QPS tier |
| 500 | Server error | Retry with exponential backoff |

```python
from requests.exceptions import HTTPError
import time

def ceramic_search_with_retry(query, max_retries=3, **kwargs):
    for attempt in range(max_retries):
        try:
            return ceramic_search(query, **kwargs)
        except HTTPError as e:
            if e.response.status_code == 429:
                time.sleep(2 ** attempt)
            else:
                raise
```

## Reference links

- API: `POST https://api.ceramic.ai/search`
- Docs: https://docs.ceramic.ai
- Best practices: https://docs.ceramic.ai/api/search/best-practices
- MCP: https://docs.ceramic.ai/mcp/ceramic-mcp
- Platform / API keys: https://platform.ceramic.ai/keys
- Rate limits: 20 QPS (PAYG), 50 QPS (Pro), custom (Enterprise)
