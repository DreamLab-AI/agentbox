# Runtime profile and egress security

Status: proposed governing surface, 2026-09-04. Owner: agentbox maintainers. ADR-2026 and ADR-2027 previously referenced this absent file. This document records the inspected boundary and proposed acceptance requirements; it does not assert that the complete policies are implemented.

[ADR-2026](adr/ADR-2026-session-mirror-egress-boundary.md) governs session content egress. [ADR-2027](adr/ADR-2027-secret-custody-rotation-break-glass.md) proposes custody, rotation and revocation requirements; its provisional register below requires custodian confirmation and lifecycle evidence. [ADR-2007](adr/ADR-2007-profile-isolation.md) governs configuration separation, which does not establish an OS boundary.

Changes to profiles, keys, mirror providers, recipients, transport or diagnostics must identify their effect on these contracts and retain isolated failure/recovery evidence. Refer to secret identifiers and custodian roles, never secret values. Proposed policy remains subject to maintainer adoption.

## Runtime boundary qualification — 2026-09-04

ADR-2026 is now source-reviewed but remains proposed/partial/inactive for its complete egress policy. The live hook composes unredacted selected text before NIP-59 wrapping; the digest path sends flattened input to its configured summarisation provider and publishes a separately signed digest. Their configuration gates and encryption differ. A shared off/redaction/recipient/retention contract remains open, alongside ADR-2027 secret custody.

