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

## Image selection mechanism

### `AGENTBOX_IMAGE_REF` environment variable

The generated `docker-compose.yml` uses shell-expansion syntax for the agentbox
service image line:

```yaml
image: ${AGENTBOX_IMAGE_REF:-agentbox:runtime-<system>}
```

When `AGENTBOX_IMAGE_REF` is set in the shell environment, compose uses that
value. When it is unset or empty, compose falls back to the locally loaded
`agentbox:runtime-<system>` tag. This means:

- operators with a local Nix build need no extra configuration — the default
  tag matches what `docker load < result` produces.
- operators pulling from a registry export `AGENTBOX_IMAGE_REF` to the ref they
  pulled and run `./agentbox.sh up --registry`.

You can verify the resolved value with:

```sh
docker compose config | grep 'image:'
```

### `agentbox.sh` flag matrix

| Invocation | `AGENTBOX_IMAGE_REF` | Image used |
|---|---|---|
| `./agentbox.sh up` | unset | `agentbox:runtime-<system>` (local build must exist) |
| `./agentbox.sh up` | set | value of `AGENTBOX_IMAGE_REF` |
| `./agentbox.sh up --build` | any | local Nix build tag; `AGENTBOX_IMAGE_REF` is unset for the invocation |
| `./agentbox.sh up --registry` | set | value of `AGENTBOX_IMAGE_REF` |
| `./agentbox.sh up --registry` | unset | **error** — exits 1 with a descriptive message |
| `./agentbox.sh up --build --registry` | any | **error** — mutually exclusive |

In every case, `agentbox.sh up` prints `using image: <resolved-ref>` before
calling `docker compose up` so the active image reference is always visible in
the terminal output.

### Setting the variable

Via `.env` (recommended for persistent registry workflows):

```sh
# .env
AGENTBOX_IMAGE_REF=ghcr.io/dreamlab-ai/agentbox:latest
```

Via export (one-off or CI):

```sh
export AGENTBOX_IMAGE_REF=ghcr.io/dreamlab-ai/agentbox:abc1234def5
./agentbox.sh up --registry
```

## Arch-suffixed tags

The CI pipeline also pushes per-arch tags for diagnostic purposes:

- `ghcr.io/dreamlab-ai/agentbox:<sha>-amd64`
- `ghcr.io/dreamlab-ai/agentbox:<sha>-arm64`

These are single-platform images; use the plain SHA or `:latest` tag in
production so Docker selects the correct arch automatically.
