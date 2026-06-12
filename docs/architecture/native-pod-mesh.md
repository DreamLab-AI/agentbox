# Native Pod Mesh — Architecture & Wiring

> **Status**: Live. Shipped at alpha.15; `lib/solid-pod-rs.nix` is now pinned
> to `v0.4.0-alpha.17` (the first unambiguous tag after the alpha.15 aliasing).
> agentbox build: `./agentbox.sh update && nix build .#runtime`

The native pod mesh extends the DreamLab platform with a sovereign, git-versioned Solid
pod tier running inside the agentbox container. Forum users in eligible cohorts see a
second "Native pod" card. Agent intelligence in the container collaborates with humans
across a shared `did:nostr` identity space, with all state living in WAC-protected Solid
pods.

---

## 1. Two-Tier Pod Architecture

```mermaid
graph TB
    subgraph CF["Cloudflare Edge"]
        direction TB
        FW["Forum Client\n(Leptos WASM)"]
        AW["auth-worker\nWebAuthn · NIP-98\nProvisioning relay"]
        PW["pod-worker\nSolid HTTP · R2\n(no git)"]
        RW["relay-worker\nNostr WebSocket\nDurable Objects"]
    end

    subgraph AGENTBOX["Agentbox Container (on-prem)"]
        direction TB
        MGMT["management-api\nFastify · NIP-98\nPOST /admin/users/provision"]
        SPR["solid-pod-rs-server\nv0.4.0-alpha.17 · git feature\nPSK /_admin/provision"]
        NOSTR["Nostr Bridge\nnip98 · relay fanout"]
        VC["VisionClaw\nBrokerActor\nGovernance events 31400-31405"]
        RUVEC["RuVector\nMiniLM-L6-v2 embeddings\nHNSW semantic search"]
    end

    subgraph TUNNEL["Cloudflare Tunnel"]
        CFD["cloudflared\ndreamlab-native-pods"]
    end

    USER["User Browser"]
    ADMIN["Forum Admin\nNative Pods tab"]

    USER -->|"passkey · NIP-98"| AW
    USER -->|"Solid HTTP"| PW
    USER -->|"Nostr events"| RW
    FW -->|"2nd pod card\n(native probe)"| CFD
    CFD -->|"pods-native.dreamlab-ai.com → :8484"| SPR
    ADMIN -->|"POST /api/native-pod/provision\nNIP-98 admin"| AW
    AW -->|"POST /_admin/provision/{pk}\nX-Pod-Admin-Key PSK"| CFD
    MGMT -->|"POST /_admin/provision/{pk}\ninternal :8484"| SPR
    VC -->|"kind 31400-31405\ngovernance events"| RW
    NOSTR -->|"relay fanout"| RW
    SPR --- RUVEC
    MGMT --- NOSTR
    MGMT --- VC

    style CF fill:#f0a500,color:#000
    style AGENTBOX fill:#1a1a2e,color:#fff
    style TUNNEL fill:#e07b39,color:#fff
```

---

## 2. Pod Provisioning Flow

```mermaid
sequenceDiagram
    actor Admin as Forum Admin
    participant FW as Forum Client<br/>(Leptos WASM)
    participant AW as auth-worker<br/>(CF)
    participant CFT as Cloudflare Tunnel<br/>pods-native.dreamlab-ai.com
    participant SPR as solid-pod-rs-server<br/>:8484 (agentbox)
    participant FS as Pod Filesystem<br/>/var/lib/solid/pods/

    Admin->>FW: Enter pubkey → Provision
    FW->>AW: POST /api/native-pod/provision<br/>Authorization: Nostr <NIP-98>
    AW->>AW: Verify NIP-98 signature<br/>Check admin pubkey in config
    AW->>AW: Read NATIVE_POD_URL<br/>NATIVE_POD_ADMIN_KEY secrets
    AW->>CFT: POST /_admin/provision/{pubkey}<br/>X-Pod-Admin-Key: <PSK>
    CFT->>SPR: Forward (internal network)
    SPR->>SPR: Validate X-Pod-Admin-Key
    SPR->>FS: mkdir pods/{pubkey}/<br/>write .acl (WAC owner-only)<br/>git init -b main
    SPR-->>CFT: 201 { pod_url, web_id }
    CFT-->>AW: 201
    AW-->>FW: 201 { pod_url, web_id, git_url }
    FW-->>Admin: Pod card appears in browser
```

**Alternative path — management-api direct (internal ops):**

