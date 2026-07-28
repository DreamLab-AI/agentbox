---
name: "gcloud"
description: "Google Cloud CLI (gcloud/gsutil/bq) for GCP operations from agentbox: Compute Engine VMs, Identity-Aware Proxy (IAP), Secret Manager, Cloud Run, Artifact Registry, Cloud NAT/firewall. Use when a task involves deploying to or operating Google Cloud — standing up a VM behind IAP, granting/impersonating a deploy service account, managing GCP secrets, or the campaignbuilder VPS deployment. Installed via the nix flake (basePackages); auth is interactive (operator-run) and creds live in the writable ~/.config/gcloud."
---

# gcloud — Google Cloud CLI in agentbox

The `google-cloud-sdk` (gcloud, gsutil, bq) is provisioned in the nix image
(`flake.nix` → `basePackages`), so `gcloud` is on `$PATH` in every shell. This skill
covers using it correctly **in this container's constraints** and the canonical GCP
deployment (the `campaignbuilder` VPS behind IAP).

## Environment constraints (read first)

- **`/home/devuser` is READ-ONLY.** Only `~/workspace` and `~/.config` are writable.
  gcloud's config/credential dir defaults to `~/.config/gcloud` — writable, so
  `gcloud auth login` and `gcloud config` work with no override.
- **Auth is INTERACTIVE and operator-run.** An agent cannot complete `gcloud auth login`
  (it opens a browser/entered code). Ask the operator to run it in the session with the
  `!` prefix:
  ```
  ! gcloud auth login
  ! gcloud config set project <PROJECT_ID>
  ```
  After that, the agent's own `gcloud` calls reuse the stored credentials.
- **Prefer impersonation over downloaded keys.** Do not create/handle JSON service-account
  key files. Use a deploy service account the operator can impersonate:
  ```
  gcloud <cmd> --impersonate-service-account="<sa>@<project>.iam.gserviceaccount.com"
  ```
  Verify access with:
  ```
  gcloud auth print-access-token --impersonate-service-account="<sa>@<project>…"
  ```
- **Never commit credentials.** `~/.config/gcloud`, access tokens, and any key material
  stay out of git. Application-default creds and tokens are runtime-only.

## The canonical deployment — `campaignbuilder`

- **Project:** `campaignbuilder-503809` · **Deploy SA (impersonate):**
  `campaignbuilder-deployer@campaignbuilder-503809.iam.gserviceaccount.com`
- **Identity connector:** the app validates Google **IAP** (`gcp-iap` auth mode) — a
  signed `X-Goog-IAP-JWT-Assertion` verified against Google's fixed JWKS. The deployment
  puts the pod behind an IAP-gated external HTTPS load balancer.
- **Full runbook:** the `campaignbuilder` repo's `docs/runbooks/gcp-vps-deploy.md` — 10
  idempotent phases (VPC + Cloud NAT egress, IAP-range firewall `130.211.0.0/22` +
  `35.191.0.0/16`, GCE `e2-standard-2/4` with no external IP, Secret Manager for
  DB/cookie/model secrets, HTTPS LB + managed cert, IAP enable → derive the audience →
  feed `CAMPAIGNBUILDER_AUTH_AUD`, e2e verify, snapshot backups).
- **Least-privilege grant to ask the project owner for** (impersonation, not a key):
  `roles/compute.admin`, `roles/iam.serviceAccountAdmin` + `roles/iam.serviceAccountUser`,
  `roles/secretmanager.admin`, `roles/serviceusage.serviceUsageAdmin`, and `roles/iap.admin`
  for the full IAP path — all at **project scope**, no `projectIamAdmin`.

## Common operations

```bash
# Identity / project
gcloud auth list                                   # who am I
gcloud config get-value project
gcloud projects describe <PROJECT_ID> --format='value(projectNumber)'

# Enable APIs (idempotent)
gcloud services enable compute.googleapis.com iap.googleapis.com secretmanager.googleapis.com

# Compute Engine (check-before-create pattern — describe, then create)
gcloud compute instances describe <VM> --zone=<ZONE> --format='value(status)' \
  || gcloud compute instances create <VM> --zone=<ZONE> --machine-type=e2-standard-2 --no-address …

# Secret Manager (values via stdin — never a file on disk)
printf '%s' "$(openssl rand -base64 32)" | gcloud secrets create <name> --data-file=-
gcloud secrets versions access latest --secret=<name>

# IAP-brokered SSH (Google IAM, not host SSH) — this is authorised from agentbox
gcloud compute ssh <VM> --zone=<ZONE> --tunnel-through-iap --command '…'

# Derive the IAP audience for the app's gcp-iap auth mode
PN=$(gcloud projects describe <PROJECT_ID> --format='value(projectNumber)')
BID=$(gcloud compute backend-services describe <BACKEND> --global --format='value(id)')
echo "/projects/${PN}/global/backendServices/${BID}"   # → CAMPAIGNBUILDER_AUTH_AUD
```

## Execution contract for agents

1. **Check before create** — every step is idempotent (`describe` then `create`).
2. **Stop on failure** — a half-built LB/firewall is worse than none; surface it.
3. **Resolve values, don't guess** — the IAP audience is *derived* from the backend
   service, never hard-coded.
4. **Secrets never to disk or git** — stdin into Secret Manager; tokens are runtime-only.
5. **Surface interactive steps to the operator** — `gcloud auth login`, OAuth consent, and
   the IAP brand are operator actions; provide the exact `! gcloud …` line.

## Notes

- Installed via `flake.nix` `basePackages` (`pkgs.google-cloud-sdk`) — persistent across
  rebuilds. (A prior userland bundle in `~/workspace/.tools` predates this; the nix
  package supersedes it once rebuilt.)
- Not an MCP server — this is a CLI skill (progressive disclosure): the front-matter
  description is the discovery surface; this body is the on-demand detail.
- Related: the `campaignbuilder` repo (the app + the runbook), and the pod's `gcp-iap`
  connector in `control-plane/src/auth/verify.ts`.
