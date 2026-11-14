# Step 3: literature review

Find the papers the outline's strategy calls for, verify that each one exists
and predates the cutoff, then write the Introduction and Related Work citing
almost all of them. The rules are the paper's (arXiv:2604.05018, Appendix
D.3). The search and existence checks are `web-researcher`'s.

## 1. Discover

For each `search_directions` entry and each cluster's
`limitation_search_queries`, call `web-researcher` `academic_search` (the
`academic` lens). Use `citation_graph` to walk forwards and backwards from the
two or three anchor papers of each cluster. For a field you do not know, run
`deep-research` on the cluster question first and take its verified sources as
candidates.

Collect candidates as `{key, claimed_title, authors, year, source_query,
discovered_for}`; `discovered_for` is `intro` or the related-work subsection.
Aim for 20 to 40 candidates.

## 2. Verify

Every candidate is checked; nothing enters the bibliography on a model's
recollection.

1. **Exists.** `web-researcher` `verify_citation` for each candidate. Record
   the title, date, DOI or arXiv id and abstract it returns.
2. **Is the same paper.** Title similarity must be strictly above 70 of 100:

   ```bash
   paper-orchestra verify-refs --candidates candidates.json --cutoff 2026-11-01
   ```

   A short claimed title (under four words) that is a substring of the found
   title passes. Anything else below threshold is dropped, not corrected by
   guesswork.
3. **Has an abstract.** No abstract, no entry: the writing step grounds each
   citing sentence in the abstract.
4. **Predates the cutoff**, strictly. The cutoff is the date the paper's
   claims are frozen (normally today). A year with no month counts as 31
   December of that year.
5. **Is not a duplicate.** One entry per DOI, else per arXiv id without
   version, else per normalised title.

The survivors are `citation_pool.json`. Build `refs.bib` from it with
`web-researcher` `format_bibliography`, then `audit_bibliography` on the
result. A reference that only one index knows is kept but marked for the
author to check by hand.

## 3. Write Introduction and Related Work

One call with [prompt-literature-review.md](prompt-literature-review.md) and
the anti-leakage prompt, given the pool with abstracts. Output
`drafts/intro_relwork.tex`.

- Cite only keys in the pool.
- Each citing sentence says something specific that the abstract supports.
  "Several works study X [1-9]" is a citation dump and fails the reverse
  outline.
- Each related-work subsection ends by stating the gap this paper fills.

## 4. Coverage

```bash
paper-orchestra citation-coverage --tex workspace/drafts/intro_relwork.tex \
    --pool workspace/citation_pool.json --threshold 0.90
```

At least 90% of the pool must be cited. On failure, re-prompt with the list of
uncited keys and where each belongs; do not remove existing citations. After
three attempts, either drop from the pool the papers that turned out not to
be relevant (saying so in the report) or proceed with the warning. Padding a
sentence to reach the number is worse than missing it.

## Refine mode

An existing paper already has a bibliography. The useful checks there are
`paper-orchestra orphan-cites` and `web-researcher` `audit_bibliography` on
the `.bib`. Run the discovery step only if the reviewer finds a missing line
of prior work, and verify anything added exactly as above.
