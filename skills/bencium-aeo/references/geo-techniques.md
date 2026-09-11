# GEO Technique Library

Merged from `toprank/geo-content-optimizer` (2026-09-09) — this is now the estate's single
technique library for making content quotable and citable by AI answer engines (Google AI
Overviews, ChatGPT, Perplexity, Claude, Gemini, Copilot). `toprank/geo-content-optimizer`
points here for SEO-context work; use this skill directly for AEO work with no SEO context.

## CORE-EEAT GEO-First Optimization Targets

These items have the highest impact on AI engine citation. Use as an optimisation checklist
before applying the techniques below.

**Top 6 priority items**:

| Rank | ID | Standard | Why it matters |
|------|----|----------|---------------|
| 1 | C02 | Direct answer in first 150 words | All engines extract from the first paragraph |
| 2 | C09 | Structured FAQ with schema | Directly matches AI follow-up queries |
| 3 | O03 | Data in tables, not prose | Most extractable structured format |
| 4 | O05 | JSON-LD schema markup | Helps AI understand content type |
| 5 | E01 | Original first-party data | AI prefers exclusive, verifiable sources |
| 6 | O02 | Key takeaways / summary box | First choice for AI summary citations |

**All GEO-first items** (optimise for all when possible):
C02, C04, C05, C07, C08, C09 | O02, O03, O04, O05, O06, O09 | R01, R02, R03, R04, R05, R07,
R09 | E01, E02, E03, E04, E06, E08, E09, E10 | Exp10 | Ept05, Ept08 | A08

**AI engine preferences**:

| Engine | Priority items |
|--------|----------------|
| Google AI Overview | C02, O03, O05, C09 |
| ChatGPT Browse | C02, R01, R02, E01 |
| Perplexity AI | E01, R03, R05, Ept05 |
| Claude | R04, Ept08, Exp10, R03 |

## Current-State Assessment Template

```markdown
## GEO Analysis: [Content Title]

### Current State Assessment

| GEO Factor | Current Score (1-10) | Notes |
|------------|---------------------|-------|
| Clear definitions | [X] | [notes] |
| Quotable statements | [X] | [notes] |
| Factual density | [X] | [notes] |
| Source citations | [X] | [notes] |
| Q&A format | [X] | [notes] |
| Authority signals | [X] | [notes] |
| Content freshness | [X] | [notes] |
| Structure clarity | [X] | [notes] |
| **GEO Readiness** | **[avg]/10** | **Average across factors** |

**Primary Weaknesses**: [list]
**Quick Wins**: [list]
```

## The Six Core Optimisation Techniques

### 1. Definition Optimisation

AI systems favour clear, quotable definitions.

**Before** (weak): "SEO is really important for businesses and involves various techniques to
improve visibility online through search engines."

**After** (strong): "**Search Engine Optimization (SEO)** is the practice of optimizing
websites and content to rank higher in search engine results pages (SERPs), increasing organic
traffic and visibility."

**Template**: "[Term] is [clear category/classification] that [primary function/purpose],
[key characteristic or benefit]."

**Checklist**:
- [ ] Starts with the term being defined
- [ ] States the category (what type of thing it is)
- [ ] Explains primary function or purpose
- [ ] Precise, unambiguous language
- [ ] Stands alone as a complete answer
- [ ] 25-50 words for optimal citation length

### 2. Quotable Statement Optimisation

Transform vague content into standalone, citable facts.

**Weak**: "Email marketing is pretty effective and lots of companies use it."

**Strong**: "Email marketing delivers an average ROI of $42 for every $1 spent, making it one
of the highest-performing digital marketing channels."

Types worth building deliberately:
1. **Statistics** — specific number, cited source, timeframe/comparison context.
2. **Facts** — verifiable, unambiguous, attributed to an authoritative source.
3. **Definitions** — see above.
4. **Comparisons** — "Unlike [A], [B] [specific difference], which means [implication]."
5. **How-to steps** — numbered, action-oriented: "To [goal], [step 1], then [step 2]…"

### 3. Authority Signal Enhancement

Add expert attribution and verifiable citations.

**Before**: "Studies show that most people prefer video content."
**After**: "According to Wyzowl's 2024 Video Marketing Statistics report, 91% of consumers
want to see more online video content from brands."

**Elements to add**: author byline with credentials, expert quotes with attribution,
citations to peer-reviewed research, references to recognised authorities, original data or
research, case studies with named companies, sourced industry statistics.

### 4. Structure Optimisation

