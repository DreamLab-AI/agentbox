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
bpy.app.timers.register(_start, first_interval=2.0)
print("BLENDERMCP_STARTUP_QUEUED")
