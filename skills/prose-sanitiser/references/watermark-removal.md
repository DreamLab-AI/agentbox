# Section E — Watermark Removal (Technical Provenance Marks)

Strip machine-readable AI provenance marks that survive every stylistic edit. A text
can score zero on the slop scanner and still be flagged by vendor detectors through
invisible Unicode, statistical sampling patterns, or embedded file metadata.

Source: [guillaumemeyer/watermarks-remover](https://github.com/guillaumemeyer/watermarks-remover)
(MIT, Python 3.10+, stdlib-only core).

## E1. Layer A — Deterministic Unicode Removal

Invisible Unicode carriers injected during generation: zero-width spaces (U+200B),
zero-width joiners/non-joiners (U+200C/D), bidirectional marks (U+200E/F, U+202A–E,
U+2066–9), tag characters (U+E0001–E007F), word joiners (U+2060), and exotic whitespace
(U+00A0, U+2000–200A, U+205F, U+3000). These are invisible in every editor and
browser but trivially detectable by automated scanners.

Layer A removals are verifiable — diff the before/after to confirm every carrier is gone.

```bash
python3 inspect_text.py <path>           # report invisible characters found
python3 clean_text.py <path>             # strip them in-place
python3 clean_text.py <path> --stats     # strip + report character counts
```

Reads `.md`, `.html`, `.txt` and plain text. Refuses binary input by default
(`--force-text` overrides).

**Priority:** Run Layer A first, always. It is lossless and deterministic — there is
no quality trade-off.

## E2. Layer B — Statistical Watermark Attack

Token-sampling watermarks (SynthID, Kirchenbauer-family, etc.) embed a signal in the
probability distribution of generated tokens. The signal survives copy-paste and light
editing but degrades under paraphrase and structural rewriting.

Layer B performs agent-driven text rewriting to break the statistical signal. It is
lossy — the output is a paraphrase, not the original text — and best-effort: no tool
can certify that vendor detectors will fail after rewriting.

```bash
python3 rewrite_text.py <path>                          # default strength
python3 rewrite_text.py <path> --strength minimal       # lightest touch
python3 rewrite_text.py <path> --strength paraphrase    # mid-range
python3 rewrite_text.py <path> --strength aggressive    # maximum divergence
python3 rewrite_text.py <path> --candidates 3           # generate 3, pick most diverged
```

Strength levels:

| Level | Use when |
|-------|----------|
| `minimal` | Light synonym substitution; preserves voice closely |
| `default` | Sentence-level restructuring; good general choice |
| `paraphrase` | Paragraph-level rewrite; changes cadence noticeably |
| `humanize` | Rewrites for natural reading flow |
| `code` | Preserves code blocks, rewrites surrounding prose |
| `balanced` | Middle ground between fidelity and divergence |
| `aggressive` | Maximum structural change; verify meaning afterwards |

Backends: `print-prompt` (default, outputs the rewrite prompt for manual use),
`ollama` (local model), or `openai-compatible` (any API endpoint). Set via
`WATERMARKS_REWRITE_BACKEND` env var.

**When to use:** After Layer A (Unicode) and the stylistic audit (Sections A–D).
Layer B is the last pass because it changes wording — run it after all deliberate
editorial choices are made. Review the output for meaning drift.

## E3. File Metadata Stripping

AI-generated files carry provenance metadata beyond the text content:

| Mark type | Where | Tool |
|-----------|-------|------|
| C2PA manifests | Images, PDFs, video | `c2patool` (auto-detected) |
| EXIF/XMP | Images, PDFs | `exiftool` (auto-detected) |
| Document properties | DOCX, ODT | Built-in (stdlib) |
| PDF structure | Linearisation, XRef | `qpdf` (structural rebuild) |

```bash
python3 inspect_file.py <path>           # report all metadata found
python3 clean_file.py <path>             # strip metadata in-place
python3 clean_file.py <path> --stats     # strip + report what was removed
```

Unified file router — dispatches to the correct handler by MIME type. Supported
formats: Markdown, HTML, plain text, PNG, JPEG, WebP, SVG, PDF, DOCX, ODT.

**System tools:** `c2patool`, `exiftool`, and `qpdf` are auto-used when present on
PATH. Without them, the tool still removes what it can (document properties, basic
EXIF) but may miss deep PDF metadata or C2PA manifests.

## E4. Pixel-Domain Watermark Removal (Optional)

Image watermarks embedded in pixel data (SynthID, StegaStamp, Tree-Ring,
StableSignature) require neural regeneration backends. These are external, never
bundled, and need GPU resources.

```bash
python3 clean_image.py <path> --remove-pixel ctrlregen     # CtrlRegen backend
python3 clean_image.py <path> --remove-pixel diffusion      # MarkDiffusion backend
python3 inspect_image.py <path>                             # Reverse-SynthID confidence score
```

| Backend | Source | What it attacks |
|---------|--------|-----------------|
| CtrlRegen | `mertizci/noai-watermark` | SynthID-class, StegaStamp, Tree-Ring, StableSignature |
| MarkDiffusion | `THU-BPM/MarkDiffusion` | Blind regeneration (diffusion-based) |
| Reverse-SynthID | `aloshdenny/reverse-SynthID` | Detection/scoring only (no removal) |

**When to use:** Only for images where pixel-level watermark removal is specifically
needed. Not part of the standard prose workflow. Requires external setup
(`setup_synthid.sh`, `setup_ctrlregen.sh`, `setup_markdiffusion.sh`).

## E5. Verification Harness

After stripping, verify the marks are actually gone. The MarkLLM harness applies a
known watermarking scheme (KGW, SynthID-Text) to sample text, runs the rewrite, then
re-detects — proving the mark was cleared in a closed loop.

```bash
python3 detect_text_watermark.py <path>              # MarkLLM text watermark detection
python3 score_synthid.py <path>                      # standalone SynthID confidence score
python3 markdiffusion_harness.py detect <image>      # MarkDiffusion image watermark check
```

The verification scripts require external checkouts (`setup_markllm.sh`,
`setup_markdiffusion.sh`) and are not needed for routine sanitisation — use them
when you need evidence that a specific watermarking scheme has been defeated.

## E6. Aggregate Auditing

Scan entire directories or websites for provenance marks across all file types:

```bash
python3 audit_dir.py <directory>         # recursive scan of a file tree
python3 audit_website.py <url>           # crawl and scan a published site
```

Useful for pre-publication sweeps of documentation sites, blog repos, or asset
directories.

## E7. HTTP Service API

For programmatic or CI integration, the watermarks-remover runs as a service.
Published to GHCR (`ghcr.io/guillaumemeyer/watermarks-remover`); also runs standalone
as `python3 server.py` without Docker.

```bash
docker run --rm -p 127.0.0.1:8765:8765 ghcr.io/guillaumemeyer/watermarks-remover
python3 server.py                                    # no Docker alternative
```

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/health` | GET | Service status |
| `/capabilities` | GET | Available tools and backends |
| `/inspect` | POST | Analyse a file for provenance marks |
| `/clean` | POST | Remove marks and return cleaned file |

Input: `{"file": "<base64>", "name": "notes.md"}`.
Output: `{"ok": true, "kind": "text/markdown", "cleaned": "<base64>", "report": {...}}`.

Environment variables for the service:

| Variable | Purpose |
|----------|---------|
| `WATERMARKS_SERVICE_URL` | Service endpoint (default `http://127.0.0.1:8765`) |
| `WATERMARKS_SERVER_API_KEY` | Bearer token for the HTTP service |
| `WATERMARKS_REWRITE_BACKEND` | `print-prompt` / `ollama` / `openai-compatible` |
| `WATERMARKS_REWRITE_MODEL` | Model name for Layer B (e.g. `llama3.2`) |
| `WATERMARKS_REWRITE_BASE_URL` | API base URL for the rewrite backend |
| `WATERMARKS_REWRITE_API_KEY` | API key (env-only, never CLI argv) |
| `WATERMARKS_REWRITE_ALLOW_REMOTE` | `1` to allow non-loopback endpoints |

## E8. Residual Risk

Layer A removals are verifiable and lossless. Layer B rewrites are best-effort and
degrade prose quality — prefer Layer A only for production content where voice matters.
Out of scope: soft-binding C2PA (remote manifest re-linkage), audio/video watermarks,
and training backdoors. No tool can certify that vendor detectors will fail after
processing.

## E9. Ordering Within the Full Sanitisation Pipeline

The recommended order when using all capabilities together:

1. **Layer A** (Unicode) — lossless, run first, always
2. **Stylistic audit** (Sections A–D) — editorial choices on wording and structure
3. **slop_scan.py** — mechanical tell detection
4. **Layer B** (statistical rewrite) — last, because it changes wording
5. **File metadata strip** — after final export, before publication
6. **Pixel removal** — only if images carry pixel-domain watermarks
