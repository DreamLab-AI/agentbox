# Agentbox notes for the cad skills

The `cad`, `cad-drawing`, `cad-fea`, `cad-robot`, `cad-pcb`, `cad-print` and `cad-render` skills are
adapted from [text-to-cad](https://github.com/earthtojake/text-to-cad) 0.11.8 (MIT, Thompson Labs
LLC; each skill keeps its `LICENSE`). Upstream's skill text is kept except where this estate differs;
those places are the "In agentbox" section of each `SKILL.md` and this file. Decision record:
ADR-2195.

## What is different here

| Upstream | Agentbox |
| --- | --- |
| `curl … install.sh \| sh`, `cad setup`, `cad update` | Refused. The release is baked: `config/cad/wheels.lock.json` names every wheel by sha256, and it changes only with the image. |
| First use downloads the kernel, KiCad, bpy from PyPI | Installed offline from the image's wheelhouse. No package index is configured. |
| Usage statistics and crash reports sent by default | Off for every process (`DO_NOT_TRACK=1`, `CAD_TELEMETRY=0`). `cad telemetry on` is refused. |
| Hourly update check, background updates | Off (`CAD_UPDATE_CHECK=0`). |
| The daemon forks from the first command | Supervised: `[program:cad-engine]`. `supervisorctl status cad-engine`; log `/var/log/cad-engine.log`. |
| The person opens the viewer link | Not reachable: it is loopback-only in this container. Show snapshots and exported files. |
| `cad doctor` repairs | Only `cad doctor --check`. To reset, remove `$WORKSPACE/.agentbox/cad/venv-*` and run any `cad` command. |
| The MCP server (`cad-mcp`, `cad_show`) | Not registered. The skills drive the command line. |

State lives in `$WORKSPACE/.agentbox/cad` (the venv, the engine's cache and its uv cache): about
2.4 GB once every integration has been used. It is safe to delete while the engine is stopped.

## A dependency that is not in the wheelhouse

`cad run` resolves a script's `# /// script dependencies` like `uv run`. Offline, anything outside
the lock fails with "needs the network once, for <package>". That is the pinned behaviour, not a
fault, and there is no switch to lift it: the engine resolves environments itself, offline. Tell the
person which package is missing. It reaches the image by adding it to the requirements in
`scripts/cad-wheels-lock.js`, regenerating `config/cad/wheels.lock.json` and rebuilding.

## Names

| Upstream skill | Here | Notes |
| --- | --- | --- |
| `cad` | `cad` | |
| `engineering-drawing` | `cad-drawing` | |
| `fea` | `cad-fea` | |
| `robot-simulation` | `cad-robot` | Description files only; physics runs are `isaac-sim` |
| `pcb` | `cad-pcb` | The estate's electronics skill |
| `print3d` | `cad-print` | Needs `cad_print = true` for OrcaSlicer; never contacts a printer |
| `render` | `cad-render` | Headless `bpy` in the engine; the interactive Blender is the `blender` skill |
| `sendcutsend` | not adopted | A US fabricator's upload preflight |

## What was verified, and what was not

Verified in this container on 2026-11-11, offline, through the launcher against a wheelhouse built
from the lock: model build, STEP and STL export, the CNC manufacturability check, an engineering
drawing with text, a netgen + CalculiX stress solve, `kicad-cli`, MuJoCo, and `bpy` seeing the GPUs
through OptiX and CUDA.

Not verified until an image is built with the gate on: snapshots (they need the engine's Xvfb with
Mesa's software GLX, neither of which was in the container), EEVEE drafts, OrcaSlicer, and the Nix
derivation itself. If `cad <type> snapshot` fails with "no X display for OpenGL" or "Visual does not
support GL rendering", report it as an image fault and carry on with exports and numbers.
