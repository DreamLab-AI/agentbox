"""
Headless Blender MCP Server Startup Script.

This script starts the Unified Blender MCP WebSocket server in headless mode.
It manually processes the command queue since bpy.app.timers don't run
in a headless sleep loop.

Usage:
    blender -b -P /path/to/headless_start.py

Environment Variables:
    BLENDER_WS_HOST: WebSocket host (default: 127.0.0.1)
    BLENDER_WS_PORT: WebSocket port (default: 8765)
"""

import bpy
import sys
import os
import time

HOST = os.environ.get("BLENDER_WS_HOST", "127.0.0.1")
PORT = int(os.environ.get("BLENDER_WS_PORT", "8765"))

print("=" * 60)
print("Unified Blender MCP Server (Headless Mode)")
print("=" * 60)

# Enable the addon
try:
    bpy.ops.preferences.addon_enable(module="unified_blender_mcp")
    print("[INFO] Addon enabled successfully")
except Exception as e:
    print(f"[ERROR] Failed to enable addon: {e}")
    sys.exit(1)

# Import and start server
try:
    from unified_blender_mcp import server, dispatcher
    from unified_blender_mcp.tools import TOOL_REGISTRY

    print(f"[INFO] Loaded {len(TOOL_REGISTRY)} tools")

    # Start server
    if not server.is_running():
        print(f"[INFO] Starting server on ws://{HOST}:{PORT}...")
        server.start(HOST, PORT, "")
        time.sleep(0.5)

    info = server.get_server_info()
    if info.get("running"):
        print("-" * 60)
        print(f"[SUCCESS] Server running on ws://{HOST}:{PORT}")
        print("[INFO] Headless mode: manually processing queue")
        print("[INFO] Press Ctrl+C to stop")
        print("-" * 60)

        # Main loop - manually process the queue
        tick = 0
        while True:
            # Process any pending commands
            dispatcher.process_queue()
            time.sleep(0.05)

            tick += 1
            if tick % 200 == 0:  # Every ~10 seconds
                info = server.get_server_info()
                print(f"[STATUS] Running: {info.get('running')}, Queue: {dispatcher.get_queue_size()}")

    else:
        print("[ERROR] Server failed to start")
        sys.exit(1)

except KeyboardInterrupt:
    print("\n[INFO] Shutting down gracefully...")
    try:
        server.stop()
    except:
        pass
    print("[INFO] Server stopped")

except Exception as e:
    print(f"[ERROR] {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)
