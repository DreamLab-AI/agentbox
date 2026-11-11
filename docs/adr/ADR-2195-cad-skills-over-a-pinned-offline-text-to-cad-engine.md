---
id: ADR-2195
title: CAD, electronics and fabrication skills run over a pinned, offline text-to-cad engine
date: 2026-11-11
decision_status: accepted
implementation_status: complete
activation_status: staged
supersedes: []
superseded_by: []
verified_commit: 04638a618a594e7087b29d72ba6419bfef40374e
verified_paths: []
owner: jjohare
review_trigger: the first image built with `[skills.spatial_and_3d] cad = true` (run `AGENTBOX_RC_LIVE=1 bash tests/config/cad-launcher.test.sh`; a pass moves activation to live, a failure is fixed in lib/cad.nix); a text-to-cad release that removes `CAD_UPDATE_FIND_LINKS` or changes how the kernel environment is made; a need for the live viewer or the MCP server; model scripts regularly needing packages outside the lock
repo: agentbox
domain: GOVERNANCE-capabilities
relates: [ADR-2137, ADR-2142, ADR-2177, ADR-2192, ADR-2193]
evidence_class: test+runtime
acceptance_boundary: The launcher, the lock and six integrations were exercised end to end in this container against a hand-built wheelhouse made from the committed lock, offline. The Nix derivation, the supervised program, Xvfb with Mesa GLX (so every snapshot), EEVEE, OrcaSlicer and the /usr/share/fonts link were written without a Nix evaluator and have never been built or run. Both gates are off, so none of it is in any image.
---

# ADR-2195: CAD, electronics and fabrication skills run over a pinned, offline text-to-cad engine

## Context

