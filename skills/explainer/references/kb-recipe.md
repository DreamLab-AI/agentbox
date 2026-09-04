# The AI half: knowledge base recipe

## Where it lives

RuVector (`ruvector-postgres`, table `memory_entries`), namespace **`<repo>-kb`**,
embedded client-side with bge-small-en-v1.5 (384-dim) via Xinference, so the corpus
sits in the same space as every other memory row and `memory_search({namespace})` works
from any agent. Keys are content-addressed (`<repo>/<tree>/<sha256-12>`) so re-ingest
embeds only changed chunks and prunes the absent ones.

The ingest mirrors `agentbox/scripts/ruvnet-brain-ingest.mjs` (multi-row upsert,
Xinference batch embedding, unpaired-surrogate sanitising, retry then bisect). That
script is the sanctioned bulk path; single-row `memory_store` is for facts, not corpora.
Never write into a protected namespace (`ruvnet-kb`).

## Scope boundary (binding)

Index **only the repo's own authored tree**. Exclude vendored or tenant code (keep its
top-level README as the one exception), `node_modules`, build output, coverage, `.git`,
lockfiles, generated clients, `*.tsbuildinfo`, tool state directories. Read `.gitmodules`
and exclude every submodule path. Over-ingestion both breaks builds and teaches the
learner the wrong tool.

## Chunking (binding)

- Split at structure boundaries: function / class / exported const for code, headings
  for Markdown, per service block for compose and Caddy files. Keep a doc-comment with
  the symbol it documents.
- ≤ 512 tokens per chunk; bge-small embeds only the first ~2,000 characters, so
  front-load the searchable fact.
- Tag every passage: `source_type ∈ {src|test|doc|config|adr}`, tree, repo-relative path.
- Tests and examples are **in**; they answer "how do I actually call this".

## Files (ringfenced)

The scripts live in this skill and are pointed at the target; only the question sets and
a README live in the target's `docs/explainer/kb/`.

```
agentbox/skills/explainer/scripts/kb/
├─ build-passages.mjs   <target-root> <out.jsonl>       tree → passages (zero npm deps)
├─ ingest.mjs           <passages.jsonl> <namespace>    passages → RuVector (mirrors the ruvbrain ingest)
└─ grade.mjs            <namespace> <questions.jsonl…>  gate A via memory_search

<target>/docs/explainer/kb/
├─ README.md            says the KB is DreamLab-held instrumentation and how to ask it
└─ questions/{tuned,heldout}.jsonl
```

Question line: `{"id","stage":1-7,"q","wantPaths":[…],"mustContain":[…],"forbidden":[…]}`.
Every `mustContain` token is read from source before the question is written.

## After every ingest (index law)

Non-concurrent HNSW rebuild on `memory_entries` (`m=16, ef_construction=128`); never
`CREATE INDEX CONCURRENTLY` on the ruvector AM; then the recall gate. Memory writes block
for five to seven minutes, so schedule it.
