# Provenance: the 2026 threat model

What a machine can read off a text or a file after every stylistic edit is done,
what this tool removes, and what it demonstrably cannot. Sourced throughout. As
of 2026-09-03.

This file replaces the old "Watermark Removal" section. That section claimed
three things the tool cannot do, listed at the end under *Claims withdrawn*.

## P1. What actually marks AI output in 2026

Four facts reset the design.

**Anthropic watermarks Claude's text.** Models launched from 2 August 2026 embed
a statistical sampling watermark, applied globally, per
[Anthropic's announcement](https://www.anthropic.com/news/claude-text-watermark).
Anthropic states explicitly that "nothing is added to the text and there are no
hidden characters". Google has watermarked Gemini text since October 2024
([Dathathri et al., *Nature* 634, 2024](https://www.nature.com/articles/s41586-024-08025-4)).
So the dominant mark on text produced today is not an invisible Unicode carrier.
It is a sampling watermark that no third party can detect or remove without the
vendor key.

**No major LLM has a verified vendor Unicode watermark.** The `U+202F` narrow
no-break space seen in GPT-4o-class output is best read as a tokenisation or
typographic artefact, not a deliberate mark. OpenAI's
[provenance post](https://openai.com/index/understanding-the-source-of-what-we-see-and-hear-online/)
confirms its text watermarking method was developed and then shelved. Invisible
Unicode in text is overwhelmingly a *third-party injection* problem: prompt
smuggling, supply-chain attacks, detector evasion. Still worth solving, but a
different problem from vendor watermarking.

**The strongest Unicode carrier is the variation-selector chain.** Paul Butler's
[Smuggling arbitrary data through an emoji](https://paulbutler.org/2025/smuggling-arbitrary-data-through-an-emoji/)
(February 2025) maps the 256 variation selectors onto byte values, so any base
character followed by a selector chain carries an arbitrary byte string that
survives copy and paste. It was used in the real *os-info-checker-es6* npm
supply-chain attack. Reporting *what was hidden* matters more than silently
deleting it, which is why `inspect-text` decodes the payload rather than only
counting carriers.

**Stylistic tells are population-level signals only.** See
[destructive-audit.md](destructive-audit.md) for the catalogue and
[Kobak et al., *Science Advances* 11, eadt3813](https://doi.org/10.1126/sciadv.adt3813)
and the [Pew Research Center Data Labs analysis](https://www.pewresearch.org/data-labs/2026/08/20/how-much-of-the-internet-is-written-with-ai/)
for the measurement. No single marker identifies a document.

## P2. Layer A: invisible Unicode, lossless and verifiable

Deterministic codepoint surgery. The full carrier taxonomy, the protected sets
and the bidi policy live in [unicode.md](unicode.md). The operational summary:

```bash
inspect-text <path>                     # report carriers and decoded payloads
inspect-text <path> --aggressive        # also flag Latin confusables, fullwidth
inspect-text <path> --json              # machine-readable
clean-text <path>                       # strip
clean-text <path> --stats               # strip and report counts on stderr
clean-text <path> --in-place            # overwrite, writing a .bak first
clean-text <path> --aggressive-homoglyphs  # map confusables to ASCII Latin
```

Reads text and refuses binary input by default (`--force-text` overrides, and
will corrupt a real container). Every removal is verifiable: diff the output and
confirm exactly the flagged codepoints are gone and nothing else moved.

Run this first, always. There is no quality trade-off.

## P3. Statistical sampling watermarks: detection and removal, honestly

**The schemes.**
[Kirchenbauer et al. (ICML 2023)](https://arxiv.org/abs/2301.10226) partition the
vocabulary into a green list seeded by hashing preceding tokens plus a secret
key, add a logit bonus to green tokens, and detect with a statistical test on
the green fraction. [Aaronson's Gumbel scheme](https://scottaaronson.blog/?p=10032)
uses exponential-minimum sampling and is distortion-free in expectation.
[Christ, Gunn and Zamir](https://eprint.iacr.org/2023/1661.pdf) formalise
cryptographically undetectable watermarks.
[SynthID-Text](https://www.nature.com/articles/s41586-024-08025-4) replaces
green-list biasing with tournament sampling and is the direct ancestor of
Anthropic's Claude watermark.

**Detection without the key: no.** Every deployed scheme requires the secret key
or PRF seed for its detection procedure. That is the design point, not an
oversight. Anthropic's detection API is a private preview gated to regulators,
researchers and fact-checkers. Unkeyed stylometry (token-frequency skew,
repeated n-gram bias, entropy outliers) does not read the cryptographic
watermark and is demonstrably unreliable. The one demonstrated key-free route is
watermark stealing
([Jovanović, Staab and Vechev](https://arxiv.org/html/2402.19361v2)): roughly
200,000 tokens of API queries approximate the green-list rules well enough to
spoof or scrub. That is a red-team exercise needing vendor API access and almost
certainly breaching terms of service. It is not a feature this tool ships.

**Removal: only by changing tokens.**
[DIPPER (Krishna et al., NeurIPS 2023)](https://arxiv.org/abs/2303.13408) drops
DetectGPT accuracy from 70.3 to 4.6 per cent at 1 per cent FPR, and a
green-list-aware variant pushes UNIGRAM-WATERMARK TPR
[below 10 per cent](https://aclanthology.org/2024.emnlp-main.1005.pdf). The
theoretical result is
[Zhang et al., "Watermarks in the Sand" (ICML 2024)](https://arxiv.org/abs/2311.04378):
given a quality oracle and a perturbation oracle, a generic attack strips *any*
watermark meeting a basic low-FPR property, including private-key schemes, with
only minor quality loss. A rebuttal notes the attack needs many iterations and
near-perfect oracles, so practical robustness today exceeds the asymptotic case.

**The honest claim.** These watermarks are defined entirely by which tokens the
model selected. Every demonstrated removal changes tokens. No lossless,
token-preserving removal exists or is claimed anywhere in the literature. This
tool cannot detect a sampling watermark and cannot guarantee removal of one. It
can say only that paraphrase-style rewriting degrades such a watermark as a side
effect of changing tokens, and that this is lossy and unverifiable.

## P4. The optional rewrite (lossy)

`rewrite-text` is a model-backed paraphrase. Its honest use is readability, not
evasion: `simplify` and `declaudish` are the ones worth reaching for. Any
watermark degradation is a side effect you cannot measure.

```bash
rewrite-text <path>                          # paraphrase (default)
rewrite-text <path> --strength simplify      # plain English, short sentences
rewrite-text <path> --strength declaudish    # Claude-specific tells
rewrite-text <path> --strength simplify --context "the original question"
rewrite-text <path> --candidates 3           # generate 3, keep most diverged
rewrite-text <path> --min-chars 200          # skip short texts
```

| Strength | What it does |
|---|---|
| `paraphrase` | Sentence-level restructuring. The default |
| `simplify` | Plain English, short sentences. Best for readability |
| `declaudish` | Targets Claude-specific structural tells (see B13) |
| `humanize` | Rewrites for natural reading flow |
| `structural` | Reorders and reshapes at paragraph level |
| `backtranslate` | Round-trips through a pivot language (`--lang`, default French) |
| `code` | Preserves code blocks, rewrites surrounding prose |

`--context` injects the original question, truncated to 800 characters, so the
model knows what the prose is trying to answer. Backends: `print-prompt`
(default, emits the prompt for manual use), `ollama`, `openai-compatible`. Set
via `WATERMARKS_REWRITE_BACKEND`. There is deliberately no `--api-key` flag:
keys on argv are visible in `ps` and shell history, so use
`WATERMARKS_REWRITE_API_KEY`. Non-loopback endpoints are denied unless
`--allow-remote` is passed.

Run it last, after every deliberate editorial choice, and review the output for
meaning drift.

## P5. Container metadata: lossless surgery

This is the part that genuinely removes provenance, byte-for-byte verifiably.

```bash
inspect-file <path>          # report metadata found
clean-file <path>            # strip it
clean-file <path> --json --in-place
clean-file <path> --keep-non-ai-metadata   # images: drop only C2PA/AI segments
inspect-image <path> / clean-image <path>
```

| Mark | Where it lives |
|---|---|
| C2PA JUMBF manifest | JPEG `APP11` (multi-segment per JPEG XT), PNG `caBX` before `IDAT`, WebP/RIFF `C2PA` chunk, PDF embedded file with `AFRelationship = C2PA_Manifest`, SVG `c2pa:manifest` in `<metadata>`, BMFF `uuid` box, TIFF IFD tag, ID3v2 `GEOB` |
| EXIF, XMP, Extended XMP, IPTC/Photoshop IRB | Image containers |
| PNG `tEXt`/`iTXt`/`zTXt`, `tIME`, GIF comment extension | Image containers |
| PDF `/Info` and `/Metadata` | The document catalogue |
| OOXML `docProps/core.xml`, `app.xml`, `custom.xml`, `word/comments.xml`, `w:ins`/`w:del`, `rsid` | The ZIP parts |
| ODF `meta.xml` | The ZIP part |

Two structural traps the implementation handles, and you should know about:

- **PDF incremental updates append rather than rewrite.** A naive metadata edit
  leaves the original `/Info` and `/Metadata` objects fully recoverable earlier
  in the byte stream. Only a full object-graph rewrite on save removes them.
- **ZIP round-trip is itself a fingerprint.** Every untouched entry must keep its
  original compression method and relative order. A re-zip that reorders
  alphabetically or recompresses is a detectable "repacked by a non-Office tool"
  signal. `docProps/app.xml` in particular carries `Application`, `Company` and
  `TotalTime`, which is a strong behavioural fingerprint.

**Pixel data is never re-encoded.** A metadata strip must leave the decoded
image pixel-exact. If pixels changed, that is a bug, not a feature.

`c2patool`, `exiftool` and `qpdf` are used as an optional cross-check when
present on `PATH`. They are not the implementation.

## P6. Durable Content Credentials: stripping is not unlinking

The load-bearing honesty fact of this whole file.

C2PA (specification 2.4, April 2026,
[spec.c2pa.org](https://spec.c2pa.org/specifications/specifications/2.4/specs/C2PA_Specification.html))
defines a **soft binding** as "a content identifier that is either not
statistically unique, such as a fingerprint, or embedded as an invisible
watermark", and a **Durable Content Credential** as one whose soft bindings
enable discovery in a manifest repository. The
[Soft Binding Resolution API](https://spec.c2pa.org/specifications/specifications/2.4/softbinding/Decoupled.html)
lets a validator that finds a stripped asset detect the surviving watermark,
query a key-value store for the right repository, and retrieve the original
signed manifest. Adobe runs a live implementation, the
[CAI Soft Binding Resolution API](https://developer.adobe.com/cai-soft-binding-api/),
which for TrustMark-watermarked assets returns the full manifest store.

So: this tool removes the manifest from the container, verifiably. It cannot
know whether a soft binding exists, and removing the manifest does not defeat
one. **A clean container is not an anonymous file.**

Who emits C2PA in 2026: OpenAI (DALL-E 3 onwards, and since May 2026 SynthID as
a second pixel-domain layer), Google (SynthID across Imagen, Veo, Lyria and
Gemini text; C2PA on Gemini 3 Pro image models), Adobe Firefly (paired with
TrustMark), Microsoft Designer and Bing, cameras from Leica, Sony, Nikon, Canon
and Samsung. TikTok, YouTube and LinkedIn read and display incoming credentials.

Note also that C2PA *redaction* is a different thing: it removes one assertion
from a prior ingredient's manifest inside the signed chain, and is itself logged.

## P7. Pixel-domain watermarks: out of scope

[SynthID-Image](https://arxiv.org/html/2510.09263v1) is a post-hoc
encoder-decoder carrying a 136-bit payload, deployed across more than ten
billion images. [Stable Signature](https://arxiv.org/abs/2303.15435) fine-tunes
the latent decoder so every output carries a 48-bit signature.
[Tree-Ring](https://proceedings.neurips.cc/paper_files/paper/2023/file/b54d1757c190ba20dbc4f9e4a2f54149-Paper-Conference.pdf)
embeds in the Fourier transform of the initial noise vector.
[TrustMark](https://arxiv.org/abs/2311.18297) is a GAN encoder-decoder with a
100-bit payload above 40 dB PSNR.

Each needs a proprietary trained decoder or diffusion inversion, so this tool
neither detects nor removes them. The
[WAVES benchmark](https://arxiv.org/html/2401.08573v3) (26 attacks) found
StegaStamp most robust, Stable Signature most vulnerable to regeneration, and
Tree-Ring severely broken by grey-box adversarial attack. Guided diffusion
regeneration drives all tested schemes to 0 per cent decode success
([arXiv:2511.05598](https://arxiv.org/html/2511.05598v1)), but that needs a
pretrained diffusion model and a GPU, and the arms race has moved on: a
late-2026 paper reports detecting *that removal occurred* at over 98 per cent
TPR at 1 per cent FPR across six removal methods
([arXiv:2605.09203](https://arxiv.org/html/2605.09203v1)).

Removing a pixel watermark is therefore not a clean win even when it works. It
trades one detectable signal for another.

## P8. The torch harnesses and what they actually prove

Four optional Python programs wrap model stacks that only exist in Python. The
Rust locates them, runs them under resource caps and parses their JSON back.
They are found via `$PROSE_SANITISER_SCRIPTS_DIR`, else the baked skill
directory, and each needs its own external checkout.

| Script | Wraps | What it proves |
|---|---|---|
| `detect_text_watermark.py` | [MarkLLM](https://arxiv.org/abs/2405.10051) | That a **self-applied** mark, with a **known key**, was cleared by a given rewrite. It says nothing about any vendor's production watermark |
| `score_synthid.py` | reverse-SynthID | A confidence score from a third-party reimplementation, not a keyed detection. Treat as a weak signal |
| `markdiffusion_harness.py` | MarkDiffusion | Detects and purifies image watermarks *it applied itself*, on the same terms |
| `clean_ctrlregen.py` | CtrlRegen | Diffusion regeneration of image pixels. Lossy, GPU-bound, and itself detectable |

The closed loop is genuinely useful for **calibrating how much rewriting it
takes** to break a watermark of a known class and strength. It is not evidence
that a vendor mark has been cleared, and must never be reported as such. The
crate's own accessible test of quality is the deterministic layer: byte-exact
round-trips, pixel-exact images after a metadata strip, and zero false positives
on legitimate Unicode.

## P9. Aggregate auditing and the service

```bash
audit-dir <directory> [--json] [--skip node_modules,dist]
audit-website --base <url> [--max-pages N] [--json]
audit-website --sitemap <url>
```

The HTTP service exposes the same pipeline for CI. `prose-sanitiser-server`
binds loopback by default with an optional bearer key.

| Endpoint | Purpose |
|---|---|
| `GET /health` | Service status and version |
| `GET /capabilities` | Which optional tools and backends are present |
| `GET /openapi.json` | The generated OpenAPI 3.0.3 spec |
| `POST /inspect` | Analyse a file. `{"file": "<base64>", "name": "notes.md"}` |
| `POST /clean` | Strip and return the cleaned bytes |

| Variable | Purpose |
|---|---|
| `WATERMARKS_SERVER_API_KEY` | Bearer token for the service |
| `WATERMARKS_REWRITE_BACKEND` | `print-prompt`, `ollama`, `openai-compatible` |
| `WATERMARKS_REWRITE_MODEL` | Model name for the rewrite |
| `WATERMARKS_REWRITE_BASE_URL` | API base URL for the rewrite backend |
| `WATERMARKS_REWRITE_API_KEY` | API key. Environment only, never argv |
| `WATERMARKS_REWRITE_ALLOW_REMOTE` | `1` to permit non-loopback endpoints |
| `PROSE_SANITISER_SCRIPTS_DIR` | Where the torch harnesses live |

## P10. Ordering, and residual risk

1. Layer A Unicode. Lossless, first, always.
2. Editorial work, then `slop-scan`, then the human read.
3. The optional rewrite, last among text passes, because it changes wording.
4. Container metadata strip, after final export, before publication.

What remains after all of it: any sampling watermark in text you did not
rewrite, any soft binding that links a stripped asset back to its manifest, any
pixel-domain mark, audio and video watermarks, and training-data backdoors. No
tool can certify that vendor detectors will fail after processing, and this one
does not try.

## Claims withdrawn

Three statements in the previous version of this file were wrong and have been
removed rather than softened.

1. **"Statistical sampling fingerprints" as something the tool strips.** It
   cannot, and no third party can. Corrected in P3.
2. **"Proving the mark was cleared in a closed loop."** The MarkLLM harness
   proves a self-applied mark with a known key was cleared. Corrected in P8.
3. **Pixel-domain watermark removal as a capability of this tool.** It is an
   external GPU dependency, it is now itself detectable at over 98 per cent TPR,
   and stripping a manifest does not defeat a durable Content Credential anyway.
   Corrected in P6 and P7.
