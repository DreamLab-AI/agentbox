# Ceramic Search — Query Best Practices

Ceramic is an **exact-match keyword engine**, not semantic. Queries that work
well with conversational search engines will underperform here.

| Do | Don't |
|----|-------|
| `California rent increase causes 2026` | `Why is rent so high in California?` |
| `OpenAI GPT-5 announcement 2025` | `What's the latest on GPT-5?` |
| `college university tuition costs US` | `tuition` (too broad) |
| `cat house building plans` | Rely on synonym expansion |
| Use 2–8 specific keywords | Use articles (the, a, an) or filler words |
| Include entities, dates, locations | Use conversational phrasing |
| Issue multiple synonym variants | Craft one complex query |

**Word order matters.** `cat house` and `house cat` return different results.
