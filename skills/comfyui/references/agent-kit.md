# Agentic ComfyUI harness

Agentbox reviewed [ComfyUI-Agent-Kit](https://github.com/SlavaSexton/ComfyUI-Agent-Kit/tree/74f5b0bbd87b1c4ca0cd95dea169cdcae4b9af9d)
at commit `74f5b0bbd87b1c4ca0cd95dea169cdcae4b9af9d` on 2026-09-08.
Its [stdlib HTTP client](https://github.com/SlavaSexton/ComfyUI-Agent-Kit/blob/74f5b0bbd87b1c4ca0cd95dea169cdcae4b9af9d/shared/comfyui/comfy_client.py)
provides useful queue/history and `/view` patterns, including `images`, `gifs`
and `videos` output collections. Its
[skill](https://github.com/SlavaSexton/ComfyUI-Agent-Kit/blob/74f5b0bbd87b1c4ca0cd95dea169cdcae4b9af9d/shared/comfyui/SKILL.md)
and [open video recipes](https://github.com/SlavaSexton/ComfyUI-Agent-Kit/blob/74f5b0bbd87b1c4ca0cd95dea169cdcae4b9af9d/shared/comfyui/MODELS/video-open.md)
are optional references for workflow construction. Read the recipe for the chosen
model, then verify its node classes and model filenames against the live sidecar.
This is a reviewed reference, not a wholesale installer integration; Agentbox
keeps its existing MCP registration and sidecar ownership. No upstream code is
vendored by this harness.

## Durable local rendering

`scripts/comfy_client.py` is an independently implemented stdlib client. It checks
live `/object_info` schemas before submission and records the complete submitted
graph, graph hash, client ID, server URL and prompt ID in a durable JSON receipt.
Use the skill's absolute script path from any repository; the following commands
assume the Agentbox checkout as the current directory:

```bash
python3 skills/comfyui/scripts/comfy_client.py --url http://comfyui:8188 health
python3 skills/comfyui/scripts/comfy_client.py --url http://comfyui:8188 object-info > object-info.json
python3 skills/comfyui/scripts/comfy_client.py --url http://comfyui:8188 validate workflow-api.json
python3 skills/comfyui/scripts/comfy_client.py --url http://comfyui:8188 submit workflow-api.json --receipt renders/hero.receipt.json
python3 skills/comfyui/scripts/comfy_client.py resume renders/hero.receipt.json --timeout 60
python3 skills/comfyui/scripts/comfy_client.py download renders/hero.receipt.json --outdir renders/hero
```

The default endpoint is `COMFYUI_URL`, falling back to `http://comfyui:8188`.
Resume and download use the receipt's endpoint when `--url` is omitted.
Use an API-format graph exported from ComfyUI, not its UI-format workflow JSON.
Schema validation checks available classes, required inputs, model choices,
primitive values, link slots/types and cycles. Dynamic custom-node inputs are
left to ComfyUI's final server validation. This is not a GPU capacity predictor.

Exit `0` means the requested operation succeeded; `1` means validation,
transport or execution failure; `2` means observation timed out. A timeout keeps
the prompt ID and last queue/history observation. Run `resume` on the same
receipt: it never submits a new job. Missing queue/history entries remain
`unknown`, since restarts, eviction and observation races cannot establish the
outcome. Inspect the same server before deciding how to recover.

An interrupted or rejected POST leaves a `submission_unknown` receipt with its
client ID and workflow. Do not delete it and blindly submit again. Inspect
`/queue` and `/history` for that client ID/graph to reconcile server acceptance.
There is no claim of exactly-once delivery across an HTTP response loss: ComfyUI
does not provide this client's own durable transaction boundary. A known prompt
ID is saved atomically before polling; existing receipts cannot be overwritten by
another submission.

Completed history is authoritative even when outputs are empty. Failed history
retains ComfyUI exception diagnostics. Downloads stream into temporary files,
use encoded `/view` parameters and collision-resistant local names, reject
filename traversal, and record paths in the receipt. The receiving video skill
must still run `ffprobe` and visual inspection: HTTP success proves transport,
not that the generated clip is valid or suitable for the audience.

## Regression checks

```bash
python3 -m unittest discover -s skills/comfyui/scripts/tests -v
```

The fake HTTP server covers graph rejection, durable pre-POST journalling,
duplicate submission prevention, execution errors, transient failures,
timeout/resume, absent handles, successful empty output history, all three
output collections, filename collisions and traversal. Live GPU generation is
a separate integration gate and must be reported separately.