```mermaid
sequenceDiagram
    actor Operator
    participant MGMT as management-api<br/>:9090 (agentbox)
    participant SPR as solid-pod-rs-server<br/>:8484 (agentbox)
    participant FS as Pod Filesystem

    Operator->>MGMT: POST /admin/users/provision<br/>{ pubkey }  ·  NIP-98 auth
    MGMT->>SPR: POST /_admin/provision/{pubkey}<br/>X-Pod-Admin-Key: $SOLID_ADMIN_KEY
    SPR->>FS: mkdir · .acl · git init
    SPR-->>MGMT: 201 (or 409 already-exists)
    MGMT-->>Operator: 201 { pod_url, web_id, git_url, did }
```

---

## 3. Identity Fabric — did:nostr across tiers

```mermaid
graph LR
    subgraph IDENTITY["Shared Identity Layer"]
        PUBKEY["secp256k1 pubkey\n(hex, 64 chars)"]
        DID["did:nostr:&lt;pubkey&gt;"]
        WEBID["WebID\nhttps://pods[-native].dreamlab-ai.com\n/{pubkey}/profile/card#me"]
        NIP05["NIP-05 identity\nname@dreamlab.ai"]
    end

    subgraph CF_TIER["CF Workers Tier"]
        CF_POD["R2 Solid pod\npods.dreamlab-ai.com/{pk}/"]
        CF_DID["did:nostr resolver\nauth-worker"]
        CF_NIP["NIP-05 resolver\nD1 → pod fallback"]
    end

    subgraph NATIVE_TIER["Native Tier (agentbox)"]
        NAT_POD["FS Solid pod\npods-native.dreamlab-ai.com/{pk}/\ngit-versioned"]
        NAT_DID["did:nostr resolver\nsolid-pod-rs-nostr"]
        NAT_GIT["Git API\n/_git/{pk}/*\n9 REST routes"]
    end

    PUBKEY --> DID
    DID --> WEBID
    DID --> NIP05
    PUBKEY --> CF_POD
    PUBKEY --> NAT_POD
    CF_DID -.->|"resolves"| WEBID
    NAT_DID -.->|"resolves"| WEBID
    CF_NIP -.->|"D1 cache → pod HTTP"| WEBID
    NAT_POD --> NAT_GIT

    style IDENTITY fill:#2d2d44,color:#fff
    style CF_TIER fill:#f0a500,color:#000
    style NATIVE_TIER fill:#1a1a2e,color:#fff
```

A user's `did:nostr:<pubkey>` resolves identically on both tiers. The forum client's
WebID document (in the CF R2 pod) records `pod_base_url`; the native pod card is
surfaced as a second browser entry rather than replacing the CF pod.

---

## 4. Agent–Human Collaboration Bus

```mermaid
graph TB
    subgraph AGENTS["Agentbox Agents"]
        VC["VisionClaw\nBrokerActor\npubkey: 11ed6422..."]
        KEA["Knowledge Enrichment Agent\npubkey: e18f1dc1..."]
        MOD["Moderation Bot\npubkey: 5d80b5fa..."]
        WB["Welcome Bot\npubkey: 94f74e9c..."]
    end

    subgraph RELAY["Nostr Relay (relay-worker)"]
        direction TB
        R1["kind 1/42 — posts/DMs\nallowlist gated"]
        R2["kind 30910-30916 — moderation"]
        R3["kind 31400-31405 — governance\nagent pubkeys only"]
    end

    subgraph FORUM["Forum Client (Human)"]
        GOV["Governance Dashboard\n/community/#/governance"]
        POD["Pod Browser\nCF pod + Native pod"]
        CHAT["Chat / DMs"]
    end

    subgraph PODS["Solid Pods (shared state)"]
        CPOD["CF R2 pod\n{pk}/profile/card\n{pk}/private/privkey.jsonld"]
        NPOD["Native FS pod\n{pk}/ (git-versioned)\n{pk}/apps/manifest.json"]
    end

    VC -->|"31400 panel def\n31402 action request"| R3
    KEA -->|"31402 KG update proposal"| R3
    MOD -->|"30910 ban\n30916 unban"| R2
    WB -->|"kind 1 welcome DM"| R1
    R3 -->|"stream"| GOV
    R2 -->|"enforce"| CHAT
    R1 --> CHAT
    GOV -->|"31403 approve/reject\nNIP-98 signed"| R3
    R3 -->|"31403 response"| VC
    POD -->|"NIP-98 GET/PUT"| CPOD
    POD -->|"NIP-98 /_git/*"| NPOD
    VC -->|"read/write\nagent memory"| NPOD
    KEA -->|"KG updates"| NPOD

    style AGENTS fill:#1a1a2e,color:#fff
    style RELAY fill:#2d4a1e,color:#fff
    style FORUM fill:#f0a500,color:#000
    style PODS fill:#3d1a4e,color:#fff
```

