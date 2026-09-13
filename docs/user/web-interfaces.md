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
| code-server | Cockpit `/code/` | Browser IDE | Console identity gate, then code-server login |
| JupyterLab | Cockpit `/jupyter/` | Notebooks | Console identity gate, then Jupyter login |
| VNC desktop | `vnc://localhost:5901` | Graphical desktop | `./agentbox.sh vnc` tunnel |
| ComfyUI | `http://localhost:8188` | Image workflows | Optional manifest gate, loopback |
| Setup wizard | Ephemeral localhost URL | Pre-boot `agentbox.toml` editing | Launched by `scripts/start-agentbox.sh` |

The Code and Jupyter tabs stay on the HTTPS console origin at port 8444,
including editor and kernel WebSockets. Ports 8080 and 8888 remain published
on host loopback for direct access or SSH tunnels. Direct Jupyter access uses
`http://localhost:8888/jupyter/`. Existing images need a rebuild to pick up
the proxy host-preservation option and Jupyter's `/jupyter/` base path.

The old post-boot mode in the setup SPA has been retired. Running-system status
comes from the cockpit and `GET /v1/system`; the setup wizard does not infer
service health.
