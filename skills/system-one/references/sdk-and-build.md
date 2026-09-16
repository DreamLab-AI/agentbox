# SDK, transport, and the build question

Facts gathered 2026-09-16 from PyPI and `https://docs.typesafe.ai/sdk/python.md`.
Re-check before acting: version numbers here move.

## Two ways to call

**The HTTP API.** `POST https://api.typesafe.ai/v1/systemone`, bearer auth, a JSON
body of `state` + `model` + `questions`. That is the whole contract. `httpx` and
`requests` are already in the image closure, so this route needs nothing built.

**The Python SDK** (`typesafe-sdk`, 0.6.0, requires Python >= 3.10). Gives typed
`Choice` / `Noul` / `Score` constructors, a sync `TypeSafeClient` and an async
`AsyncTypeSafeClient`, both context managers, both reading `TYPESAFE_API_KEY` from the
environment and defaulting to `jev-latest`.

## The response-shape discrepancy — read this before writing either

The vendor's own pages disagree, and the disagreement is exactly the kind of detail a
model will confidently get wrong from memory:

- The **quickstart** page reads answers as `response.answers["department"].choice`.
- The **Python SDK** page reads them from **per-primitive collections**:
  `response.nouls["billing"].noul`, `response.choices["tone"].choice`,
  `response.scores["urgency"].score`.

`answers` is the shape of the raw HTTP response body (confirmed on `/api.md`). The
`nouls` / `choices` / `scores` accessors are an SDK-side convenience over it. Do not
assume one from the other; check the installed SDK's own types. This single example is
the whole argument for `live-docs.md` §Why no mirror.

## Adding the SDK to the image — assess before doing

`typesafe-sdk` is not in nixpkgs, and neither, almost certainly, is its HTTP stack. Its
dependency chain:

```
typesafe-sdk 0.6.0
  ├─ httpx2 >= 2.0.0        ← the httpx 2.x line under a NEW distribution name
  │    ├─ httpcore2 == 2.13.0   ← likewise new
  │    ├─ truststore >= 0.10
  │    ├─ anyio >= 4.10, idna >= 3.18
  ├─ msgspec >= 0.21.1
  ├─ tenacity >= 9.0.0
  └─ typing-extensions >= 4.13.0
```

`msgspec`, `tenacity`, `anyio`, `idna` and `typing-extensions` are ordinary nixpkgs
citizens. **`httpx2` and `httpcore2` are not the packaged `httpx`/`httpcore`** — they
are separately-named distributions for the 2.x line and are new enough that they are
very unlikely to be in the pinned nixpkgs. Adding the SDK to the closure therefore
means hand-writing roughly three `buildPythonPackage` derivations (`httpcore2`,
`httpx2`, `typesafe-sdk`), each pinned by SRI hash, each a maintenance obligation on
every bump — and `httpcore2 == 2.13.0` is an exact pin, so the chain moves in lockstep.

**Recommendation: do not put the SDK in the boot closure for this.** The API is one
POST with a JSON body; the typed constructors are convenience, not capability, and the
skill teaches the request shape directly (`primitives.md`). Cheaper routes, in order:

1. **Plain HTTP with the closure's `httpx`.** Nothing to build. This is what
   `../scripts/probe.mjs` should do, and what any service integration should do until
   there is a reason not to.
2. **The code-interpreter kernel's pip layer** (`kernel_install_pkg`) for interactive
   work where the typed constructors genuinely help. Ephemeral, outside the closure.
3. **A project-local venv** in whatever repo actually consumes it.
4. **The Nix closure**, only if a *supervised service* ends up depending on the SDK —
   at which point the derivations are justified and belong beside the existing
   `fetchPypi` precedent in `flake.nix` (see `privacyFilterTransformers` for the
   pattern: pinned version, SRI hash, `doCheck = false`, and a comment recording how
   to bump it).

If (4) is chosen: `nix` is not available in this container, so attribute existence
(`python312Packages ? httpx2`) must be checked on the host, and the build runs through
`./agentbox.sh rebuild`, not from here.

## Unverified

- Whether the pinned nixpkgs carries `httpx2` / `httpcore2` / `truststore` at all.
- Whether `typesafe-sdk` builds with a standard backend (sdist and a `py3-none-any`
  wheel both exist, which is promising).
- The JavaScript SDK: not yet assessed. If the consumer is a Node service, read
  `https://docs.typesafe.ai/sdk/javascript.md` and repeat this assessment.
