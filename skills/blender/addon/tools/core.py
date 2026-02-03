"""
Core Tools for Unified Blender MCP.

Basic scene and object management operations.
"""

import bpy
from typing import Any, Dict, List, Tuple, Optional
from . import register_tool


def _validate_vec3(val: Any) -> Optional[Tuple[float, float, float]]:
    """Validate and convert a value to a 3D vector tuple."""
    try:
        if isinstance(val, (list, tuple)) and len(val) == 3:
            return (float(val[0]), float(val[1]), float(val[2]))
    except (TypeError, ValueError):
        pass
    return None


def _get_object_data(obj) -> Dict[str, Any]:
    """Get detailed data about a Blender object."""
    data = {
        "name": obj.name,
        "type": obj.type,
        "location": list(obj.location),
        "rotation_euler": list(obj.rotation_euler),
        "scale": list(obj.scale),
        "visible": obj.visible_get(),
        "selected": obj.select_get(),
    }

    # Add bounding box if available
    if hasattr(obj, 'bound_box') and obj.bound_box:
        bb = obj.bound_box
        # Calculate world-space bounding box
        matrix_world = obj.matrix_world
        world_bb = [matrix_world @ bpy.context.scene.cursor.location.__class__(corner) for corner in bb]

        min_corner = [min(c[i] for c in world_bb) for i in range(3)]
        max_corner = [max(c[i] for c in world_bb) for i in range(3)]

        data["world_bounding_box"] = {
            "min": min_corner,
            "max": max_corner,
            "dimensions": [max_corner[i] - min_corner[i] for i in range(3)]
        }

    # Add mesh-specific info
    if obj.type == 'MESH' and obj.data:
        mesh = obj.data
        data["mesh_info"] = {
            "vertices": len(mesh.vertices),
            "edges": len(mesh.edges),
            "polygons": len(mesh.polygons),
            "materials": [m.name if m else None for m in obj.data.materials]
        }

    # Add parent info
    if obj.parent:
        data["parent"] = obj.parent.name

    # Add children
    data["children"] = [c.name for c in obj.children]

    # Add modifier info
    if hasattr(obj, 'modifiers'):
        data["modifiers"] = [{"name": m.name, "type": m.type} for m in obj.modifiers]

    return data


