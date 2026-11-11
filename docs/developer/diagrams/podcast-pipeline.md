# Podcast Pipeline Diagrams

How podcast episodes become ledger pages and governed ontology proposals. Paths are relative to
`skills/podcast-knowledge-ingest/` unless noted; the binaries come from `services/podcast-ingest`.
Last edited 2026-11-11 (ADR-2196), when the weekly run was repaired after three weeks of silent
failure.

---

## 1. Flow: the weekly schedule

`[program:podcast-cron]` (flake.nix, gated by `[skills.podcast_ingest]`) runs supercronic over
`crontab`. Its `environment=` PATH is the whole toolset the jobs need: the two binaries, the
Python env (yt-dlp), coreutils (`tee`), util-linux (`flock`, for `lib-lock.sh`), Node, and
`vault`/`ontomark` from `vaultPackages`. Each job appends to a log in `$VAULT_TRANSCRIPTS`.

```mermaid
flowchart LR
    C["supercronic<br/>[program:podcast-cron]"] --> I["Mon 06:17<br/>run-ingest.sh"]
    C --> P["Mon 08:17<br/>run-promote.sh"]
    C --> S["Mon 08:47<br/>submit-proposals.mjs"]
    I --> IL[".ingest-log.txt"]
    P --> PL[".promote-log.txt"]
    S --> PL
```

## 2. Flow: ingest, promote, submit

```mermaid
flowchart TD
    Y["podcasts.yaml<br/>channels"] --> I1["run-ingest.sh<br/>flock via lib-lock.sh"]
    I1 --> L["podcast-ingest: list<br/>yt-dlp channel listing"]
    L --> D["download subtitles<br/>common/ytdlp.rs:246"]
    D --> T["transcript .md<br/>$VAULT_TRANSCRIPTS"]
    T --> E["extract assertions<br/>ingest/extract.rs:141<br/>(Loom, one call per episode)"]
    E --> V["confidence-tier filter<br/>(local, no external call)"]
    V --> LG["ledger page +<br/>Draft Concept pages"]
    LG --> P1["run-promote.sh<br/>podcast-promote --loom-url $LOOM_BASE_URL"]
    P1 --> DR["dossier drafts<br/>(Loom; Gemini judge if keyed)"]
    DR --> S1["submit-proposals.mjs<br/>ontomark find (class lookup)"]
    S1 --> VP["vault propose<br/>one proposal per topic"]
```

## 3. Failure modes seen on 2026-11-11

| Stage | Symptom in the logs | Cause | State |
|---|---|---|---|
| Ingest | "No new episodes" every week to 19 Oct | wrong channel handle | fixed in `podcasts.yaml` (October) |
| Ingest | "flock not found on PATH" every run after 19 Oct | util-linux missing from the cron PATH | fixed in flake.nix; live at the next image build |
| Ingest | HTTP 429 on subtitle download | YouTube rate limiting | open: not a code fault |
| Promote | "Loom reachability: UNREACHABLE" | default `http://loom:8080/v1` does not resolve here | fixed: `run-promote.sh` passes `$LOOM_BASE_URL` |
| Submit | "no `ontomark` binary" | ontomark missing from the cron PATH | fixed in flake.nix; live at the next image build |

The cron lines pipe through `tee`, so a failing job still exits 0 to supercronic; read the two
logs, not the supervisor status, to tell whether a week succeeded.
