# Agentbox Provisioning Guide

## Why this exists

`agentbox.sh provision` takes a bare cloud account and produces a running agentbox you can SSH into. Instead of writing Terraform, Ansible or cloud-init by hand, each supported cloud target is a self-contained shell script that handles VM creation, Docker install, image pull and first-boot. The common use case is "my laptop doesn't have enough RAM or a GPU" — provision a cloud host, tunnel the management API back, and carry on.

**What it solves**

- Running agentbox on hardware you do not own without hand-rolling cloud-init.
- Consistent provisioning across Oracle Cloud (free ARM tier), fly.io, Hetzner and any bare SSH host.
- Exit-code 77 (`ENOTSUP`) for unimplemented targets so CI can skip gracefully.

**When to skip this**: if your host already runs Docker, pull the image directly — see [installation.md](installation.md). Provisioning is only for the "bring up a new machine from nothing" case.

## Provisioner Pattern

Each target is a self-contained script in `scripts/provision-<target>.sh`.  
`agentbox.sh provision` dispatches to the right script via `--target`.

```
./agentbox.sh provision [--target <target>] [target-specific options]
```

Default target is `oci` for backward compatibility.

## Target Matrix

| Target    | Script                        | Status      | Notes                          |
|-----------|-------------------------------|-------------|--------------------------------|
| `oci`     | `scripts/provision-oci.sh`    | Implemented | Oracle Cloud ARM, free tier    |
| `fly`     | `scripts/provision-fly.sh`    | Stub (TODO) | fly.io, exits 77               |
| `hetzner` | `scripts/provision-hetzner.sh`| Stub (TODO) | Hetzner Cloud API, exits 77    |
| `bare`    | `scripts/provision-bare.sh`   | Implemented | SSH key setup + Docker check   |

Exit code 77 (`ENOTSUP`) means "not yet implemented" — safe to catch in CI.

## Env Templates

| File                     | Purpose                                   |
|--------------------------|-------------------------------------------|
| `.env.template.common`   | Shared vars for any target (start here)   |
| `.env.template.oci`      | OCI-specific vars (extends common)        |

Copy `.env.template.common` (and the target-specific template) to `.env`, then run
`scripts/start-agentbox.sh` to configure and start the stack interactively.

## Adding a New Target

1. Create `scripts/provision-<target>.sh` (chmod 755).
2. Add a `# Target: <description>` header comment.
3. Add the target name to the `case` statement in `agentbox.sh` `cmd_provision`.
4. Update the target matrix table above.
5. If the target needs new env vars, add them to a new `.env.template.<target>`.