---

## 5. CORS + PSK Security Boundary

```mermaid
graph LR
    subgraph INTERNET["Public Internet"]
        BROWSER["User Browser\nhttps://dreamlab-ai.com"]
        BAD["Untrusted Origin\ne.g. attacker.com"]
    end

    subgraph EDGE["Cloudflare Edge"]
        CFT["Cloudflare Tunnel\nTLS termination"]
    end

    subgraph INTERNAL["Internal Network (pod-internal bridge)"]
        SPR["solid-pod-rs-server\n:8484"]
    end

    BROWSER -->|"Origin: https://dreamlab-ai.com\n→ ACAO header returned"| CFT
    BAD -->|"Origin: attacker.com\n→ 403 (CORS denied)"| CFT
    CFT --> SPR
    SPR -->|"SOLID_ALLOWED_ORIGINS check\non every request"| SPR

    subgraph ADMIN_PATH["Admin Provision Path"]
        AW2["auth-worker\n(CF)"]
        AW2 -->|"X-Pod-Admin-Key: $PSK\nonly from CF Worker\nnot from browser"| CFT
    end

    style INTERNET fill:#cc3333,color:#fff
    style EDGE fill:#e07b39,color:#fff
    style INTERNAL fill:#1a1a2e,color:#fff
    style ADMIN_PATH fill:#2d4a1e,color:#fff
```

The PSK (`SOLID_ADMIN_KEY`) is never sent from the browser — it travels only from the
CF auth-worker (a server-side process) to the tunnel, so it is not visible to forum users
even if they intercept their own traffic.

---

## 6. Build & Deployment

```mermaid
flowchart TD
    A["1. Rev bump\nlib/solid-pod-rs.nix\nversion + rev"] --> B
    B["2. ./agentbox.sh update\n→ prefetch-hashes.sh\n  • srcHash (nix-prefetch-url)\n  • Cargo.lock regen\n  • FOD loop (build iterations)"] --> C
    C["3. nix build .#runtime\nsolid-pod-rs-server compiled\nwith features:\ngit · admin-provision\ncors-allowlist · did-nostr\nsecurity-primitives"] --> D
    D["4. Host rebuild\n./scripts/launch.sh rebuild dev\nor ./agentbox.sh rebuild"] --> E
    E["5. supervisord restarts\n[program:solid-pod]\nenv: SOLID_ADMIN_KEY\nSOLID_ALLOWED_ORIGINS"] --> F
    F["6. Start tunnel sidecar\ndocker compose\n-f docker-compose.solid-pods.yml\nup -d cloudflared-pod"] --> G
    G["7. Verify\ncurl https://pods-native.dreamlab-ai.com\n/.well-known/solid"]

    style A fill:#2d2d44,color:#fff
    style B fill:#2d4a1e,color:#fff
    style C fill:#1a1a2e,color:#fff
    style D fill:#1a1a2e,color:#fff
    style E fill:#1a3a4a,color:#fff
    style F fill:#e07b39,color:#fff
    style G fill:#2d4a1e,color:#fff
```

### Hash resolution is automatic

Running `./agentbox.sh update` (or `./scripts/prefetch-hashes.sh --service solid-pod-rs`)
after a version bump in `lib/solid-pod-rs.nix`:

1. Fetches the new tarball and patches `srcHash`
2. Clones the rev and runs `cargo generate-lockfile` → patches `lib/solid-pod-rs.cargo-lock`
3. Runs the iterative `nix build` loop to resolve any remaining FOD mismatches

No manual hash editing is required.

---

## 7. Environment Variables

| Variable | Set in | Consumed by | Purpose |
|---|---|---|---|
| `SOLID_ADMIN_KEY` | `.env.solid-pods` / host env | `solid-pod-rs-server` (supervisord), `management-api` | PSK for `/_admin/provision` |
| `SOLID_ALLOWED_ORIGINS` | `agentbox.toml` `allowed_origins` | `solid-pod-rs-server` | CORS allowlist |
| `SOLID_POD_BASE_URL` | supervisord env | `management-api` | Internal URL to solid-pod-rs |
| `SOLID_POD_PUBLIC_URL` | `.env.solid-pods` | `management-api` (pod_url in responses) | Public tunnel URL |
| `CLOUDFLARE_TUNNEL_TOKEN` | `.env.solid-pods` | `cloudflared-pod` container | CF Tunnel auth |
| `NATIVE_POD_URL` | GH secret → Trunk build env | `forum-client` WASM (compile-time) | Second pod card URL |
| `NATIVE_POD_ADMIN_KEY` | GH secret → CF Worker secret | `auth-worker` | PSK forwarded to native server |