AI systems parse structured content more reliably than prose.

- **Q&A format** — `## What is [Topic]?` / direct 40-60-word answer / `## How does it work?` …
- **Comparison tables** — feature rows, explicit "best for" row.
- **Numbered lists** — `1. **Step: [Action]** — [explanation]`.
- **Definition boxes** — `> **Key Definition**: [Term] refers to [clear definition].`

### 5. Factual Density Improvement

**Low density**: "Social media marketing is very popular nowadays. Many businesses use it and
find it helpful for reaching customers."

**High density**: "Social media marketing reaches 4.9 billion users globally (Statista, 2024).
Businesses using social media marketing report 66% higher lead generation rates compared to
non-users (HubSpot State of Marketing Report, 2024). The most effective platforms for B2B
marketing are LinkedIn (96% usage), Twitter (82%), and Facebook (80%)."

**Checklist**: specific statistics with sources; exact dates/numbers/percentages; verified
facts in place of vague claims; recent data (within 2 years); multiple data points per
section; cross-referenced against authoritative sources.

### 6. FAQ Optimisation

FAQ sections match question-based AI queries directly and pair well with FAQPage schema.

```json
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [{
    "@type": "Question",
    "name": "[Question text]",
    "acceptedAnswer": { "@type": "Answer", "text": "[Answer text]" }
  }]
}
```

Answers: 40-60 words, direct answer first, one supporting detail/example after.

## GEO Readiness Checklist

**Definitions & Clarity** — key terms defined; definitions stand alone as answers; language
precise and unambiguous.

**Quotable Content** — specific statistics included; facts have source citations; memorable
statements created.

**Authority** — expert quotes or credentials present; authoritative sources cited; original
data or research included.

**Structure** — Q&A sections included; headings match common queries; comparison tables where
relevant; numbered lists for processes.

**Technical** — FAQ schema markup added; content freshness indicated; sources verifiable.

## Worked Example

**Input**: "Email marketing is a good way to reach customers. It's been around for a while and
many businesses use it. You can send newsletters, promotions, and other messages."

**Output**:

> **Email marketing** is a digital marketing strategy that uses email to promote products,
> build customer relationships, and drive conversions. According to the Data & Marketing
> Association, email marketing delivers an average ROI of $42 for every $1 invested, making it
> the highest-performing digital marketing channel.
>
> ### Key email marketing formats include:
> 1. **Newsletters** — regular updates sharing company news, industry insights, and valuable
>    content to maintain subscriber engagement.
> 2. **Promotional emails** — time-sensitive offers, discounts, and product announcements
>    designed to drive immediate sales.
> 3. **Transactional emails** — order confirmations, shipping updates, and account
>    notifications, with 8x higher open rates than marketing emails.
> 4. **Automated sequences** — pre-scheduled email series triggered by user actions, such as
>    welcome series or abandoned-cart reminders.
>
> **Key statistic**: 81% of small businesses rely on email as their primary customer
> acquisition channel (Emarsys, 2024).

Changes made: clear definition added, 2 stats with sources, structured list, DMA/Emarsys
citations, 3 quotable facts. GEO score: 1/10 → 8/10.

## Post-Optimisation Self-Check

| ID | Standard | Status | Notes |
|----|----------|--------|-------|
| C02 | Direct answer in first 150 words | ✅/⚠️/❌ | |
| C04 | Key terms defined on first use | ✅/⚠️/❌ | |
| C09 | Structured FAQ with schema | ✅/⚠️/❌ | |
| O02 | Summary box / key takeaways | ✅/⚠️/❌ | |
| O03 | Comparisons in tables | ✅/⚠️/❌ | |
| O05 | JSON-LD schema markup | ✅/⚠️/❌ | |
| O06 | Section chunking (3-5 sentences) | ✅/⚠️/❌ | |
| R01 | ≥5 precise data points with units | ✅/⚠️/❌ | |
| R02 | ≥1 citation per 500 words | ✅/⚠️/❌ | |
| R04 | Claims backed by evidence | ✅/⚠️/❌ | |
| R07 | Full entity names | ✅/⚠️/❌ | |
| E01 | Original first-party data | ✅/⚠️/❌ | |
| Exp10 | Limitations acknowledged | ✅/⚠️/❌ | |
| Ept08 | Reasoning transparency | ✅/⚠️/❌ | |

## Further reading

- [AI Citation Patterns](ai-citation-patterns.md) — how each engine selects and cites sources.
- [Quotable Content Examples](quotable-content-examples.md) — more before/after pairs.
