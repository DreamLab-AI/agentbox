# Env + Setup Consolidation Plan — 2026-07-15

> **2026-09-02 — naming note.** The Python helpers named throughout this plan
> (`tui-write-manifest.py`, `provision-agent-stacks.py`) were retired when the
> boot-path config munging moved to the `agentbox-manifest` Rust binary
> (`services/agentbox-manifest`, subcommands `tui-write` and
> `provision-stacks`). The plan below is kept as the historical record of the
> consolidation; read the script names as those subcommands.

> **EXECUTED 2026-07-22** (PRD-024 C-8, final-mile sprint Tick 1). Status against
> this plan's own verdicts:
> - `.env.example` is now the canonical merge target: all 58 keys enumerated in
>   §3 are present except the ones §5 flags stale/host-specific (`PLAYWRIGHT_*`,
>   `CHROMIUM_PATH`, `SCREENSHOT_DIR`, `VIEWPORT_*`, `VISIONCLAW_HOST`,
>   `VISIONCLAW_COMPOSE_PATH`), which are deliberately omitted and documented in
>   a "REMOVED" footer rather than carried across verbatim, per §5.
> - `GOOGLE_API_KEY` / `OPENROUTER_API_KEY` are already the canonical names
>   across the wizard (`scripts/tui-write-manifest.py`, `scripts/start-agentbox.sh`)
>   from an earlier pass on this same date-stamp — verified still true.
> - Correctness fix beyond §3: the file previously committed as `.env.example`
>   (at commit `050b076c`) had accidentally kept a draft "proposed replacement,
>   mv this into place" header and a stale "FILES TO REMOVE" footer describing
>   files that were *already* removed in that same commit — both corrected.
> - Also fixed two real drift bugs found while merging: the `.env.example`
>   ComfyUI section used invented var names (`COMFYUI_API_ENDPOINT`,
>   `COMFYUI_LOCAL_ENDPOINT`) that no code reads; the real consumed name is
>   `COMFYUI_URL` (`skills/comfyui/**`, `management-api/utils/comfyui-manager.js`).
>   Corrected, with the `COMFYUI_OUTPUT_DIR` vs `COMFYUI_OUTPUTS` drift
>   documented in-line (same pattern as the existing `OPENROUTER_KEY` /
>   `OPENROUTER_API_KEY` note) rather than silently picking one.
> - Per this tick's brief (append-only culture): **none of the 9 files were
>   deleted.** `.env.template`, `.env.template.common`, `skills/env.sample`,
>   `skills/echoloop/.env.example` (hard-deleted at `050b076c`) were
>   **restored as deprecation-pointer stubs** pointing back at `.env.example`.
>   `skills/ontology-enrich/.env.example` got the same stub treatment instead
>   of deletion. `.env.template.oci` is kept (its own file, OCI-only) with its
>   broken back-reference to the now-retired `.env.template.common` repointed
>   at `.env.example`. `.env.solid-pods.example`/`.template` are kept as the
>   distinct sidecar scope, each now with a one-line cross-reference to the
>   master template (§4's "reference the master").
> - Wizard: `CERAMIC_API_KEY` added as provider `ceramic` in
>   `scripts/tui-write-manifest.py` (`PROVIDERS` dict) and
>   `scripts/start-agentbox.sh` (checklist row, `PROV_ENV`, provider loop).
>   `scripts/provision-agent-stacks.py` was left untouched — its per-profile
>   `env` lists are stack/tool provisioning, not the general provider-key
>   registry the wizard prompts from, and ceramic-search isn't stack-specific.
> - E016 (`openmed`) schema fix is **owned by a different agent this tick**
>   (C-6) — not touched here; `node scripts/agentbox-config-validate.js`
>   passes clean at time of writing (0 errors, 3 unrelated advisories), so
>   this env work introduces no new validator errors.

Seeded by: `CERAMIC_API_KEY` missing from the runtime env (the ceramic-search skill and
research agents can't authenticate). Root cause is broader: the env/config surface has
**sprawled into ~9 tracked template files across 3 disagreeing key vocabularies**, and the
setup system (wizard + schema) is drifted against the keys the skills actually need.

## 1. The sprawl (tracked template/example files — all overlap, none agree)

| File | Keys | Role | Verdict |
|------|-----:|------|---------|
| `.env.example` | 38 | nominal master template | **KEEP → make the single source of truth** |
| `.env.template` | 13 | overlapping template | **MERGE into `.env.example`, delete** |
| `.env.template.common` | 19 | overlapping template | **MERGE, delete** |
| `.env.template.oci` | 8 | OCI-deploy overlay | **KEEP only OCI-unique keys as a documented overlay section, or a single `.env.oci.example`** |
| `skills/env.sample` | 61 | the *real* skill-key surface (has CERAMIC) | **MERGE into `.env.example`, delete** |
| `skills/echoloop/.env.example` | — | per-skill (subset of env.sample) | **delete (covered by master)** |
| `skills/ontology-enrich/.env.example` | 8 | per-skill (ONTOLOGY_ENRICH_* + PERPLEXITY) | **MERGE its unique keys, delete** |
| `.env.solid-pods.example` / `.template` | — | solid-pods sidecar | **KEEP (distinct sidecar env), but reference the master** |

Real/secret files (gitignored — **never touch/delete**): `.env`, `.env.solid-pods`,
`.env.dreamlab-additions`, `.env.mad-source`.
Note: **`.env.mad-source` is retired MAD residue** — flag for operator deletion (MAD is decommissioned).

## 2. Three disagreeing key vocabularies (the drift)

- **Skills** (`skills/env.sample`, skill SKILL.md files): `GOOGLE_API_KEY`, `CERAMIC_API_KEY`, `OPENROUTER_KEY`.
- **Setup system** (`scripts/start-agentbox.sh`, `tui-write-manifest.py`, `provision-agent-stacks.py`):
  `GOOGLE_GEMINI_API_KEY`, `BRAVE_API_KEY`, `DEEPSEEK_API_KEY`, `OPENROUTER_API_KEY`, `ZAI_*` —
  and it has **never heard of `CERAMIC_API_KEY`**.
- **Master `.env.example`**: a third, smaller subset.

Concrete naming collisions to resolve (pick one canonical name each):
| Skills use | Setup uses | Canonical (recommend) |
|---|---|---|
| `GOOGLE_API_KEY` (28 refs) | `GOOGLE_GEMINI_API_KEY` (25 refs) | **`GOOGLE_API_KEY`** (broader; Gemini + other Google APIs) |
| `OPENROUTER_KEY` | `OPENROUTER_API_KEY` | **`OPENROUTER_API_KEY`** (matches the `*_API_KEY` convention) |

## 3. What's missing from the master `.env.example` (58 keys)

Grouped (all present in `skills/env.sample`, absent from `.env.example`):

- **Search / research (the seed gap):** `CERAMIC_API_KEY`, `PERPLEXITY_API_KEY`, `CONTEXT7_API_KEY`
- **Media/art:** `FAL_KEY`, `ELEVENLABS_API_KEY`, `SUNO_API_KEY`, `HEYGEN_API_KEY`, `RUNWAY_API_KEY`,
  `PEXELS_API_KEY`, `PIXABAY_API_KEY`, `REMOVEBG_API_KEY`, `DEEPGRAM_API_KEY`, `OPENROUTER_KEY`, `GOOGLE_API_KEY`
- **Compute/cloud:** `SALAD_API_KEY`, `SALAD_ORG_NAME`
- **Social:** `REDDIT_CLIENT_ID/SECRET/USERNAME/PASSWORD`, `LINKEDIN_TIMEOUT`
- **Email-search:** `AGENTBOX_EMAIL_GATEWAY_TOKEN`, `AGENTBOX_EMAIL_GATEWAY_URL`
- **Service ports / hosts:** `BLENDER_PORT`, `QGIS_PORT/HOST/TIMEOUT`, `PBR_PORT`, `MCP_TCP_PORT`,
  `COMFYUI_URL/OUTPUT_DIR`, `ZAI_URL/TIMEOUT`, `ANTHROPIC_BASE_URL`
- **Playwright/display (⚠ several stale — see §5):** `DISPLAY`, `CHROMIUM_PATH`, `PLAYWRIGHT_*`,
  `SCREENSHOT_DIR`, `VIEWPORT_WIDTH/HEIGHT`
- **Defense MCP:** `DEFENSE_MCP_DRY_RUN/REQUIRE_CONFIRMATION/ALLOWED_DIRS/LOG_LEVEL`
- **EchoLoop:** `ECHOLOOP_*` (8), `CBM_CACHE_DIR`, `IMAGEMAGICK_TIMEOUT`, `DOCKER_SOCKET_PATH`
- **VisionClaw (⚠ stale MAD host — §5):** `VISIONCLAW_HOST`, `VISIONCLAW_COMPOSE_PATH`
- **Ontology-enrich:** `ONTOLOGY_ENRICH_*` (7)

## 4. Target: one source of truth

```
.env.example   ← the ONLY committed env template (all keys above, grouped, blank/placeholder values)
.env           ← operator's real values (gitignored); loaded by docker-compose `env_file: .env`
                 → every skill/tool reads os.environ / process.env from this
.env.oci.example (optional) ← only the OCI-deploy-specific overlay keys
.env.solid-pods.example     ← the solid-pod sidecar's own env (kept separate, references master)
```
Delete: `.env.template`, `.env.template.common`, `skills/env.sample`, the two per-skill
`.env.example` files, and the retired `.env.mad-source`. Replace each with (or point docs at)
the single `.env.example`.

## 5. Stale entries to fix during the merge (do NOT carry these across verbatim)

- `VISIONCLAW_HOST=multi-agent-container` — MAD retired; should be the current VisionClaw container/service name.
- `PLAYWRIGHT_*`, `CHROMIUM_PATH` — local Playwright is deprecated (browsercontainer sidecar now); keep only if still consumed.
- `ZAI_URL=http://localhost:9600` — Z.AI is now a `claude-zai-service` sidecar, not localhost.
- Port map (`BLENDER_PORT=9876`, `QGIS_PORT=9877`, `PBR_PORT=9878`, `PLAYWRIGHT_PROXY_PORT=9879`) —
  reconcile against the live gui-tools sidecar (9876 blender, 9877 qgis) so it isn't a fourth vocabulary.

## 6. Setup-system fixes (non-env code — can be done directly)

- `scripts/tui-write-manifest.py` / `start-agentbox.sh` / `provision-agent-stacks.py`: teach the
  wizard the full canonical key list (incl. `CERAMIC_API_KEY`) so setup prompts for them and writes
  them to `.env`; resolve the `GOOGLE_API_KEY`/`OPENROUTER_API_KEY` naming to the canonical form.
- `schema/agentbox.toml.schema.json`: the E016 validator failure (OpenMed) is a related setup-system
  drift — fix alongside (see audit-2026-07-15 GATE-1).

## 7. Execution constraint (important)

The harness **denies agent Read/Write on `.env*` files** (secrets-hygiene policy — I can `grep`
key *names* to audit, but not read values, edit, or delete these files). So:

- **I can do now:** the setup-system code fixes (§6, non-env files) and this plan.
- **Needs operator (or a lifted `.env*` permission):** editing `.env.example` (add the 58 keys +
  `CERAMIC_API_KEY`), setting the real `CERAMIC_API_KEY` value in `.env`, and `git rm` of the
  redundant templates (§1). The exact merged `.env.example` content can be generated from
  `skills/env.sample` ∪ `.env.example` ∪ `.env.template*` minus the §5 stale entries.
