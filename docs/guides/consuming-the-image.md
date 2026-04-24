# Consuming the agentbox image

## Registry and tags

| Tag | Use |
|---|---|
| `ghcr.io/dreamlab-ai/agentbox:latest` | Latest build from `main`; updated on every merge |
| `ghcr.io/dreamlab-ai/agentbox:<git-sha>` | Pinned immutable build; preferred for production |
| `ghcr.io/dreamlab-ai/agentbox:<semver>` | Release builds, e.g. `v2.1.0` |

All tags are multi-arch manifests covering `linux/amd64` and `linux/arm64`.

## Pulling the image

```bash
docker pull ghcr.io/dreamlab-ai/agentbox:latest
```

Docker resolves the correct arch variant automatically from the manifest. No
`--platform` flag is needed on either x86_64 or ARM64 hosts.

To pin to a specific SHA:

```bash
docker pull ghcr.io/dreamlab-ai/agentbox:abc1234def5
```

## Running

Minimum viable invocation:

```bash
docker run --rm -it \
  -e ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY}" \
  -p 9090:9090 \
  ghcr.io/dreamlab-ai/agentbox:latest
```

For a full operator setup with persistent workspace and manifest overrides, use
the generated `docker-compose.yml` (produced by `nix build .#compose`) and
`.env` file documented in [`quick-start.md`](quick-start.md).

## Arch-suffixed tags

The CI pipeline also pushes per-arch tags for diagnostic purposes:

- `ghcr.io/dreamlab-ai/agentbox:<sha>-amd64`
- `ghcr.io/dreamlab-ai/agentbox:<sha>-arm64`

These are single-platform images; use the plain SHA or `:latest` tag in
production so Docker selects the correct arch automatically.
