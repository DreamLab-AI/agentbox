# Web interfaces

The HTTPS operator cockpit is the home for a running Agentbox:

```bash
./agentbox.sh voice up
./agentbox.sh voice open
```

It combines AoE sessions, voice, transcript, governance approvals, Nostr, and
links to the retained specialist surfaces. It uses NIP-98 through a browser
Nostr signer, with a session-scoped break-glass bearer for recovery.

| Interface | Default location | Purpose | Access |
|---|---|---|---|
| Operator cockpit | `https://localhost:8444` | Sessions, voice, approvals, navigation | Self-signed TLS; NIP-98 or bearer |
| AoE dashboard/API | Cockpit `/aoe/*`; ingress `:9096` | Session lifecycle, terminal, diff | NIP-98 sole ingress |
| Linked objects | Cockpit `/lo/`; API `:9090/lo/` | JSON-LD and provenance browsing | Public bundle; restricted resolver |
| API documentation | Cockpit `/docs/`; API `:9090/docs` | OpenAPI exploration | Public shell; operations authenticate |
| code-server | `http://localhost:8080` | Browser IDE | Host loopback or SSH tunnel |
| JupyterLab | `http://localhost:8888` | Notebooks | Host loopback or SSH tunnel |
| VNC desktop | `vnc://localhost:5901` | Graphical desktop | `./agentbox.sh vnc` tunnel |
| ComfyUI | `http://localhost:8188` | Image workflows | Optional manifest gate, loopback |
| Setup wizard | Ephemeral localhost URL | Pre-boot `agentbox.toml` editing | Launched by `scripts/start-agentbox.sh` |

The old post-boot mode in the setup SPA has been retired. Running-system status
comes from the cockpit and `GET /v1/system`; the setup wizard does not infer
service health.
