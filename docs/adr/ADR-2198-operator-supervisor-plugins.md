---
id: ADR-2198
title: Agentbox is a public host; operator systems are private plugins it loads
date: 2026-11-12
decision_status: proposed
implementation_status: none
activation_status: inactive
supersedes: []
superseded_by: []
verified_commit:
verified_paths: []
owner: jjohare
review_trigger: before the next image rebuild that adds a supervised program, or when [user_cron] carries a second operator domain
repo: agentbox
evidence_class:
acceptance_boundary:
---

# ADR-2198 — Agentbox is a public host; operator systems are private plugins it loads

## Context
- Agentbox is a general-purpose image, but `flake.nix` bakes programs that serve one operator's estate: `podcast-cron`, `seo-watch-cron` (dreamlab-ai.com), `forum-backup-cron`, `diagram-review-cron`, `sidestr-{producer,mirror,faucet}[-<chain>]`, `poker-citizen[-<chain>]` and `poker-coach`. They are gated by `agentbox.toml` flags (ADR-2057 gap 1), but each is a REBUILD-class change to the image and a public config section.
- `[user_cron]` already shows the alternative: `[program:user-cron]` runs supercronic over `~/workspace/.local/etc/agentbox/user.crontab` on the persistent volume. Operator jobs (one estate's heating logger, guard, watch and digest: 12 entries) live there with no image change, survive rebuilds, and keep private project names out of this repository.
- `user-cron` is one crontab and one log. Its jobs have no declared secrets, no health check, no grouping, and one stuck job's output is mixed with every other's. It cannot host a long-running daemon.
- Each new operator service currently costs a `flake.nix` block, an `agentbox.toml` section, a config test and a rebuild.

## Decision
0. **The split.**
   - **Agentbox, the public image,** is a host. It ships the runtime, the plugin loader and the services every user needs.
   - **Everything specific to one operator's estate is a plugin.** Examples: a house's heating logger, guard and alerts; a website's SEO watch; a podcast pipeline; a sidechain economy. The plugin's code, manifest and data live in that operator's **private** repositories and workspace.
   - **Agentbox never names a plugin, carries its config, or needs a rebuild to add one.** Operators can only add plugins on top; nothing in the public repository changes.
   - **Plugin sources:** a gitignored registry, `~/workspace/.local/etc/agentbox/plugins.toml`, maps names to plugin directories, for example `heating = "<private repo>/…/agentbox-plugin"`. A plugin directory can sit inside a private repository, so its manifest is versioned with the code it runs. `plugins/<name>/` under the same folder is the default location when there's no repository.
1. **A plugin directory** holds:
   - `plugin.toml` (required):
     - `name`, `enabled`, `description`;
     - `kind = "cron" | "daemon" | "both"`;
     - `secrets = [...]`: role-custody names, resolved to files under `/run/secrets/<role>/` when ADR-2122 role isolation is on, never values;
     - `needs = [...]`: other plugins or image services (e.g. `"nostr-bridge"`, `"docker-read-proxy"`);
     - `health`: a command, plus the longest silence allowed;
   - `crontab`: supercronic lines, if `kind` includes cron;
   - `program.conf`: if `kind` includes daemon. It is a supervisord `[program:plugin-<name>]` fragment. The loader validates it before including it: `user=devuser` only, no `[supervisord]` or `[include]` sections, command under the plugin directory or the workspace.
2. **The image carries only the loader** (`agentbox-plugins`, a Rust binary in the closure, run as an entrypoint phase just before `exec supervisord`, and on demand). It:
   - validates each enabled plugin, then writes `/run/agentbox/plugins.d/<name>.conf`. `/etc` is a read-only Nix store link, so the generated fragments live on tmpfs and are rebuilt every boot from the registry;
   - for cron plugins, writes one `[program:plugin-<name>-cron]` that runs supercronic with `-inotify` over the plugin's own crontab, so each plugin gets its own log under `/var/log/plugin-<name>*.log`;
   - is reached from supervisord through a baked `[include] files = /run/agentbox/plugins.d/*.conf`, which matches nothing when no plugin is registered. Both `supervisord.conf` and the role-isolated `supervisord.roles.conf` carry it. Plugin programs always run as devuser;
   - offers `agentbox-plugins list | check | reload`, where `reload` runs `supervisorctl reread && update`. No rebuild is needed for a plugin change.
   - **An invalid plugin is skipped and reported.** It never blocks boot.
3. **One health surface.** `agentbox-plugins check` runs each plugin's `health` command and reports staleness. It feeds `claude-flow doctor`, and an operator plugin may send its own alerts. Plugins never write to the dream engine or to `agentbox.toml`.
4. **What stays in the image:** programs any agentbox user needs (bootstrap, management-api, solid-pod, nostr relay and gateway, MCP hub, sessions, code-server, desktop, dream engine, ruvector maintenance, `user-cron`). `user-cron` stays as the zero-ceremony path for a few lines.
5. **What migrates out,** one ADR-tracked step per row, each keeping its current behaviour:

   | Program | Becomes plugin | Notes |
   |---|---|---|
   | `podcast-cron` | `podcast-ingest` | `podcast-ingest` binary stays in the closure (shared with skills) |
   | `seo-watch-cron` | `seo-watch` | website-owned crontab path unchanged |
   | `forum-backup-cron` | `forum-backup` | |
   | `diagram-review-cron` | `diagram-review` | needs `GEMINI_API_KEY` via `secrets` |
   | `sidestr-*`, `poker-*` | `sidechain-<chain>`, `poker-<chain>` | daemons; one plugin per chain |
   | operator heating jobs (now in `user.crontab`) | `heating` | first pilot: cron only, no image dependency |

6. **Packaging:** binaries a plugin runs come from the workspace (`~/workspace/.local/bin`, built by the operator) or from the image closure when shared with a baked skill. A plugin never asks the image to add a package; that remains an image ADR.

## Consequences
- **Gains:**
  - The public image and `agentbox.toml` lose their estate-specific sections. A new operator service, or a changed one, needs no rebuild.
  - Each plugin gets its own log, health check and declared secrets.
- **Costs:**
  - A boot-phase loader and its validation, plus a supervisord `[include]`.
  - Tests that each migrated program still starts with the same command and environment.
  - Under role isolation, plugins that use secrets need custody entries for each role.
- **Risk:** a plugin's `program.conf` runs arbitrary commands as devuser, exactly as `user-cron` already does. The loader restricts it to devuser and refuses supervisord-level sections. Nothing broader is allowed.
- **Forbidden after migration:** new estate-specific `[program:*]` blocks in `flake.nix`. Each must be a plugin unless an ADR shows every agentbox user needs it.
- **Phases** (each its own change, with tests):
  1. Ship the loader, the `[include]`, the registry format and `agentbox-plugins list | check | reload` in the image, with **no plugins migrated**. The image works the same whether the registry is present or empty.
  2. Pilot with the heating plugin from its private repository. Its 12 `user.crontab` lines move into the plugin's crontab, and its health check reports logger staleness.
  3. Migrate the baked estate programs one per release, then delete their `flake.nix` blocks and `agentbox.toml` sections.
  4. Consider extending plugins beyond supervised programs: skills, MCP servers and hooks contributed by a private plugin. Each needs its own ADR.
- **Follow-on:**
  - `agentbox-plugins` implementation and tests;
  - the heating pilot, moving 12 lines out of `user.crontab`;
  - one migration per table row;
  - deletion of the corresponding `agentbox.toml` sections once their plugins are live.

## Verification
Proposed; nothing is implemented. Inventory taken at `62a85c02358e56e18be37713505d2bbe08a31538`:
- the `[program:` blocks listed in `/etc/supervisord.conf`;
- the `flake.nix` gates for `podcast-cron` (around line 299 and line 3114), `[sidechain]` and `[poker_citizen]`;
- the `[user_cron]` section of `agentbox.toml`.

The `user-cron` pilot has evidence already: it ran 12 operator jobs across the container restart at 20:02 UTC on 11 Nov 2026 with no intervention.
