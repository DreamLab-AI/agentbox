# Agentbox Provisioning Guide

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
