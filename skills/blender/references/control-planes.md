# Blender control planes

Use the established socket for trusted `bpy`, API introspection and background
render launch. `mcp-blender-client.js` now also serves MCP stdio initialize,
tool discovery and calls; legacy `{tool, params}` input remains supported.
The typed `set_frame` tool validates integer input and calls `frame_set()`.
`register-mcp.sh` registers this baked bridge rather than fetching an unpinned
`uvx blender-mcp` at startup.

## DCC-MCP candidate: live and build-pinned

The GUI sidecar installs `dcc-mcp-blender==0.2.23`, `dcc-mcp-core==0.20.46`
and `dcc-mcp-server==0.20.46` into `/opt/gui-tools/dcc-python`. Its Blender
startup creates a second control plane, with the instance on 9880 and the
remote gateway at **http://gui-tools-service:9881/mcp**. Port 9881 is internal
to the container network. Set `DCC_MCP_ENABLED=0` to disable this candidate;
the established 9876 socket remains operational.

Register an on-demand remote MCP entry with `type: http` and that URL in a
client supporting Streamable HTTP. Read `gateway://instances`, then use
`search`, `load_skill`, `describe` and `call` with live tool slugs. Instance IDs
change across restarts: never hard-code one into a workflow. Read the gateway
workflow guide before asset/plugin reuse. Prefer typed camera, animation and
scene tools; use code execution for gaps. Keep long renders in background jobs.

Verified on 21 October 2026 with a real MCP SDK client: initialize, discovery,
instance resource, skill loading and typed session inspection of the visible
puppet scene (Blender 5.2.0, fps 25, frame 49). One warm request was 346 ms;
this is not a throughput or comparative latency benchmark. Undo, cancellation,
GUI edit notifications and camera/animation batches still need live testing.

Alternatives: [Blender Lab MCP](https://www.blender.org/lab/mcp-server/) provides
first-party documentation lookup and inspection; [Blenderwright](https://github.com/HoldMyBeer-gg/blenderwright)
provides typed camera/animation tools with a separate matching add-on. The
latter must use a separate port during a comparison; port 9876 alone does not
make its protocol compatible with the existing bridge. Neither was run here.
