"""
Thread-Safe Command Dispatcher for Unified Blender MCP.

This module implements the critical thread-safety pattern:
- WebSocket handler pushes commands to a queue from background thread
- bpy.app.timers callback pops and executes commands on main thread
- All bpy operations MUST run on main thread for stability
"""

import bpy
import queue
import asyncio
import functools
import traceback
from typing import Any, Dict, Callable, Tuple

# The queue receiving tasks from the WebSocket thread
# Format: (future, func, args, kwargs)
EXECUTION_QUEUE: "queue.Queue[Tuple[asyncio.Future, Callable, tuple, dict]]" = queue.Queue()

# Track if we're registered
_timer_registered = False


def run_in_main_thread(func: Callable) -> Callable:
    """
    Decorator to ensure functions run via the queue on main thread.

    Usage:
        @run_in_main_thread
        def my_bpy_operation(param1, param2):
            # This code runs safely on main thread
            bpy.ops.mesh.primitive_cube_add()
            return {"status": "success"}
    """
    @functools.wraps(func)
    async def wrapper(*args, **kwargs) -> Dict[str, Any]:
        loop = asyncio.get_event_loop()
        future = loop.create_future()

        # Push to queue for main thread execution
        EXECUTION_QUEUE.put((future, func, args, kwargs))

        # Wait for main thread to finish
        result = await future
        return result

    return wrapper


def execute_on_main_thread(func: Callable, *args, **kwargs) -> asyncio.Future:
    """
    Schedule a function to execute on the main thread and return a Future.

    This is the async-compatible way to execute bpy operations from
    the WebSocket handler.

    Args:
        func: The function to execute (should contain bpy operations)
        *args: Positional arguments for the function
        **kwargs: Keyword arguments for the function

    Returns:
        asyncio.Future that will contain the result when complete
    """
    loop = asyncio.get_event_loop()
    future = loop.create_future()

    EXECUTION_QUEUE.put((future, func, args, kwargs))

    return future


def process_queue() -> float:
    """
    Called by bpy.app.timers every 0.05s.
    Pops tasks from queue and executes them on the Main Thread.

    Returns:
        float: Interval until next call (0.05 seconds)
    """
    processed = 0
    max_per_tick = 10  # Limit to prevent UI freeze

    try:
        while not EXECUTION_QUEUE.empty() and processed < max_per_tick:
            try:
                # Get task (non-blocking)
                future, func, args, kwargs = EXECUTION_QUEUE.get_nowait()
                processed += 1

                try:
                    # Execute BPY logic on main thread
                    result = func(*args, **kwargs)

                    # Handle result
                    if isinstance(result, dict) and "error" in result:
                        # Logic failure - still a valid result
                        if not future.done():
                            future.get_loop().call_soon_threadsafe(
                                future.set_result, result
                            )
                    else:
                        # Success
                        if not future.done():
                            response = {"status": "success"}
                            if result is not None:
                                response["data"] = result
                            future.get_loop().call_soon_threadsafe(
                                future.set_result, response
                            )

                except Exception as e:
                    # Execution error
                    error_msg = f"{type(e).__name__}: {str(e)}"
                    print(f"[UnifiedMCP] Execution Error: {traceback.format_exc()}")

                    if not future.done():
                        future.get_loop().call_soon_threadsafe(
                            future.set_result,
                            {"status": "error", "error": error_msg}
                        )

            except queue.Empty:
                break

    except Exception as e:
        print(f"[UnifiedMCP] Queue Processor Critical Error: {e}")
        traceback.print_exc()

    return 0.05  # Run again in 0.05 seconds


def register():
    """Register the queue processor timer."""
    global _timer_registered

    if not _timer_registered:
        if not bpy.app.timers.is_registered(process_queue):
            bpy.app.timers.register(process_queue, first_interval=0.1, persistent=True)
            _timer_registered = True
            print("[UnifiedMCP] Dispatcher timer registered")


def unregister():
    """Unregister the queue processor timer."""
    global _timer_registered

    if _timer_registered:
        if bpy.app.timers.is_registered(process_queue):
            bpy.app.timers.unregister(process_queue)
            _timer_registered = False
            print("[UnifiedMCP] Dispatcher timer unregistered")

    # Clear any pending tasks
    while not EXECUTION_QUEUE.empty():
        try:
            future, _, _, _ = EXECUTION_QUEUE.get_nowait()
            if not future.done():
                future.get_loop().call_soon_threadsafe(
                    future.set_result,
                    {"status": "error", "error": "Server shutting down"}
                )
        except:
            pass


def get_queue_size() -> int:
    """Get the current number of pending tasks in the queue."""
    return EXECUTION_QUEUE.qsize()


def is_main_thread() -> bool:
    """Check if we're currently on Blender's main thread."""
    # In Blender, timers run on main thread, so if a timer is registered
    # and we can check it, we're likely on main thread
    # This is a heuristic - not 100% reliable
    try:
        # Try to access context - only works on main thread
        _ = bpy.context.window
        return True
    except:
        return False
