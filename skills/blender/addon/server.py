"""
WebSocket Server for Unified Blender MCP.

This module implements the async WebSocket server that:
- Runs in a background thread with its own event loop
- Receives JSON-RPC commands from the MCP bridge
- Queues commands for execution on main thread via dispatcher
- Returns results back to the client
"""

import asyncio
import json
import threading
import time
from typing import Any, Dict, Optional

# Import dispatcher for queue access
from . import dispatcher

# Try to import websockets - may fail before dependency install
try:
    import websockets
    from websockets.server import WebSocketServerProtocol
    WEBSOCKETS_AVAILABLE = True
except ImportError:
    WEBSOCKETS_AVAILABLE = False
    WebSocketServerProtocol = Any

# Import tool registry
from .tools import TOOL_REGISTRY, handle_tool_call

# Server state
_server_thread: Optional[threading.Thread] = None
_event_loop: Optional[asyncio.AbstractEventLoop] = None
_server: Optional[Any] = None
_server_running = False
_auth_token: Optional[str] = None

SERVER_VERSION = "1.0.0"


def _err(rid: Any, tool: Any, msg: str) -> Dict[str, Any]:
    """Create an error response."""
    return {
        "id": rid,
        "tool": tool,
        "status": "error",
        "error": msg
    }


def _ok(rid: Any, tool: str, **fields: Any) -> Dict[str, Any]:
    """Create a success response."""
    resp = {
        "id": rid,
        "tool": tool,
        "status": "success"
    }
    resp.update(fields)
    return resp


async def handle_client(websocket: WebSocketServerProtocol):
    """
    Handle a connected WebSocket client.

    Message Format (incoming):
    {
        "id": "unique-request-id",
        "tool": "tool_name",
        "params": {...},
        "token": "optional-auth-token"
    }

    Response Format:
    {
        "id": "request-id",
        "tool": "tool_name",
        "status": "success" | "error",
        "data": {...} | null,
        "error": "error message" | null
    }
    """
    client_addr = websocket.remote_address
    print(f"[UnifiedMCP] Client connected: {client_addr}")

    try:
        async for message in websocket:
            try:
                data = json.loads(message)
                tool_name = data.get("tool")
                params = data.get("params", {})
                req_id = data.get("id")
                token = data.get("token")

                # Validate request
                if req_id is None:
                    await websocket.send(json.dumps(
                        _err(None, tool_name, "Missing request id")
                    ))
                    continue

                # Check authentication if token is configured
                if _auth_token and token != _auth_token:
                    await websocket.send(json.dumps(
                        _err(req_id, tool_name, "Unauthorized - invalid token")
                    ))
                    continue

                # Handle special server tools
                if tool_name == "ping":
                    await websocket.send(json.dumps(
                        _ok(req_id, "ping",
                            version=SERVER_VERSION,
                            timestamp=time.time(),
                            tools=list(TOOL_REGISTRY.keys())
                        )
                    ))
                    continue

                if tool_name == "list_tools":
                    await websocket.send(json.dumps(
                        _ok(req_id, "list_tools",
                            tools=list(TOOL_REGISTRY.keys())
                        )
                    ))
                    continue

                # Check if tool exists
                if tool_name not in TOOL_REGISTRY:
                    await websocket.send(json.dumps(
                        _err(req_id, tool_name, f"Unknown tool: {tool_name}")
                    ))
                    continue

                # Execute tool via dispatcher (on main thread)
                try:
                    result = await handle_tool_call(tool_name, params)

                    # Format response
                    if isinstance(result, dict) and result.get("status") == "error":
                        response = _err(req_id, tool_name, result.get("error", "Unknown error"))
                    else:
                        response = _ok(req_id, tool_name, data=result)

                    await websocket.send(json.dumps(response))

                except Exception as e:
                    await websocket.send(json.dumps(
                        _err(req_id, tool_name, str(e))
                    ))

            except json.JSONDecodeError:
                await websocket.send(json.dumps(
                    _err(None, None, "Invalid JSON")
                ))
            except Exception as e:
                print(f"[UnifiedMCP] Error handling message: {e}")
                try:
                    await websocket.send(json.dumps(
                        _err(None, None, f"Server error: {str(e)}")
                    ))
                except:
                    pass

    except websockets.exceptions.ConnectionClosed:
        print(f"[UnifiedMCP] Client disconnected: {client_addr}")
    except Exception as e:
        print(f"[UnifiedMCP] Client error: {e}")


async def _run_server(host: str, port: int):
    """Run the WebSocket server (async)."""
    global _server, _server_running

    try:
        _server = await websockets.serve(
            handle_client,
            host,
            port,
            ping_interval=30,
            ping_timeout=10
        )
        _server_running = True
        print(f"[UnifiedMCP] WebSocket server started on ws://{host}:{port}")

        # Run until cancelled
        await asyncio.Future()

    except asyncio.CancelledError:
        print("[UnifiedMCP] Server cancelled")
    except Exception as e:
        print(f"[UnifiedMCP] Server error: {e}")
    finally:
        _server_running = False
        if _server:
            _server.close()
            await _server.wait_closed()


def _server_thread_entry(host: str, port: int):
    """Entry point for the server thread."""
    global _event_loop

    _event_loop = asyncio.new_event_loop()
    asyncio.set_event_loop(_event_loop)

    try:
        _event_loop.run_until_complete(_run_server(host, port))
    except Exception as e:
        print(f"[UnifiedMCP] Server thread error: {e}")
    finally:
        _event_loop.close()
        _event_loop = None


def start(host: str = "127.0.0.1", port: int = 8765, auth_token: str = ""):
    """
    Start the WebSocket server.

    Args:
        host: Host to bind to (keep localhost for security)
        port: Port to listen on
        auth_token: Optional authentication token
    """
    global _server_thread, _auth_token, _server_running

    if not WEBSOCKETS_AVAILABLE:
        raise RuntimeError("websockets package not installed. Install dependencies first.")

    if _server_thread and _server_thread.is_alive():
        print("[UnifiedMCP] Server already running")
        return

    _auth_token = auth_token if auth_token else None

    _server_thread = threading.Thread(
        target=_server_thread_entry,
        args=(host, port),
        daemon=True,
        name="UnifiedMCP-Server"
    )
    _server_thread.start()

    # Wait a moment for server to start
    time.sleep(0.2)

    if not _server_running:
        raise RuntimeError("Server failed to start")


def stop():
    """Stop the WebSocket server."""
    global _server_thread, _event_loop, _server, _server_running

    if _event_loop and _server_running:
        # Schedule server shutdown
        try:
            _event_loop.call_soon_threadsafe(_event_loop.stop)
        except:
            pass

    if _server_thread:
        _server_thread.join(timeout=2.0)
        _server_thread = None

    _server_running = False
    print("[UnifiedMCP] Server stopped")


def is_running() -> bool:
    """Check if the server is currently running."""
    return _server_running and _server_thread is not None and _server_thread.is_alive()


def get_server_info() -> Dict[str, Any]:
    """Get information about the running server."""
    return {
        "running": is_running(),
        "version": SERVER_VERSION,
        "tools_available": len(TOOL_REGISTRY),
        "queue_size": dispatcher.get_queue_size()
    }
