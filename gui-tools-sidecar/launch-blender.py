"""Blender startup inside the GPU sidecar: register the BlenderMCP addon and start
its socket server on 0.0.0.0:9876 so the agentbox proxy can reach it across the
container network. Runs under VirtualGL, so the addon's GUI event loop (which
marshals execute_code onto the main thread via bpy.app.timers) has a real GPU GL
context. The addon is Siddharth Ahuja's BlenderMCP (MIT)."""
import bpy, os

ADDON = "/opt/gui-tools/blendermcp-addon.py"
PORT = int(os.environ.get("BLENDER_MCP_PORT", "9876"))
BIND = os.environ.get("BLENDER_MCP_BIND", "0.0.0.0")

ns = {"__name__": "blendermcp_addon", "__file__": ADDON}
with open(ADDON) as f:
    exec(compile(f.read(), ADDON, "exec"), ns)

try:
    ns["register"]()
    print("BLENDERMCP_REGISTERED")
except Exception as e:
    print("BLENDERMCP_REGISTER_ERROR", type(e).__name__, e)

def _start():
    try:
        try:
            bpy.context.scene.blendermcp_port = PORT
        except Exception:
            pass
        srv = ns["BlenderMCPServer"](host=BIND, port=PORT)
        srv.start()
        bpy.types.blendermcp_server = srv
        try:
            bpy.context.scene.blendermcp_server_running = True
        except Exception:
            pass
        print(f"BLENDERMCP_SERVING {BIND}:{PORT}")
    except Exception as e:
        print("BLENDERMCP_START_ERROR", type(e).__name__, e)
    return None

# start on the main thread once the event loop is up
bpy.app.timers.register(_start, first_interval=2.0, persistent=True)
print("BLENDERMCP_STARTUP_QUEUED")

def _start_dcc():
    if os.environ.get("DCC_MCP_ENABLED", "1") != "1":
        print("DCC_MCP_DISABLED")
        return None
    try:
        import sys
        sys.path.insert(0, "/opt/gui-tools/dcc-python")
        import dcc_mcp_blender
        server = dcc_mcp_blender.start_server(
            port=9880, gateway_remote_host="0.0.0.0", gateway_remote_port=9881)
        print(f"DCC_MCP_SERVING instance={server.port} gateway=:9881/mcp")
    except Exception as error:
        # Keep the established raw socket operational if the candidate fails.
        print("DCC_MCP_START_ERROR", type(error).__name__, error)
    return None

bpy.app.timers.register(_start_dcc, first_interval=3.0, persistent=True)
