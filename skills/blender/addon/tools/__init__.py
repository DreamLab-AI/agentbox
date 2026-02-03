"""
Tool Registry for Unified Blender MCP.

This module provides a centralized registry for all available tools
and handles routing tool calls to the appropriate handlers.
"""

import asyncio
from typing import Any, Callable, Dict, Optional

# Import dispatcher for main thread execution
from .. import dispatcher

# Tool registry - maps tool names to handler functions
TOOL_REGISTRY: Dict[str, Callable] = {}


def register_tool(name: str):
    """
    Decorator to register a tool in the registry.

    Usage:
        @register_tool("get_scene_info")
        def get_scene_info(params: dict) -> dict:
            # Implementation
            return {"objects": [...]}
    """
    def decorator(func: Callable) -> Callable:
        TOOL_REGISTRY[name] = func
        return func
    return decorator


async def handle_tool_call(tool_name: str, params: Dict[str, Any]) -> Any:
    """
    Handle a tool call by routing to the appropriate handler.

    This function schedules the tool handler to run on the main thread
    via the dispatcher and awaits the result.

    Args:
        tool_name: Name of the tool to call
        params: Parameters to pass to the tool

    Returns:
        Result from the tool handler
    """
    if tool_name not in TOOL_REGISTRY:
        return {"status": "error", "error": f"Unknown tool: {tool_name}"}

    handler = TOOL_REGISTRY[tool_name]

    # Schedule execution on main thread and await result
    future = dispatcher.execute_on_main_thread(handler, params)
    result = await future

    return result


# Import all tool modules to register their tools
from . import core
from . import creation
from . import materials
from . import modifiers
from . import physics
from . import animation
from . import render
from . import assets


def get_tool_info(tool_name: str) -> Optional[Dict[str, Any]]:
    """Get information about a specific tool."""
    if tool_name not in TOOL_REGISTRY:
        return None

    handler = TOOL_REGISTRY[tool_name]
    return {
        "name": tool_name,
        "doc": handler.__doc__ or "No documentation",
        "module": handler.__module__
    }


def list_tools() -> list:
    """List all registered tools."""
    return list(TOOL_REGISTRY.keys())