### Secret lifecycle

```mermaid
graph LR
    ENV[".env.solid-pods\n(on host, never committed)"]
    GHS["GitHub Secrets\nNATIVE_POD_URL\nNATIVE_POD_ADMIN_KEY"]
    CFS["CF Worker Secrets\ndreamlab-auth-api\nNATIVE_POD_URL\nNATIVE_POD_ADMIN_KEY"]
    TRUNK["Trunk build env\nNATIVE_POD_URL\n(compile-time const)"]
    SPRD["supervisord env\nSOLID_ADMIN_KEY\nSOLID_ALLOWED_ORIGINS"]

    ENV -->|"manual: set in GH UI"| GHS
    GHS -->|"set-worker-secrets.yml\n(workflow dispatch)"| CFS
    GHS -->|"deploy.yml Trunk step\nenv: NATIVE_POD_URL"| TRUNK
    ENV -->|"--env-file .env.solid-pods\ndocker compose"| SPRD

    style ENV fill:#cc3333,color:#fff
    style GHS fill:#2d4a1e,color:#fff
    style CFS fill:#f0a500,color:#000
    style TRUNK fill:#1a3a4a,color:#fff
    style SPRD fill:#1a1a2e,color:#fff
```

---

## 8. API Reference

### `POST /admin/users/provision` (management-api)

**Auth**: NIP-98 signed by operator pubkey or `admin_pubkeys`  
**Body**: `{ "pubkey": "<64-hex>" }`  
**Response 201**:
```json
{
  "pod_url":        "https://pods-native.dreamlab-ai.com/pods/{pubkey}/",
  "web_id":         "https://pods-native.dreamlab-ai.com/pods/{pubkey}/profile/card#me",
  "git_url":        "https://pods-native.dreamlab-ai.com/pods/{pubkey}/.git",
  "did":            "did:nostr:{pubkey}",
  "already_existed": false
}
```

### `POST /_admin/provision/{pubkey}` (solid-pod-rs-server)

**Auth**: `X-Pod-Admin-Key: <PSK>` header  
**Creates**: `$STORAGE_ROOT/pods/{pubkey}/` with WAC `.acl` + `git init -b main`  
**Response**: `201` (created) or `409` (exists)

### Git Smart HTTP (solid-pod-rs-server)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/_git/{pk}/info/refs?service=git-upload-pack` | NIP-98 | Clone/fetch negotiate |
| `POST` | `/_git/{pk}/git-upload-pack` | NIP-98 | Fetch pack |
| `POST` | `/_git/{pk}/git-receive-pack` | NIP-98 pod-owner | Push |
| `GET` | `/_git/{pk}/HEAD` | public | Symbolic ref |
| `GET` | `/_git/{pk}/status` | NIP-98 | Working tree status |
| `POST` | `/_git/{pk}/stage` | NIP-98 pod-owner | Stage files |
| `POST` | `/_git/{pk}/commit` | NIP-98 pod-owner | Create commit |
| `GET` | `/_git/{pk}/log` | NIP-98 | Commit history |
| `GET` | `/_git/{pk}/diff` | NIP-98 | Unstaged diff |
| `GET` | `/.well-known/apps` | public | App manifest aggregation |

---

## 9. Cross-Repo Commit Chain

| Repo | Commit | Change |
|---|---|---|
| `solid-pod-rs` | `0c5fa42` | alpha.15: CORS allowlist, `/_admin/provision`, git control API |
| `nostr-rust-forum` | `8d31f3a` (rc11) | `NativePod` config schema, second pod card, admin tab, auth-worker relay |
| `agentbox` | this PR | alpha.15 in `lib/solid-pod-rs.nix`, `admin-users.js` provision impl, flake env wiring |
| `dreamlab-ai-website` | `forum-config` | `[native_pod]` block wired, `deploy.yml` `NATIVE_POD_URL` env |

### Related ADRs

- **ADR-089** — CF Workers subprocess constraint (blocks git on CF tier)
- **ADR-093** — Native pod mesh architecture decision
- **ADR-017** — Multi-tenant did:nostr pods
- **ADR-010** — solid-pod-rs as first-class pod implementation
