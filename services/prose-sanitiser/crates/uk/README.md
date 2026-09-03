# prose-sanitiser-uk

Sense-aware UK-English spelling for
[prose-sanitiser](https://github.com/DreamLab-AI/agentbox), backed by
[VarCon](https://wordlist.aspell.net/varcon-readme/) rather than a hand-written
regex.

The design in one sentence: **span exclusion runs first, then sense
disambiguation, then confidence-tiered fixes.** Only unconditional dialect pairs
with no organisation-name collision may ever be auto-fixed.

## Capability row

| Class | Contents |
|---|---|
| **Detects and strips losslessly** | Nothing. Spelling is not a codepoint classification and no diff can prove a replacement right, so nothing here is ever `certain-mechanical` |
| **Detects, with a replacement offered** | VarCon-certified unconditional pairs outside every excluded span, with no gazetteer collision. Tier `high-confidence-stylistic`, applied only under an explicit `--write` |
| **Detects and reports only** | Sense-dependent pairs, `-our` derivative irregularities, the double-L asymmetries, organisation names and quotations. Tier `low-confidence-judgement`, never auto-fixed |
| **Never touches** | Code fences, inline code, HTML attributes, front matter, URLs, file paths, package names, direct quotations, and non-English spans |

## The data

VarCon (Kevin Atkinson, part of the SCOWL project) encodes region and variant
per spelling: `A` American, `B` British `-ise`, `Z` British `-ize` (Oxford), `C`
Canadian, `D` Australian, with variant-status tags. The property that matters is
that it carries the Oxford/Cambridge split as **two distinct British categories
in one table**, which is precisely the primitive an `--oxford` flag needs.

The licence is Atkinson's own permissive notice, MIT/BSD-equivalent with no
copyleft. The vendored copy, its upstream provenance, a SHA-256 and the
reproduced notice are in `data/`.

Do not substitute LibreOffice's en_GB Hunspell dictionaries: they are
GPL/LGPL/MPL tri-licensed, which would contaminate this crate.

## Example

```rust
use prose_sanitiser_uk::{table, Dialect};

// An unconditional pair: safe to offer a replacement.
let organize = table::lookup("organize").expect("in the table");
assert!(organize.is_unconditional());
assert_eq!(organize.target(Dialect::Ise), Some("organise"));
// Under Oxford spelling the American form is already correct.
assert_eq!(organize.target(Dialect::Oxford), None);

// Correct British English regardless of dialect, so absent entirely.
assert!(table::lookup("sulfur").is_none());
assert!(table::lookup("fetus").is_none());
assert!(table::lookup("dialog").is_none());
```

A sense-dependent word carries its senses rather than a single target, so a
report can say *which* reading it is unsure about instead of guessing.

## The traps this exists to avoid

The rule this replaced was one flat regex including `license`, `meter`,
`catalog` and `fulfill`. It flagged "a driving licence issued to license a
doctor", "gas meter", "dialog box" and "World Health Organization", so it
produced wrong advice roughly half the time on technical prose.

- `licence`/`license` and `practice`/`practise` are a noun-verb split *inside*
  British English, not a dialect swap.
- `meter` is correct British English for an instrument. Only the SI unit is
  *metre*.
- `fulfil` is UK, but *fulfilment* takes one `l` where US *fulfillment* takes
  two. The `-ment` rule inverts the doubling rule.
- `program` stays *program* for software.
- `sulfur` is correct in a technical register, per RSC 1992 and BSI 1993.
- The `-yse` set (*analyse*, *paralyse*, *catalyse*) is unconditional in both
  Oxford and general British, because the root is Greek *lysis*. That falls
  straight out of the data: those VarCon lines carry no `Z` tag.
- The always-ise set (*advertise*, *comprise*, *surprise*, *televise* and the
  rest of the `-cise`, `-mise`, `-vise`, `-prise`, `-guise` roots) is untouched
  by `--oxford`.

## Honest limitation

No published study measures detector or linter false positives on British
English specifically. Until a UK human-prose corpus exists and a per-rule
false-positive rate is published against it, the sense-dependent half of this
crate is advice, not correction. The tier system encodes that in the types
rather than relying on anyone remembering it.

## Licence

MIT OR Apache-2.0, at your option. The vendored VarCon data keeps its own
permissive notice, reproduced in `data/LICENSE-VarCon`.

## Publishing checklist

Publication candidate. Before `cargo publish`:

- [x] `license = "MIT OR Apache-2.0"`, with both licence files present
- [x] `description`, `repository`, `keywords`, `categories`, `readme` set
- [x] Vendored data licence-cleared, attributed, and hash-pinned in `data/`
- [x] Pure Rust: no C dependencies, no subprocesses, no network
- [x] Packaging keeps `data/` in the published `.crate`, so VarCon and its
      notice ship with it. `Cargo.toml` uses `exclude` (dropping `corpora/`)
      rather than an `include` allowlist, so `data/` is carried by default
- [ ] `cargo package --list` confirms `data/varcon.txt` and
      `data/LICENSE-VarCon` are present, and that `corpora/` is not
- [ ] Crate-level `//!` docs carrying the capability matrix rows
- [ ] Every public item documented, with examples that compile
- [ ] `cargo doc --no-deps` clean, with no warnings
- [ ] Trap fixtures green: "World Health Organization", "a driving licence", "to
      license a doctor", "the gas meter read 12 metres", "the computer program",
      "sulfur dioxide", "the dialog box". Assert zero auto-fixes
- [ ] `cargo publish --dry-run` clean