@register_tool("get_scene_info")
def get_scene_info(params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Get detailed information about the current Blender scene.

    Returns:
        Scene information including objects, cameras, lights, and settings.
    """
    scene = bpy.context.scene

    objects = []
    cameras = []
    lights = []
    meshes = []

    for obj in scene.objects:
        obj_data = {
            "name": obj.name,
            "type": obj.type,
            "location": list(obj.location),
            "visible": obj.visible_get()
        }
        objects.append(obj_data)

        if obj.type == 'CAMERA':
            cameras.append(obj.name)
        elif obj.type == 'LIGHT':
            lights.append(obj.name)
        elif obj.type == 'MESH':
            meshes.append(obj.name)

    # Get active camera
    active_camera = scene.camera.name if scene.camera else None

    return {
        "name": scene.name,
        "frame_current": scene.frame_current,
        "frame_start": scene.frame_start,
        "frame_end": scene.frame_end,
        "fps": scene.render.fps,
        "render_resolution": [scene.render.resolution_x, scene.render.resolution_y],
        "active_camera": active_camera,
        "object_count": len(objects),
        "objects": objects,
        "cameras": cameras,
        "lights": lights,
        "meshes": meshes,
        "collections": [c.name for c in bpy.data.collections]
    }


@register_tool("get_object_info")
def get_object_info(params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Get detailed information about a specific object.

    Params:
        name: Name of the object to query

    Returns:
        Detailed object information including transforms, mesh data, and modifiers.
    """
    name = params.get("name")
    if not isinstance(name, str):
        return {"status": "error", "error": "name must be a string"}

    obj = bpy.data.objects.get(name)
    if not obj:
        return {"status": "error", "error": f"Object '{name}' not found"}

    return _get_object_data(obj)


@register_tool("list_objects")
def list_objects(params: Dict[str, Any]) -> Dict[str, Any]:
    """
    List all objects in the scene with optional filtering.

    Params:
        type: Optional type filter (MESH, CAMERA, LIGHT, etc.)
        selected_only: If true, only return selected objects

    Returns:
        List of object names matching the filter.
    """
    type_filter = params.get("type")
    selected_only = params.get("selected_only", False)

    objects = []
    for obj in bpy.context.scene.objects:
        if type_filter and obj.type != type_filter:
            continue
        if selected_only and not obj.select_get():
            continue
        objects.append({
            "name": obj.name,
            "type": obj.type
        })

    return {"objects": objects, "count": len(objects)}


@register_tool("select_object")
def select_object(params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Select an object and make it active.

    Params:
        name: Name of the object to select
        add_to_selection: If true, add to current selection instead of replacing

    Returns:
        Success status.
    """
    name = params.get("name")
    add_to_selection = params.get("add_to_selection", False)

    if not isinstance(name, str):
        return {"status": "error", "error": "name must be a string"}

    obj = bpy.data.objects.get(name)
    if not obj:
        return {"status": "error", "error": f"Object '{name}' not found"}

    if not add_to_selection:
        bpy.ops.object.select_all(action='DESELECT')

    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj

    return {"selected": name}


@register_tool("transform_object")
def transform_object(params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Transform an object's location, rotation, and/or scale.

    Params:
        name: Name of the object to transform
        location: Optional [x, y, z] location
        rotation: Optional [x, y, z] rotation in radians
        scale: Optional [x, y, z] scale
        delta: If true, add to current values instead of replacing

    Returns:
        New transform values.
    """
    name = params.get("name")
    if not isinstance(name, str):
        return {"status": "error", "error": "name must be a string"}

    obj = bpy.data.objects.get(name)
    if not obj:
        return {"status": "error", "error": f"Object '{name}' not found"}

    delta = params.get("delta", False)

    location = _validate_vec3(params.get("location"))
    rotation = _validate_vec3(params.get("rotation"))
    scale = _validate_vec3(params.get("scale"))

    if location is None and rotation is None and scale is None:
        return {"status": "error", "error": "Provide at least one of location/rotation/scale"}

    if location:
        if delta:
            obj.location = (
                obj.location[0] + location[0],
                obj.location[1] + location[1],
                obj.location[2] + location[2]
            )
        else:
            obj.location = location

    if rotation:
        if delta:
            obj.rotation_euler = (
                obj.rotation_euler[0] + rotation[0],
                obj.rotation_euler[1] + rotation[1],
                obj.rotation_euler[2] + rotation[2]
            )
        else:
            obj.rotation_euler = rotation

    if scale:
        if delta:
            obj.scale = (
                obj.scale[0] * scale[0],
                obj.scale[1] * scale[1],
                obj.scale[2] * scale[2]
            )
        else:
            obj.scale = scale

    return {
        "name": name,
        "location": list(obj.location),
        "rotation_euler": list(obj.rotation_euler),
        "scale": list(obj.scale)
    }


@register_tool("duplicate_object")
def duplicate_object(params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Duplicate an object.

    Params:
        name: Name of the object to duplicate
        new_name: Optional name for the duplicate
        linked: If true, create a linked duplicate (shares mesh data)

    Returns:
        Name of the duplicated object.
    """
    name = params.get("name")
    new_name = params.get("new_name")
    linked = params.get("linked", False)

    if not isinstance(name, str):
        return {"status": "error", "error": "name must be a string"}

    obj = bpy.data.objects.get(name)
    if not obj:
        return {"status": "error", "error": f"Object '{name}' not found"}

    # Create duplicate
    dup = obj.copy()
    if not linked and obj.data:
        dup.data = obj.data.copy()

    # Link to collection
    if bpy.context.collection:
        bpy.context.collection.objects.link(dup)
    else:
        bpy.context.scene.collection.objects.link(dup)

    # Set name if provided
    if new_name and isinstance(new_name, str):
        dup.name = new_name

    return {"original": name, "duplicate": dup.name}


@register_tool("delete_object")
def delete_object(params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Delete an object from the scene.

    Params:
        name: Name of the object to delete

    Returns:
        Confirmation of deletion.
    """
    name = params.get("name")
    if not isinstance(name, str):
        return {"status": "error", "error": "name must be a string"}

    obj = bpy.data.objects.get(name)
    if not obj:
        return {"status": "error", "error": f"Object '{name}' not found"}

    bpy.data.objects.remove(obj, do_unlink=True)

    return {"deleted": name}


@register_tool("execute_python")
def execute_python(params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Execute arbitrary Python code in Blender context.

    WARNING: This is powerful but potentially dangerous. Use with caution.

    Params:
        code: Python code to execute

    Returns:
        Execution result including stdout, stderr, and return value.
    """
    code = params.get("code")
    if not isinstance(code, str):
        return {"status": "error", "error": "code must be a string"}

    if not code.strip():
        return {"status": "error", "error": "code cannot be empty"}

    import io
    import sys
    import contextlib

    stdout_capture = io.StringIO()
    stderr_capture = io.StringIO()

    try:
        # Create execution context
        exec_globals = {
            "bpy": bpy,
            "__builtins__": __builtins__,
        }
        exec_locals = {}

        # Execute with captured output
        with contextlib.redirect_stdout(stdout_capture), contextlib.redirect_stderr(stderr_capture):
            exec(code, exec_globals, exec_locals)

        # Get result if set
        result = exec_locals.get("result")

        return {
            "result": str(result) if result is not None else None,
            "stdout": stdout_capture.getvalue() or None,
            "stderr": stderr_capture.getvalue() or None
        }

    except Exception as e:
        return {
            "status": "error",
            "error": f"{type(e).__name__}: {str(e)}",
            "stderr": stderr_capture.getvalue() or None
        }
