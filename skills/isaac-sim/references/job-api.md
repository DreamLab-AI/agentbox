# Isaac Sim job API

Internal only: `http://isaac-sim:9890` on the container network, no published port. Use
`tools/isaac-job.js`; the HTTP shapes are below for other clients.

| Route | Purpose |
|---|---|
| `GET /healthz` | control endpoint only |
| `GET /v1/capabilities` | versions, GPU inventory, assigned GPU, free storage, concurrency, installed fixtures, `executed` kinds, four-level `health` |
| `POST /v1/jobs` | submit; 202 + receipt, 200 `duplicate:true` for an identical request, 507 if free space is below the floor |
| `GET /v1/jobs`, `GET /v1/jobs/<id>` | list; status with the full receipt (`job.json`) |
| `GET /v1/jobs/<id>/log?lines=N` | bounded log tail (max 2000) |
| `GET /v1/jobs/<id>/artefacts` | `complete:false` until a manifest exists; then name, size, sha256, type |
| `POST /v1/jobs/<id>/cancel` | SIGTERM then SIGKILL to that job's process group only |

Submit body: `script` (path under the share), `kind`, `seed`, `args[]`, `params{}`, `inputs[]` (hashed
into the receipt), `required_outputs[]` (relative to the result dir), `solver{}`, `rerun`,
`min_free_gib`, optional `idempotency_key`, `id`.

States: `queued`, `running`, `succeeded`, `failed`, `cancelled`, `lost`. `lost` means the recorded
process no longer exists and no exit code was written (sidecar restart or kill); it is never
re-run automatically. `succeeded` requires exit 0 **and** every required output present and
non-empty; only then is `manifest.json` written. A job that exits 0 with a missing output is `failed`.

Environment given to a job: `ISAAC_JOB_DIR` (write results here), `ISAAC_JOB_ID`, `ISAAC_SEED`,
`ISAAC_PARAMS` (JSON), `ISAAC_ROOT`.

Paths, one volume (`agentbox_gui-tools-exchange`) seen three ways:

| Container | Mount | Isaac tree |
|---|---|---|
| isaac-sim | `/exchange` | `/exchange/isaac` |
| agentbox | `/home/devuser/gui-tools` | `/home/devuser/gui-tools/isaac` |
| gui-tools-service (Blender) | `/home/devuser/exchange` | `/home/devuser/exchange/isaac` |

Layout: `inbox/` staged inputs, `fixtures/` baked smoke scripts, `jobs/<id>/{job.json,job.log,pid,exit_code,manifest.json,result/}`.
Caches (shader, kit, asset) are a separate `isaac-sim-cache` volume and may be dropped freely.
