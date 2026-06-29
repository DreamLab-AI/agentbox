# Git-versioned Pods

Every user solid pod can be a git repository. When
`[sovereign_mesh.git].enabled = true` in `agentbox.toml`,
each pod directory is initialised with `git init -b main` at
provisioning time (solid-pod-rs 0.4.0-alpha.12,
`solid_pod_rs_git::init::GitAutoInit`, parity row 200,
mirroring JSS issues #466/#469/#471).

## What this means

- Pod resources (`profile/card`, `settings/`, `events/`, etc.) are
  tracked as committed files inside the git object store.
- Agents can `git clone` a pod, push enrichments, and have a full
  offline copy with provenance from the git tree-SHA.
- The combination of NIP-42/NIP-98 Nostr signatures (who published)
  and git tree-SHA (what content) provides two-layer provenance per
  bead (see the host project's ADR-033).

## Clone a pod

```bash
# Replace <AGENTBOX_URL> with your agentbox base URL
# Replace <NPUB_HEX> with the 64-char hex pubkey of the pod owner

# Clone (read-only if read_public = true, otherwise NIP-98 token required)
git clone http://<AGENTBOX_URL>/pods/<NPUB_HEX>/.git my-pod

# Clone with NIP-98 bearer auth (required for private pods / push)
git clone --config http.extraHeader="Authorization: Bearer <NIP98_TOKEN>" \
  http://<AGENTBOX_URL>/pods/<NPUB_HEX>/.git my-pod
```

## Check clone URL

```bash
curl http://<AGENTBOX_URL>/pods/<NPUB_HEX>/clone-url
# → {"npub":"<NPUB_HEX>","clone_url":"http://.../pods/<NPUB_HEX>/.git","is_git_repo":true}
```

## Push to a pod

Push is restricted to the pod owner (NIP-98 pubkey must match npub).

```bash
cd my-pod
# Add a file
echo "hello" > hello.txt
git add hello.txt
git commit -m "initial content"

# Push (owner only)
git push --config http.extraHeader="Authorization: Bearer <NIP98_TOKEN>" \
  origin main
```

Agentbox enforces `receive.denyCurrentBranch = updateInstead` so the
push updates the pod's working tree in place without needing a bare
repo layout.

## Configuration (`agentbox.toml`)

```toml
[sovereign_mesh.git]
enabled           = true          # enable git auto-init at provisioning
auto_init         = true          # git init -b main at POST /pods
default_branch    = "main"        # JSS #471 contract
http_backend      = "git-http-backend"   # CGI binary name
http_route_prefix = "/pods"       # base path for management-api routes
max_push_mb       = 100           # per-push body limit
auth_mode         = "nip98"       # NIP-98 bearer required for write
read_public       = false         # set true to allow anonymous clone
```

## Validator rules

The agentbox config validator checks:

| Code | Rule |
|------|------|
| E059 | `[sovereign_mesh.git].enabled = true` requires `sovereign_mesh.solid_pod = true` |
| E061 | `http_route_prefix` must start with `/` |
| E062 | `max_push_mb` must be a positive integer |
| W063 | Advisory: ensure `git` binary and `git-http-backend` CGI are installed |

## HTTP routes

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/pods/:npub/.git/info/refs?service=…` | Git smart HTTP advertisement |
| `POST` | `/pods/:npub/.git/git-upload-pack` | Clone / fetch |
| `POST` | `/pods/:npub/.git/git-receive-pack` | Push (owner only) |
| `GET` | `/pods/:npub/.git/HEAD` | Symbolic HEAD ref (public) |
| `GET` | `/pods/:npub/clone-url` | Returns clone URL JSON |

## CF Workers note

The NRF pod-worker (Cloudflare Workers) cannot use git auto-init
because CF Workers cannot spawn subprocesses. The `[git].enabled =
false` setting in `dreamlab.toml` reflects this limitation. See
NRF ADR-089 for the full analysis. Agentbox and self-hosted
solid-pod-rs-server deployments are unaffected.

## Parity with JSS

| JSS issue | Feature | solid-pod-rs |
|-----------|---------|-------------|
| #466 | `tryAutoInitRepo` at pod creation | `GitAutoInit::try_init_repo` |
| #469 | `receive.denyCurrentBranch = updateInstead` | applied in `GitAutoInit` |
| #471 | Default branch `main` (JSS contract) | `GitAutoInit::default_branch = "main"` |

Parity rows 199 (trait) and 200 (impl) in `PARITY-CHECKLIST.md`.
