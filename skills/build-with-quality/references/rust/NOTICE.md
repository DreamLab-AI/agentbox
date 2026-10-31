# Notice — vendored BeautifulRust material

`steering.md`, `review.md`, `port.md`, everything under `sources/` and both files under
`lints/` are adapted from **BeautifulRust** by Morgan Linton.

- Upstream: https://github.com/morganlinton/BeautifulRust
- Pinned revision: `a9cdcfa94d1330c0d41c7f67764c5f7786fbb71d` (vendored 2026-10-31)
- Upstream paths: `skills/rust-best-practices/SKILL.md` and `references/*.md`,
  `skills/rust-review/SKILL.md`, `skills/rust-port/SKILL.md`, `lints/lints.toml`,
  `lints/clippy.toml`

The `sources/` digests are verbatim. The three skill bodies have the estate overlay
added: crypto, publication, feature-set and MSRV rules, the dead-code exception for
ports, and hand-off into build-with-quality's findings intake. Links to upstream paths
point at the vendored copies. The Bevy digest, the evals and the benchmark were not
vendored. To refresh, diff the pinned revision against upstream `main` and re-apply the
overlay, which is marked as section 0 in `steering.md` and `port.md` and section 6 in
`review.md`.

## Licence

MIT License

Copyright (c) 2026 Morgan Linton

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