The estate had no skill for mechanical CAD, stress analysis, circuit boards, slicing or robot descriptions. [text-to-cad](https://github.com/earthtojake/text-to-cad) 0.11.8 (MIT) fills that: eight skills that are instructions over one `cad` command, which is about 150,000 lines of Python on PyPI (`cad`, `cad-server`, `cad-mcp`) driving build123d and OpenCASCADE, and through wheels netgen, CalculiX, KiCad, MuJoCo and Blender's `bpy`.

As shipped it does not fit a pinned image. It installs itself with `curl | sh`, edits every agent app's configuration, resolves its kernel from PyPI at first use with no lock, sends usage statistics by default, and updates itself hourly. Its daemon forks from the first command. Its wheels are foreign binaries that expect libraries on the loader path, which a Nix image does not provide. It needs Python 3.13; the image has 3.12.

## Decision

1. **Nothing is vendored or ported.** The tool is a wrapper over Python-only modules, so it stays Python and stays upstream's. Seven skills are adapted: `cad`, `cad-drawing`, `cad-fea`, `cad-robot`, `cad-pcb`, `cad-print`, `cad-render` (one prefix, as `ontology-*` and `github-*`). `sendcutsend` is not adopted. The mapping and every estate difference are in `skills/cad/references/agentbox.md`; each skill keeps its upstream `LICENSE`.
2. **The closure is a hash lock.** `config/cad/wheels.lock.json` names one wheel per package (96, about 0.9 GB) by PyPI URL and sha256, for CPython 3.13 on x86_64 manylinux, written by `scripts/cad-wheels-lock.js`. `lib/cad.nix` turns each into a `fetchurl`, so the image build verifies every hash, and links them into one wheelhouse. No sdist is ever built.
3. **The launcher is the policy.** `cad` on PATH is `config/cad/cad-launcher.sh`. It installs `cad-server` once, offline, from the wheelhouse into a venv on the workspace volume keyed by lock and interpreter; exports `UV_OFFLINE=1`, `UV_NO_INDEX=1`, `UV_FIND_LINKS` and `CAD_UPDATE_FIND_LINKS` so every later environment comes from the same wheels; sets `DO_NOT_TRACK=1`, `CAD_TELEMETRY=0`, `CAD_UPDATE_CHECK=0`; hides `DISPLAY`; and refuses `setup`, `update`, `uninstall`, `plugin`, `telemetry on|off` and `doctor` without `--check`.
4. **No online mode.** A model script's dependency outside the lock fails. A per-command switch was built and removed: the supervised engine resolves environments itself with the environment it was started in, so the switch had no effect (tested). A package is added through the lock and a rebuild.
5. **The daemon is supervised.** `[program:cad-engine]` runs `cad server` as devuser on `127.0.0.1:3245`.
6. **Gated, and off.** `[skills.spatial_and_3d] cad` gates the package set, the supervisor block and `/usr/share/fonts`; `cad_print` (requires `cad`) adds OrcaSlicer. Both ship `false`: the Nix is unevaluated, and Nix's laziness means that off it cannot break an image build. Off, the image still gains `ENABLE_CAD=false` and the seven skill folders, which the router can pick; each skill's first instruction is to check `command -v cad`.
7. **Not in this cut:** the live viewer (loopback-only, so the browser sidecar cannot reach it; snapshots and exported files stand in), the MCP server, and Bambu printer hand-off (a desktop app on the person's own computer).

## Consequences

- The image grows by about 0.9 GB with the gate on, and the workspace volume by up to 2.4 GB once every integration has been used.
- The baked wheels are covered by the image's evidence (ADR-2137); the environments made from them live on the volume and are not.
- `CAD_UPDATE_FIND_LINKS` is described upstream as a test seam. A release that drops it would send the kernel install to an index that is not configured, and fail closed.
- Licences run as separate programs, never linked into agentbox code: OCP LGPL-2.1, `bpy` and KiCad GPL-3.0-or-later, CalculiX GPL-2.0-or-later. KiCad is a 10.99 nightly (`kicode`); a board it saves may not open in a stable KiCad.
- `cad-pcb` is the estate's first electronics skill. There was no existing board or firmware skill to cross-link; it links to `cad`, `cad-drawing`, `cad-print`, `cad-render`, the diagram skills and `web-researcher`.
- `cad-render` and `blender` both render. The first is headless inside the CAD engine; the second is the interactive Blender in the GPU sidecar. Their descriptions say which is which.
- Divergence from upstream is confined to frontmatter, the setup paragraph, an "In agentbox" section per skill, the show-the-model paragraph, and the print skill's install and printer sections. Upstream text further down still mentions download sizes and the viewer; the "In agentbox" sections override it.

## Verification

Verified on an uncommitted working tree on top of `04638a618a594e7087b29d72ba6419bfef40374e`; `verified_commit` names that base and `verified_paths` is empty until the record is re-stamped at its own commit.

- `bash tests/config/cad-launcher.test.sh`: 35 passed (live half skipped).
- An independent review found three defects fixed before commit: the refusals ran after a `uv` check (so the test would fail on a CI runner without uv); one sentence in `skills/cad/SKILL.md` still told the agent to hand over the loopback page; the lock generator would accept free-threaded (`cp313t`) and `cp314-abi3` wheels on regeneration (the committed lock had none).
- The listener address `127.0.0.1:3245` is upstream's default; neither the launcher nor the supervisor block sets it.
- Whether the font scan follows the `/usr/share/fonts` links is unbuilt; in scratch a symlinked font folder under `~/.fonts` was followed and the text rendered.
- Offline, network proxied to a dead port, through the launcher against a wheelhouse downloaded from the lock with every sha256 checked: first install; model build (6.8 s cold); STEP and STL export; `cad model dfm --process cnc`; an engineering drawing whose text renders once a font folder is in the scan path; a netgen + CalculiX solve (84.0 MPa, safety factor 3.2); `kicad-cli version` 10.99.0; MuJoCo 4.0.0 stepping a model; `bpy` 5.2.3 listing three GPUs under OptiX and CUDA and rendering the bracket with Cycles on the GPU in 18.5 s; `cad server` in the foreground with a later command attaching to it.
- `cad telemetry status`: off. `cad update auto status`: off.
- Shared libraries the wheels needed, found by loading them: libstdc++, libGL, libX11, expat, zlib for OCP; libXrender, libXfixes, libXi, libxkbcommon, libSM, libICE more for `bpy`.
- `bash skills/lint-skills.sh`: clean, 141 skills. `node scripts/skill-count-check.js`, `node scripts/agentbox-config-validate.js agentbox.toml`, `node skills/gen-routing-table.mjs --check`: pass.
- Failed here and expected to pass only in a built image: `cad model snapshot` ("window Visual does not support GL rendering": the container's Xvnc has no GLX and there is no Xvfb), and the stress study's result pictures for the same reason.
- Not run: OrcaSlicer, EEVEE, the robot skill beyond importing MuJoCo, any PCB beyond `kicad-cli version`, routing accuracy for the seven new descriptions.