See the [estate review](https://github.com/DreamLab-AI/VisionFlow/blob/main/docs/estate-review/runtime-egress-and-profiles.md) for isolated probes and current source scope. No live provider call, relay send or custody change is certified here.

## Provisional custody register — 2026-09-04

This register identifies credential roles and source-configured storage interfaces, not secret values or an attested production inventory. Every actual custodian, deployed location, rotation cadence and incident response time remains **unconfirmed**. Suggested responsibility below is a role to assign, not an assertion that someone has accepted custody. Do not copy secrets into this register.

| Credential role | Source/configuration interface | Suggested responsible role | Required rotation/revocation and acceptance evidence |
|---|---|---|---|
| Bridge identity / unwrap key | Bridge loads AGENTBOX_BRIDGE_SK_FILE, default /run/secrets/nostr.key; legacy environment fallback remains | Identity/runtime maintainers | Inventory every writer/reader and retained copy; replace key and identity references, reject old authority, test restart and failed persistence |
| Shared server publisher identity | ADR-2012 records pending per-consumer split; relay key list is build-projected | Publisher/relay maintainers | Identify each consumer, split keys, retire old authorisation at relay and inbox boundaries, prove old-key rejection after rebuild/deploy |
| Proxy break-glass bearer | NIP98_PROXY_ALLOW_BEARER captured at process start | Ingress incident owner | Implement expiry, request scope and auditable use; test expired/wrong-scope rejection and removal across all running instances |
| Proxy browser-session signing secret | NIP98_PROXY_SESSION_SECRET or per-boot random secret | Ingress/session maintainers | Define restart invalidation and multi-instance policy; verify old cookies fail after planned revocation and no secret enters audit logs |
| AoE daemon token | Daemon state file read by proxy with last-good cache | Runtime/session maintainers | Rotate daemon and proxy coherently; deleting the state file alone is insufficient; test cached token, direct access and rollback |
| Dream remote-execution identity | ssh/scp dispatch uses ambient SSH configuration; no explicit identity file in inspected calls | Evaluation/host maintainers | Establish actual identity and host authorisation separately; constrain remote capability, revoke and prove rejected access without disrupting unrelated credentials |
| Secret backup artefact and recovery access | VisionClaw scripts/backup-secrets.sh collects selected config names into workspace/secret-backups ZIP and manifest | Backup/recovery maintainers | Define protected storage, encryption/access keys, retention, off-host recovery and deletion; test restore and loss of recovery authority with synthetic inputs |

No cadence is invented here. Before adoption, each row needs an accepted custodian, exact deployed storage reference, rotation trigger/cadence, revocation procedure and maximum response window, plus a dated successful failure/recovery receipt. Provider credentials and other estate identities must be inventoried too; these seven rows are a starting set, not completeness certification.

The proxy's break-glass branch compares a configured token and returns a sentinel identity without expiry or request-scope checks there. It does not establish per-use durable audit. The backup script invokes ordinary zip and unzip integrity testing without encryption flags or explicit umask/chmod; final permissions depend on the invoking environment. Integrity testing is not a recovery exercise. The script was not run, and no backup contents were inspected. See the [estate evidence](https://github.com/DreamLab-AI/VisionFlow/blob/main/docs/estate-review/runtime-ingress.md#custody-and-revocation-acceptance).


## Custody register update — 2026-09-05

Two of the seven rows below have moved from "recorded weakness" to "code with
tests behind it". The rest have not: **every custodian, deployed location,
rotation cadence and response window remains unconfirmed**, and drafting a row
still does not implement custody.

| Credential role | What changed on 2026-09-05 | Status |
|---|---|---|
| Proxy break-glass bearer | `verifyIdentity`'s break-glass branch gained **expiry** (`NIP98_PROXY_BEARER_EXPIRES_AT`, malformed value fail-closed), **request scope** (`NIP98_PROXY_BEARER_SCOPE`, `METHOD /prefix`, binding the method too) and **per-use audit** by sha256-12 token fingerprint on both acceptance and refusal. The health payload states `NO EXPIRY CONFIGURED` / `UNRESTRICTED` explicitly. 14 new self-test assertions against real proxy children; 134 total, 0 failures, 0 skips. | Bounds implemented, **default off**. A deployment that sets neither is exactly as unbounded as before — the status line now says so. Custodian unconfirmed; the counters are in-process, not a durable audit store. |
| Secret backup artefact and recovery access | Replaced the ordinary ZIP with `services/secret-backup`: **tar inside age**, using the maintained `age` crate (X25519 / scrypt, ChaCha20-Poly1305 under STREAM). It **cannot** write a plaintext archive — with no recipient and no passphrase the run fails having created no file. Archive and manifest are `0600`; the manifest carries names only; restore refuses path traversal. **Recovery exercised on synthetic data**: backed up and restored byte for byte, with the archive verified to contain none of the plaintext. 7 cargo tests pass. | Encryption and a **demonstrated restore** implemented. Off-host survival, retention, deletion and revocation of retained copies remain untested. Not yet wired into `flake.nix`, so the image does not ship the binary. |
| Bridge identity / unwrap key | unchanged | Unconfirmed |
| Shared server publisher identity | unchanged; the ADR-2012 relay/inbox split remains pending | Unconfirmed |
| Proxy browser-session signing secret | unchanged | Unconfirmed |
| AoE daemon token | unchanged | Unconfirmed |
| Dream remote-execution identity | unchanged | Unconfirmed |

No cadence has been invented. Before adoption each row still needs an accepted
custodian, an exact deployed storage reference, a rotation trigger and cadence, a
revocation procedure, a maximum response window, and a dated failure/recovery
receipt. Seven rows remain a starting set, not a completeness certification.

Evidence: [ADR-2027 receipt](estate-closeout/2026-09-05/adr-2027-custody-break-glass.json).

## Egress policy adoption — 2026-09-05

ADR-2026's shared content-egress contract now exists as an artefact rather than a
requirement: [`config/egress-policy.json`](../config/egress-policy.json)
enumerates content, recipients, providers, encryption, transport and log
retention **per path**, and both runtimes implement it —
`config/hooks/lib/egress-policy.cjs` for the live mirror and
`services/nostr-pod-bridge/src/egress_policy.rs` for the digest — held together
by a paired redaction fixture both must satisfy in their own test suites.

The three properties the earlier qualification called open are now closed in
code: **redaction happens before egress** on both paths (before the NIP-59 wrap;
before the provider request is built), a **single `AGENTBOX_EGRESS` switch**
disables every path, and **`skipped` / `attempted` / `accepted` / `failed`** are
distinguishable — `publishWrap` previously resolved with nothing on relay-OK,
rejection, error, close and timeout alike, which is why exit zero could not prove
delivery. Verified with network-denial fixtures that make delivery impossible.

Still open: no real transcript, provider call or relay send was exercised; the
relay/read policy for the signed kind-30840 digest is a separate boundary; and
the policy document remains **proposed** pending maintainer adoption.

## Prompt egress register — 2026-10-03

<!-- egress-register:begin (generated by scripts/ci/render-egress-register.js from config/egress-policy.json; do not edit by hand) -->

Source: [`config/egress-policy.json`](../config/egress-policy.json) `.register`. Citations verified at `0919dc39a` on 2026-10-03. 31 routes.

One row per route by which a prompt, code, a secret-adjacent string or a key can leave the container. The register catalogues routes; the same file's `paths` is the redaction contract for the two routes that implement it. A route with no gate or no accepted-egress record carries a marker. The register records the gap and does not invent a gate or a record.

Provider credentials stay devuser-class in this step (owner disposition Q8, 2026-10-03, pending owner review). Each row names the credential it uses.

| id | Route | What leaves | Destination class | Gate | Accepted-egress record | Notes |
|---|---|---|---|---|---|---|
| `primary-model` | Claude Code and Codex sessions (the primary model routes) | prompt, code, secret-adjacent | vendor: Anthropic API; OpenAI API | none. A running session is the egress. `[toolchains].claude` (`agentbox.toml:1849`) and `codex` (`agentbox.toml:1860`) are rebuild-class bake gates, not runtime switches. | Owner disposition Q14, 2026-10-03 (custody-isolation design §11, pending owner review): primary-model egress recorded as accepted. No ADR yet. | **[marker: no gate]** Everything an agent reads can leave: prompts, file contents, tool output. Providers declared at `agentbox.toml:1165-1169` (Anthropic, oauth) and `agentbox.toml:1171-1173` (OpenAI). Credentials `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` are projected into the container environment (`flake.nix:3432`, `flake.nix:3434`): devuser-class this step (Q8). |
| `skill-router` | Live skill router, `UserPromptSubmit` hook (ADR-2091) | prompt | vendor: TypeSafe System One, `api.typesafe.ai` (`config/hooks/lib/skill-route.cjs:33`) | `[skills.routing].router = "table"` (`agentbox.toml:962`) de-registers the hook; `hook` (`agentbox.toml:963`). An absent `TYPESAFE_API_KEY` (`config/hooks/lib/skill-route.cjs:398`) fails open without sending. | ADR-2090 (accepted, `5e213c3ec`): routing prompt may leave, skill routing only (`docs/adr/ADR-2090-skill-routing-prompt-egress.md:31-40`); per-project gates deferred, not waived (`docs/adr/ADR-2090-skill-routing-prompt-egress.md:42-45`). | The user's turn text, clamped head+tail (`config/hooks/lib/skill-route.cjs:408-414`), plus every routable skill description. No per-project bypass exists at HEAD; that is the debt ADR-2090 records. Credential `TYPESAFE_API_KEY`: devuser-class (Q8). |
| `jev-compaction` | Jev compaction via factrail (ADR-2093 policy, ADR-2121 implementation) | prompt, code | vendor: TypeSafe System One (cloud) unless repointed at the local façade | `[features.jev_compaction].enabled` (`agentbox.toml:680`); `egress = "metadata"` (`agentbox.toml:701`) narrows the payload to kinds, key names, counts and lengths. | ADR-2093 (accepted): operator decision to send transcript windows beyond ADR-2090's routing-only scope, with email fenced out (`docs/adr/ADR-2093-jev-verbatim-compaction.md:53-54`). | Tool-call arguments and results from the session transcript, capped per fitting stage. Email-tainted sessions never reach a cloud judge. Credential `TYPESAFE_API_KEY`: devuser-class (Q8). |
| `system-one-local` | Sovereign System One façade (ADR-2094) | prompt, code | LAN: `system-one-facade` on `visionclaw_network`; option embeddings to `192.168.2.132:9997` (`agentbox.toml:737`) | `[features.sovereign_system_one].enabled` (`agentbox.toml:732`), currently `false` | ADR-2094 (accepted, activation inactive): a local façade in the Jev wire format (`docs/adr/ADR-2094-local-capacity-adapting-typed-decision-facade.md:35-38`). | Carries the router and compaction payloads above. When on, nothing leaves the LAN. Inactive at HEAD, so the two vendor rows above are the live routes. |
| `loom-door` | Ontology Loom façade: ontology condense; dream nights when `llm_provider = "loom"` | prompt | LAN: `${LOOM_BASE_URL}`: the estate façade `:8084` on the HP host. Compose default is `http://loom:8080/v1` (`flake.nix:3438`); the LAN address is deployment configuration. | `[skills.ontology.condense].enabled` (`agentbox.toml:860`); `[dream_machine].llm_provider` (`agentbox.toml:2179`) or `DREAM_LLM_PROVIDER` | ADR-2070 (accepted, live): the Loom endpoints are named egress doors and knowledge work holds `:8084` (`docs/adr/ADR-2070-one-front-door-is-ingress-the-loom-raw-port-is-a-named-egress-door.md:39-47`); `docs/LAN-door-threat-model.md:16`. | Knowledge-graph class text and dream prompts. The trust is service identity, not remote attestation (`docs/LAN-door-threat-model.md:16`). |
| `loom-raw` | Loom raw model door, `loom-raw` interaction-plane session | prompt, code | LAN: Loom raw model `:8085` on the HP host | none at runtime. The session seed (`agentbox.toml:1810`) is chosen per session by the operator or agent. | ADR-2070 (accepted): the raw door is agent-choice and benchmark-only (`docs/adr/ADR-2070-one-front-door-is-ingress-the-loom-raw-port-is-a-named-egress-door.md:48-52`); `docs/LAN-door-threat-model.md:17`. | **[marker: no gate]** Raw coding sessions send their whole working context to the LAN model. The purpose restriction is policy, not runtime isolation (`docs/LAN-door-threat-model.md:17`). |
| `routing-label-embeddings` | Routing teacher label log, EXP-B8 (ADR-2110) | prompt | LAN: bge-small on Xinference, `192.168.2.132:9997` (`agentbox.toml:993`) | `[skills.routing].label_log` (`agentbox.toml:992`) | Owner decision 2026-10-02 R5b: label log on as a bounded experiment (`agentbox.toml:986-987`; `scripts/experiments/exp-b8-label-log.cjs:7-8`). | Turn text is embedded for the shadow BM25 comparison. LAN only. The experiment switches itself off at its stopping rule. |
| `consultant-codex` | Consultant MCP `consultant-codex` (`/consult codex`, auto-consultant) | prompt, code | vendor: OpenAI, via the Codex CLI (`mcp/consultants/codex/server.js:39`) | `[consultants].enabled` (`agentbox.toml:1302`); `[consultants.codex].enabled` (`agentbox.toml:1307`) | none. ADR-011 (accepted, archived) designs the consultant tier; no record accepts sending repo context to the vendor. | **[marker: no accepted record]** Full consult prompts including repository context. Drift: ADR-011 (`docs/archive/adr/ADR-011-consultation-mcps.md:182`) and `mcp/consultants/README.md:102-104` claim outbound privacy-filter redaction. No redaction call exists in `mcp/consultants/shared/` at HEAD. Codex CLI credentials: devuser-class (Q8). |
| `consultant-antigravity` | Consultant MCP `consultant-antigravity` | prompt, code | vendor: Google (Gemini), via the Antigravity CLI (`mcp/consultants/antigravity/server.js:38`) | `[consultants].enabled` (`agentbox.toml:1302`); `[consultants.antigravity].enabled` (`agentbox.toml:1313`) | none. ADR-011 designs the tier only. | **[marker: no accepted record]** As consultant-codex, including the privacy-filter drift. CLI credentials: devuser-class (Q8). |
| `consultant-zai` | Consultant MCP `consultant-zai` | prompt, code | vendor: Z.AI (GLM), via the `claude-zai` CLI (`mcp/consultants/zai/server.js:41`) | `[consultants].enabled` (`agentbox.toml:1302`); `[consultants.zai].enabled` (`agentbox.toml:1319`) | none. ADR-011 designs the tier only. | **[marker: no accepted record]** As consultant-codex. Credential `ZAI_ANTHROPIC_API_KEY`: devuser-class (Q8). |
| `consultant-perplexity` | Consultant MCP `consultant-perplexity` | prompt, code | vendor: `api.perplexity.ai` (`mcp/consultants/perplexity/server.js:17`) | `[consultants].enabled` (`agentbox.toml:1302`); `[consultants.perplexity].enabled` (`agentbox.toml:1326`) | none. ADR-011 designs the tier only. | **[marker: no accepted record]** As consultant-codex. Credential `PERPLEXITY_API_KEY` (`agentbox.toml:1189-1191`): devuser-class (Q8). |
| `consultant-deepseek` | Consultant MCP `consultant-deepseek` | prompt, code | vendor: `api.deepseek.com` (`mcp/consultants/deepseek/server.js:18`) | `[consultants].enabled` (`agentbox.toml:1302`); `[consultants.deepseek].enabled` (`agentbox.toml:1331`) | none. ADR-011 designs the tier only. | **[marker: no accepted record]** As consultant-codex. DeepSeek API key: devuser-class (Q8). |
| `zai-night` | Dream engine night provider (`services/dream-engine`) | prompt, code | vendor: Z.AI, `https://api.z.ai/api/anthropic` (`services/dream-engine/src/config.rs:381`) | `[dream_machine].llm_provider = "loom"` (`agentbox.toml:2179`) or `DREAM_LLM_PROVIDER` (`services/dream-engine/src/engine.rs:1687`); `[dream_machine].enabled` (`agentbox.toml:2163`) | none. No ADR or owner decision accepts the dream corpus leaving for Z.AI. | **[marker: no accepted record]** Nightly dream prompts built from workspace and repository context. Default provider is `zai`. Credential `ZAI_ANTHROPIC_API_KEY` (`services/dream-engine/src/engine.rs:1695`): devuser-class (Q8). |
| `session-digest` | Mobile-bridge session digest (`egress-policy.json` path `session-digest`) | prompt | vendor: `ZAI_URL` (Z.AI by default) for summarisation, then the cloud relay and the Solid pod | `[sovereign_mesh.mobile_bridge].enabled` (`agentbox.toml:98`), currently `false`; `AGENTBOX_SESSION_DIGEST` / `AGENTBOX_EGRESS` (`config/hooks/lib/egress-policy.cjs:145-148`) | ADR-030 D3 (accepted, archived): the mesh's one accepted external hop (`docs/archive/adr/ADR-030-sovereign-mesh-manifest-boundary.md:65-67`). The ADR-2026 contract is still `proposed`. | Flattened transcript text, redacted before the provider hop. The signed kind-30840 is not encrypted. |
| `ontology-monitor` | Ontology monitor `SessionEnd` hook (`config/hooks/ontology-monitor.cjs`) | prompt, code | vendor: Z.AI via the `claude-zai` CLI (`config/hooks/ontology-monitor.cjs:156`, `config/hooks/ontology-monitor.cjs:177`); proposals to the forum relay as kind 31402 | `[ontology_monitor].enabled` (`agentbox.toml:116`); `mode = "dryrun"` (`agentbox.toml:117`) stops the publish | none. This contradicts ADR-030 D3's "exactly one external data hop" (`docs/archive/adr/ADR-030-sovereign-mesh-manifest-boundary.md:67`). | **[marker: no accepted record]** Changed files plus a transcript tail of up to 12,000 characters (`config/hooks/ontology-monitor.cjs:115`). Not routed through the ADR-2026 redactor or `AGENTBOX_EGRESS`. |
| `project-tracking` | Project tracking: primers, GitHub enrichment, kind-30841 publish (ADR-035) | code, public artefact | vendor: Z.AI (primers); GitHub API (enrichment); the configured relay (kind 30841) | `[project_tracking].enabled` (`agentbox.toml:1668`); `github_enrichment` (`agentbox.toml:1671`); `primer_on_scan` (`agentbox.toml:1673`); `nostr_publish` (`agentbox.toml:1674`) | ADR-035 D5 (accepted, archived): fail-open nostr publish and GitHub enrichment (`docs/archive/adr/ADR-035-project-tracking-telemetry-and-nostr-kind.md:105`). The Z.AI primer hop is not separately accepted. | Primers summarise repository content. Credential `GITHUB_TOKEN`: devuser-class (Q8). |
| `live-mirror` | Per-turn session mirror, NIP-59 (`config/hooks/nostr-live-mirror.cjs`) | prompt | public internet: One relay: `NOSTR_MIRROR_RELAY`, else the cloud default (`config/hooks/nostr-live-mirror.cjs:51`) | `AGENTBOX_LIVE_MIRROR`, `AGENTBOX_EGRESS` (`config/hooks/lib/egress-policy.cjs:145-148`); refused without a valid `AGENTBOX_MIRROR_RECIPIENTS` allowlist | ADR-029 D3 (accepted, archived): no LLM hop, cloud relay only (`docs/archive/adr/ADR-029-session-mirror-live-egress.md:67-71`). The ADR-2026 contract is still `proposed`. | Selected turn text, redacted, then gift-wrapped (kind 1059) to the operator's derived child key. |
| `nostr-gateway` | Nostr control gateway, operator command DMs (`config/nostr-gateway/gateway.cjs`) | prompt | public internet: Cloud relay (`config/nostr-gateway/gateway.cjs:84`) | `AGENTBOX_NOSTR_GATEWAY=0` (`config/nostr-gateway/gateway.cjs:166`; `flake.nix:2087`) | none. | **[marker: no accepted record]** Replies carry session output from the tmux fleet, gift-wrapped to the operator. Not routed through the ADR-2026 redactor. The operator key `AGENTBOX_PRIVKEY_HEX` is in the process environment. |
| `junkiejarvis-posts` | JunkieJarvis forum replies and clarifying DMs (`management-api/lib/junkiejarvis-agent.js`) | public artefact | public internet: The forum relay (`NOSTR_RELAYS`) | `[sovereign_mesh].junkiejarvis` (`agentbox.toml:50`), the only switch | ADR-030 (accepted, archived) places JunkieJarvis in the mesh; ADR-2088 (accepted, staged) accepts the clarifying DMs. | Kind-42 replies in forum sections and kind-1059 DMs. Encrypted to the zone key where the zone is encrypted. |
| `junkiejarvis-llm` | JunkieJarvis reply generation | prompt | vendor: Anthropic (`management-api/lib/junkiejarvis-agent.js:466`), else Z.AI or OpenAI (`management-api/lib/junkiejarvis-agent.js:496-497`) | `[sovereign_mesh].junkiejarvis` (`agentbox.toml:50`) | none. This contradicts ADR-030 D3 (`docs/archive/adr/ADR-030-sovereign-mesh-manifest-boundary.md:67`). | **[marker: no accepted record]** Forum members' messages (third-party content) and the agent's context. Credentials `ANTHROPIC_API_KEY` / `ZAI_ANTHROPIC_API_KEY`: devuser-class (Q8). |
| `dream-forum-suggestions` | Dream forum-suggestions tenant (`scripts/dream-forum-suggestions.mjs`) | prompt, public artefact | vendor: Z.AI triage (`scripts/dream-forum-suggestions.mjs:57`); replies to the forum relay (`scripts/dream-forum-suggestions.mjs:48-49`) | `DREAM_FORUM_SUGGESTIONS=0` (`scripts/dream-machine-nightly.mjs:700`); clarifying DMs held while `[sovereign_mesh].junkiejarvis` is off (`scripts/dream-forum-suggestions.mjs:220`) | ADR-2088 (accepted) covers the clarifying DMs. None for the Z.AI triage hop. | **[marker: no accepted record]** Forum suggestion text goes to Z.AI. Replies are posted in-thread as JunkieJarvis. |
| `dream-digest` | Nightly dream digest forum post (`services/dream-engine/src/digest.rs`) | public artefact | public internet: Forum relay, `DREAM_RELAY` else the cloud default (`services/dream-engine/src/relay.rs:32-38`) | `DREAM_DIGEST=0` (`services/dream-engine/src/engine.rs:312`) | none. | **[marker: no accepted record]** Kind-42 summary of the night. Encrypted to the zone key or refused, never plaintext in an encrypted zone (`services/dream-engine/src/digest.rs:412-424`). |
| `dream-governance` | Dream governance panel and cases, kinds 31400/31402 (`services/dream-engine/src/governance.rs`) | public artefact | public internet: Forum relay (`services/dream-engine/src/governance.rs:9-11`) | `DREAM_GOVERNANCE=0` (`services/dream-engine/src/governance.rs:82-83`) | none. | **[marker: no accepted record]** One case per open inbox item, signed by JunkieJarvis. Admin replies (31403) are ingested the next night. |
| `exp-b8-report` | EXP-B8 stop report and gate-flip PR (`scripts/experiments/exp-b8-label-log.cjs`) | public artefact, code | public internet: Forum relay (`scripts/experiments/exp-b8-label-log.cjs:445`); a GitHub PR | `[skills.routing].label_log` (`agentbox.toml:992`); `--dry-run` never posts | Owner decision 2026-10-02 R5b: report on the forum when the stopping rule fires (`scripts/experiments/exp-b8-label-log.cjs:7-8`). | One kind-42 summary, zone-encrypted or refused (`scripts/experiments/exp-b8-label-log.cjs:548`), at most once. |
| `sidestr-announce` | sidestr producer tips, kind 33333 (`config/sidechain/run-producer.sh`) | public artefact | public internet: Five public relays (`config/sidechain/run-producer.sh:49`) | `[sidechain].enabled` (`agentbox.toml:1573`), rebuild-class | none accepted. ADR-2098 registers kind 33333 but is `proposed`. | **[marker: no accepted record]** Public chain data, not a prompt. Recorded for completeness. Signer key under `/var/lib/agentbox/secrets`. |
| `sidestr-pages` | sidestr Pages mirror (`config/sidechain/mirror-sync.sh`) | public artefact | public internet: GitHub Pages checkout, `git push` (`config/sidechain/mirror-sync.sh:81`); announced URL `agentbox.toml:1574` | `[sidechain].mirror` (`agentbox.toml:1575`), rebuild-class | none accepted. ADR-2098 and ADR-2103 are `proposed`. | **[marker: no accepted record]** Block files only. Uses the devuser `gh` credential (`flake.nix:2692`). |
| `github` | `gh` and `git push` from agent sessions | code, public artefact | vendor: GitHub | none | none. | **[marker: no gate]** **[marker: no accepted record]** Every agent can push via the `gh` credential helper (`config/entrypoint-unified.sh:388-391`). Credential `GITHUB_TOKEN` (`flake.nix:3433`): devuser-class (Q8). Private repositories land in vendor custody; public ones are published. |
| `crates-io` | `cargo publish` | public artefact, code | public internet: crates.io | none. The credential is written whenever `CRATES_TOKEN` is set (`config/entrypoint-unified.sh:3072-3077`). | ADR-2106 (accepted) for `sidestr-*` crates only, each publication approved by the owner case by case (`docs/adr/ADR-2106-sidestr-crates-are-agpl-derivatives-of-siding-published-and-consumed.md:36-47`). Any other crate has none. | **[marker: no gate]** Publication is irreversible (yank only hides a version). Credential `CRATES_TOKEN`: devuser-class (Q8). |
| `cloudflare` | `wrangler` (Workers deploy, D1, `secret put`) and the forum backup cron | code, secret-adjacent | vendor: Cloudflare API | none. `wrangler` is always baked (`flake.nix:531-533`); the backup cron is unconditional (`flake.nix:2643-2649`). | none. | **[marker: no gate]** **[marker: no accepted record]** `wrangler secret put` sends secret values by design. The backup pulls data in but presents the token. Credentials `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`: devuser-class (Q8). |
| `tailscale` | `tailscaled` (`flake.nix:2447-2450`) | secret-adjacent | vendor: Tailscale coordination plane; peers on the tailnet | `[networking].tailscale` (`agentbox.toml:282`), currently `true` | none. ADR-007 (accepted, archived) only covers `tailscaled` running as root; ADR-045 is `proposed`. | **[marker: no accepted record]** Node identity and metadata go to the vendor. Tailnet traffic bypasses the did:nostr boundary (`agentbox.toml:266-272`). The manifest comment says off by default (`agentbox.toml:277-281`) but the value is `true`. Credential `TAILSCALE_AUTHKEY`: devuser-class (Q8). |
| `mcp-research` | Research MCPs: `web-researcher`, `perplexity` (MCP hub) | prompt | vendor: Search and answer vendors (Perplexity and the web-researcher backends) | `[skills.research].web_researcher` (`agentbox.toml:581`), rebuild-class; `perplexity` sits in the MCP hub list (`agentbox.toml:1269-1272`) with no runtime switch | none. | **[marker: no accepted record]** Search queries written by agents, often paraphrasing the task. Credential `PERPLEXITY_API_KEY`: devuser-class (Q8). |

Marked with no gate (5): `primary-model`, `loom-raw`, `github`, `crates-io`, `cloudflare`.

Marked with no accepted-egress record (18): `consultant-codex`, `consultant-antigravity`, `consultant-zai`, `consultant-perplexity`, `consultant-deepseek`, `zai-night`, `ontology-monitor`, `nostr-gateway`, `junkiejarvis-llm`, `dream-forum-suggestions`, `dream-digest`, `dream-governance`, `sidestr-announce`, `sidestr-pages`, `github`, `cloudflare`, `tailscale`, `mcp-research`.

<!-- egress-register:end -->

## Environment classes — 2026-10-03 (custody X-1 step 1, W2)

Bypass 3 of the role-isolation design: compose `env_file` puts `.env` into PID 1, supervisord
hands PID 1's environment to every child, and `identity.env` added `AGENTBOX_NSEC` on top. So
every agent shell, MCP server and hook carried the sovereign key, the JunkieJarvis key and the
break-glass bearer. An agent that ran `env` copied them into a transcript, and the transcript
went to a model provider.

[`config/custody/env-classes.json`](../config/custody/env-classes.json) now names every
environment variable that the boot path and the role-secret consumers read. It lists names
only, never values. Each name is in exactly one class.
`node scripts/ci/env-secret-inventory.js --check` fails CI if a name read in code is
unclassified, if a name is in two classes, or if the table drifts from the entrypoint's scrub
list or from [ADR-2122](adr/ADR-2122-role-service-accounts-run-secrets-and-the-identity-port.md)'s
delivery plan (`config/role-accounts.json`).

| Class | Count | Members | Why |
|---|---|---|---|
| **ROLE** | 11 | `AGENTBOX_PRIVKEY_HEX`, `AGENTBOX_NSEC` and `AGENTBOX_BRIDGE_SK` (the sovereign key under three names); `OPERATOR_NOSTR_PRIVKEY`; `JUNKIEJARVIS_PRIVKEY_HEX` and `CONCIERGE_PRIVKEY_HEX`; `AGENTBOX_AGENT_PRIVKEY_HEX` and `AGENT_PRIVKEY_HEX` (per-agent keys), all `ab-identity`. `NIP98_PROXY_ALLOW_BEARER` and `NIP98_PROXY_SESSION_SECRET` (`ab-ingress`). `TAILSCALE_AUTHKEY` (`root`). | A signing, join or session key belongs to one role. Under `[security].role_isolation` the entrypoint writes it to `/run/secrets/<role>/<NAME>` (`0400`) and unsets it from PID 1 before the identity bootstrap. `identity.env` becomes public-only, and a final scrub before `exec supervisord` logs and removes any that reappear (`ROLE-ISOLATION-LEAK <NAME>`). Readers take `<NAME>_FILE` (or `$AGENTBOX_SECRETS_DIR/<NAME>`). Under the flag they ignore and report the bare variable. |
| **DEVUSER_CLASS** | 35 | `BRIDGE_TOKEN`; `MANAGEMENT_API_KEY`, `AGENTBOX_ACTION_PIPELINE_SECRET`, `WEBHOOK_HMAC_SECRET`, `SOLID_ADMIN_KEY` and `VISIONCLAW_AGENT_KEY` (management-api); `VAULT_NOSTR_SECRET`; the Anthropic, OpenAI, Gemini/Google, DeepSeek, OpenRouter, Perplexity, Brave, Context7, Hugging Face, Z.AI, TypeSafe, System-One, JunkieJarvis-LLM and email-gateway keys; GitHub, crates.io and Cloudflare tunnel tokens; the Postgres/RuVector password and connection string; code-server and Jupyter logins (and two entrypoint-local copies). | **Accepted exceptions** (queen's disposition Q8, pending owner). The agents are these credentials' users, and their processes run as devuser. Each row in the table carries its reason. Two are flagged. `VAULT_NOSTR_SECRET` is a signing key whose only consumer, the external vault CLI, has no file input yet, so it is a ROLE candidate for W3b. `BRIDGE_TOKEN` is below. |
| **NON_SECRET** | ~600 | Paths, ports, switches, model names, public keys, and shell locals. | Nothing to protect. A credential-shaped name can never land here by pattern; it needs an exact entry. |

**The break-glass double, recorded 2026-10-03.** `voice up` copies `BRIDGE_TOKEN` into
`NIP98_PROXY_ALLOW_BEARER` (`management-api/lib/system-manifest.js:79`). The proxy's copy is
ROLE and leaves PID 1 under the flag. `BRIDGE_TOKEN` stays devuser-class because tab0-bridge,
which drives tmux as devuser, needs it. So the LAN-door break-glass credential stays reachable
by devuser until Q4 splits the bearer. The lifecycle belongs to
[ADR-2027](adr/ADR-2027-secret-custody-rotation-break-glass.md) (proposed); this step does not
redesign it.

**What the flag does and does not buy.** The flag ships off, and with it off the environment
handed to supervisord is byte-identical (`tests/runtime-contract/RC-X1-06.sh`). With it on:

- ROLE values are gone from every process's environment and from `tailscale-up`'s argv. That
  closes the transcript and crash-dump leak.
- Until W3's identity port exists, the devuser readers of `ab-identity` files fail closed:
  JunkieJarvis does not start, dream-engine's forum posts stop, and the live mirror seals under
  a throwaway key. Do not turn the flag on before W3b.
- DEVUSER_CLASS credentials are unchanged by design.
- The repo `.env` remains readable on the workspace bind (Q13, host-side).

## Role isolation — 2026-10-03 (custody X-1 step 1, staged)

Decision: [ADR-2122](adr/ADR-2122-role-service-accounts-run-secrets-and-the-identity-port.md)
(proposed, `activation_status: inactive`). Citations are at `custody/integration` `d03defbea`.
Owner procedure: [Turning on role_isolation](developer/role-isolation-runbook.md).

**Staged, not live.** Everything below is in the source on this branch. None of it runs in
an image until the owner rebuilds. None of it is enforced until the flag is on **and**
the two-half rehearsal has passed and landed its receipt. Until then this section describes what
the branch would enforce. It is not a claim about the running container. "Live" in this register
means a passing receipt, never a merge.

### The switch

`[security].role_isolation`, default `false` (`agentbox.toml:2112`,
`setup/agentbox.default.toml:1625`, catalogue `management-api/lib/system-manifest.js:94-96`,
apply class `boot`). The entrypoint reads it once and exports it
(`config/entrypoint-unified.sh:343-361`). The image must carry the custody library, both
supervisor configs and the delivery plan. An image without them logs
`ROLE-ISOLATION-UNAVAILABLE` and boots as if the flag were off (`:352-359`). The first image
built from this branch needs one `./agentbox.sh rebuild`. After that, flipping the flag needs
only a restart.

**With the flag off, the boot is today's**, with one exception: `/run/secrets` becomes its own
tmpfs, which devuser cannot rename. The entrypoint still chowns it to devuser `0700` and writes
the devuser `nostr.key` as before (`config/entrypoint-unified.sh:388-391`, `:1020`). The
environment that reaches supervisord is byte-identical (`tests/runtime-contract/RC-X1-06.sh`).

### The role table

Single source: `config/role-accounts.json`. It is baked into `/etc/passwd`, `/etc/group` and
`/etc/agentbox/role-accounts.json` (`flake.nix:3571-3577`). Each role has its own primary group
with no members, shell `/sbin/nologin` and home `/run/secrets/<role>/home`. uid 965 is skipped:
it is the host docker group (`reserved_ids`).

| Role | uid | Programs under the flag | Secrets in `/run/secrets/<role>/` |
|---|---|---|---|
| `ab-identity` | 960 | `nostr-relay`, `serve-identity` | `nostr.key`, `AGENTBOX_PRIVKEY_HEX`, `AGENTBOX_NSEC`, `JUNKIEJARVIS_PRIVKEY_HEX`, `CONCIERGE_PRIVKEY_HEX` (from PID 1's environment) |
| `ab-gateway` | 961 | `nostr-gateway` | none; it signs through the identity port |
| `ab-ingress` | 962 | `nip98-proxy` | `NIP98_PROXY_ALLOW_BEARER`, `NIP98_PROXY_SESSION_SECRET` (from PID 1's environment) |
| `ab-spend` | 963 | none (account only; Q6 deferred the spend port) | none |
| `ab-sidestr-dreamlab` | 964 | `sidestr-producer` | `signer.key`, `parent.credential` (copied from `/var/lib/agentbox/secrets`) |
| `ab-faucet-dreamlab` | 966 | `sidestr-faucet` | `treasury.key` (copied from the workspace path the manifest names) |
| `ab-sidestr-dreamlab-txbt4` | 967 | `sidestr-producer-dreamlab-txbt4` | `signer.key`, `parent.credential` |
| `ab-faucet-dreamlab-txbt4` | 968 | `sidestr-faucet-dreamlab-txbt4` | `treasury.key` |
| group `ab-identity-port` | 969 | — | members devuser, `ab-identity`, `ab-gateway`; owns the port socket's directory |

management-api, dream-engine, aoe, tmux and the agents stay devuser. JunkieJarvis is a key held
by `ab-identity`, not an account.

### Two supervisor configs

`/etc/supervisord.conf` is today's config. `/etc/supervisord.roles.conf` is derived from it by
`agentbox-manifest role-accounts isolate` (`flake.nix:3571-3576`). In each role program the
derivation changes only the `user=` and `environment=` lines, and
`tests/config/role-isolation-supervisor.test.sh` fails on any other difference. The build itself
fails if a secret-bearing program has no role or a role program is not `user=devuser` in today's
config. The entrypoint picks one
config at its final `exec` (`config/entrypoint-unified.sh:1142-1160`).

### `/run/secrets`

- **The mount.** In both modes `/run/secrets` is its own tmpfs,
  `mode=711,uid=0,gid=0,noexec,nosuid,nodev` (`docker-compose.yml:110`, `flake.nix:3278`).
  Because it is a mount point, devuser, who owns `/run`, cannot rename it.
- **Delivery.** Under the flag the root phase delivers each role's files just before `exec`
  (`ab_role_secrets_deliver`, `config/lib/role-custody.sh:160`). Each role directory is
  `0500` and each file `0400`, owned by the role. A file source is copied only if it is a
  regular file, not a symlink, and at most 64 KiB.
- **The state file.** The result, `ok:` or `degraded:` for `secrets-mount`,
  `secrets-delivery` and `docker-socket`, goes to `/run/secrets/role-isolation.state`.
- **Failure.** A failure never stops the boot. A role whose secret is missing fails closed
  under supervisord.

### The environment classes

The ROLE / DEVUSER_CLASS / NON_SECRET split is the section above ("Environment classes"). Under
the flag:

1. ROLE variables are captured to files and unset before the identity bootstrap
   (`config/entrypoint-unified.sh:489`).
2. `identity.env` is public-only (`services/nostr-pod-bridge/src/bootstrap.rs:230`).
3. A last scrub before `exec` logs `ROLE-ISOLATION-LEAK <NAME>` for anything that reappears
   (`config/entrypoint-unified.sh:1158`).

DEVUSER_CLASS credentials, including `BRIDGE_TOKEN` and the provider keys, stay in devuser's
environment by design.

### The identity port

`nostr-pod-bridge serve-identity` (`[program:serve-identity]`, `flake.nix:2515-2529`) runs as
`ab-identity` under the flag. With the flag off it prints one line and exits 0, so `EXITED` is
its expected status. It serves `/run/secrets/ab-identity-port/identity.sock` (`0660`, group
`ab-identity-port`) and admits callers by `SO_PEERCRED` uid against
`config/custody/identity-port-acl.json`: devuser (1000) and `ab-gateway` (961).

Its operations are a closed list (`services/nostr-pod-bridge/src/identity_port/acl.rs:43`):
`pubkey`, `nip98`, `sign_event` (granted kinds only), `forum_event`, `nip42_auth` and
`mirror_key`. There is no generic sign operation (ADR-2101). Every decision appends one
content-free line under `/var/lib/agentbox/events/sign/`.

The pods signer uses the port when the flag is on (`management-api/lib/pod-signer.js:131`).
JunkieJarvis, the mirror hook, the gateway and dream-engine are not yet cut over (W3b).

### Docker under the flag

The entrypoint does not widen `/var/run/docker.sock` for devuser
(`config/entrypoint-unified.sh:586-612`). devuser's `DOCKER_HOST` points at the GET-only
`[program:docker-read-proxy]`, `/run/docker-ro.sock` (`flake.nix:2493`;
`config/entrypoint-unified.sh:3252-3254`). `ps`, `logs`, `inspect`, `version` and `info`
pass. `exec`, `run`, `create`, `cp` and `export` get 403.

If the host socket is still world-writable, the boot records `degraded:docker-socket`. The fix
is host-side (Q2): `chmod 0660 /var/run/docker.sock` on the host.

### What is still open (the flag gives less than its name until these land)

- **At-rest custody (W2 remainder).** No migrate step on this branch chowns
  `/var/lib/agentbox/secrets`, the identities volume or the workspace treasury keys to root.
  devuser can still read the at-rest copies. The flag protects only the delivered runtime
  copies and the environment.
- **Consumers (W3b).** JunkieJarvis, dream-engine's forum posts, the live-mirror hook and the
  gateway still read keys that leave the environment under the flag, so they fail closed.
- **Producer state and checkouts (W4).** Chain state is still under `$WORKSPACE/sidestr/<chain>`.
  The producer's code is the Nix bake of `config/sidechain/upstream-pins` in both modes
  (custody W5, `config/sidechain/run-producer.sh:64-89`), and that is also staged until the
  rebuild.
- **The AoE share and `role-exec` (W2).** `ab-gateway` and `ab-ingress` still point at
  devuser's `serve.url`. There is no `role-exec` wrapper yet.
- **The break-glass double (Q4).** `NIP98_PROXY_ALLOW_BEARER` equals `BRIDGE_TOKEN`, which
  stays devuser-class.
- **The repo `.env`.** It remains the at-rest home of the ROLE values and is readable on the
  workspace bind (Q13, host-side). The flag moves those values out of the process
  environment. It does not move them out of `.env`.

The register rows of 2026-09-04 and 2026-09-05 above are unchanged by this section. The bridge
key's interface there (`/run/secrets/nostr.key`) is still the flag-off path. Under the flag,
the same key is `/run/secrets/ab-identity/nostr.key`.
