"""
Creation Tools for Unified Blender MCP.

Tools for creating primitives, text, curves, and other objects.
"""

import bpy
import math
from typing import Any, Dict, Optional, Tuple
from . import register_tool


def _validate_vec3(val: Any) -> Optional[Tuple[float, float, float]]:
    """Validate and convert a value to a 3D vector tuple."""
    try:
        if isinstance(val, (list, tuple)) and len(val) == 3:
            return (float(val[0]), float(val[1]), float(val[2]))
    except (TypeError, ValueError):
        pass
    return None


@register_tool("create_primitive")
def create_primitive(params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Create a primitive mesh object.

    Params:
        type: Primitive type (cube, sphere, uv_sphere, ico_sphere, cylinder, cone, torus, plane, circle, grid)
        location: Optional [x, y, z] location
        rotation: Optional [x, y, z] rotation in radians
        scale: Optional [x, y, z] scale
        name: Optional name for the object

        Type-specific params:
        - sphere/uv_sphere: segments, ring_count
        - ico_sphere: subdivisions
        - cylinder: vertices, depth, radius
        - cone: vertices, depth1, depth2, radius1, radius2
        - torus: major_segments, minor_segments, major_radius, minor_radius
        - circle: vertices, radius
        - grid: x_subdivisions, y_subdivisions

    Returns:
        Created object information.
    """
    ptype = params.get("type", "cube").lower()
    location = _validate_vec3(params.get("location")) or (0.0, 0.0, 0.0)
    rotation = _validate_vec3(params.get("rotation")) or (0.0, 0.0, 0.0)
    scale = _validate_vec3(params.get("scale")) or (1.0, 1.0, 1.0)
    name = params.get("name")

    # Map type to operator and parameters
    ops_map = {
        "cube": (bpy.ops.mesh.primitive_cube_add, {}),
        "sphere": (bpy.ops.mesh.primitive_uv_sphere_add, {
            "segments": params.get("segments", 32),
            "ring_count": params.get("ring_count", 16)
        }),
        "uv_sphere": (bpy.ops.mesh.primitive_uv_sphere_add, {
            "segments": params.get("segments", 32),
            "ring_count": params.get("ring_count", 16)
        }),
        "ico_sphere": (bpy.ops.mesh.primitive_ico_sphere_add, {
            "subdivisions": params.get("subdivisions", 2)
        }),
        "cylinder": (bpy.ops.mesh.primitive_cylinder_add, {
            "vertices": params.get("vertices", 32),
            "depth": params.get("depth", 2.0),
            "radius": params.get("radius", 1.0)
        }),
        "cone": (bpy.ops.mesh.primitive_cone_add, {
            "vertices": params.get("vertices", 32),
            "depth": params.get("depth", 2.0),
            "radius1": params.get("radius1", 1.0),
            "radius2": params.get("radius2", 0.0)
        }),
        "torus": (bpy.ops.mesh.primitive_torus_add, {
            "major_segments": params.get("major_segments", 48),
            "minor_segments": params.get("minor_segments", 12),
            "major_radius": params.get("major_radius", 1.0),
            "minor_radius": params.get("minor_radius", 0.25)
        }),
        "plane": (bpy.ops.mesh.primitive_plane_add, {}),
        "circle": (bpy.ops.mesh.primitive_circle_add, {
            "vertices": params.get("vertices", 32),
            "radius": params.get("radius", 1.0)
        }),
        "grid": (bpy.ops.mesh.primitive_grid_add, {
            "x_subdivisions": params.get("x_subdivisions", 10),
            "y_subdivisions": params.get("y_subdivisions", 10)
        }),
        "monkey": (bpy.ops.mesh.primitive_monkey_add, {})
    }

    if ptype not in ops_map:
        return {
            "status": "error",
            "error": f"Unknown primitive type: {ptype}. Valid types: {list(ops_map.keys())}"
        }

    op_func, extra_params = ops_map[ptype]

    # Execute the operator
    try:
        op_func(location=location, rotation=rotation, scale=scale, **extra_params)
    except Exception as e:
        return {"status": "error", "error": f"Failed to create primitive: {str(e)}"}

    # Get the created object
    obj = bpy.context.view_layer.objects.active
    if not obj:
        return {"status": "error", "error": "Object creation failed"}

    # Rename if requested
    if name and isinstance(name, str):
        obj.name = name

    return {
        "name": obj.name,
        "type": ptype,
        "location": list(obj.location),
        "rotation": list(obj.rotation_euler),
        "scale": list(obj.scale)
    }


@register_tool("create_text")
def create_text(params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Create a 3D text object.

    Params:
        text: The text content
        location: Optional [x, y, z] location
        rotation: Optional [x, y, z] rotation in radians
        size: Font size (default 1.0)
        extrude: Extrusion depth (default 0.0)
        bevel_depth: Bevel depth (default 0.0)
        align_x: Horizontal alignment (LEFT, CENTER, RIGHT, JUSTIFY, FLUSH)
        align_y: Vertical alignment (TOP, CENTER, BOTTOM)
        name: Optional name for the object

    Returns:
        Created text object information.
    """
    text = params.get("text", "Text")
    location = _validate_vec3(params.get("location")) or (0.0, 0.0, 0.0)
    rotation = _validate_vec3(params.get("rotation")) or (0.0, 0.0, 0.0)
    size = float(params.get("size", 1.0))
    extrude = float(params.get("extrude", 0.0))
    bevel_depth = float(params.get("bevel_depth", 0.0))
    align_x = params.get("align_x", "LEFT").upper()
    align_y = params.get("align_y", "TOP").upper()
    name = params.get("name")

    # Create text object
    bpy.ops.object.text_add(location=location, rotation=rotation)
    obj = bpy.context.view_layer.objects.active

    if not obj:
        return {"status": "error", "error": "Text creation failed"}

    # Set text content and properties
    obj.data.body = text
    obj.data.size = size
    obj.data.extrude = extrude
    obj.data.bevel_depth = bevel_depth

    # Set alignment
    if align_x in ('LEFT', 'CENTER', 'RIGHT', 'JUSTIFY', 'FLUSH'):
        obj.data.align_x = align_x
    if align_y in ('TOP', 'CENTER', 'BOTTOM', 'TOP_BASELINE', 'BOTTOM_BASELINE'):
        obj.data.align_y = align_y

    # Rename if requested
    if name and isinstance(name, str):
        obj.name = name

    return {
        "name": obj.name,
        "text": text,
        "location": list(obj.location),
        "size": size,
        "extrude": extrude
    }


@register_tool("create_curve")
def create_curve(params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Create a curve object.

    Params:
        type: Curve type (bezier, nurbs, path)
        location: Optional [x, y, z] location
        rotation: Optional [x, y, z] rotation in radians
        radius: Optional radius for circle curves
        name: Optional name for the object

    Returns:
        Created curve object information.
    """
    ctype = params.get("type", "bezier").lower()
    location = _validate_vec3(params.get("location")) or (0.0, 0.0, 0.0)
    rotation = _validate_vec3(params.get("rotation")) or (0.0, 0.0, 0.0)
    radius = float(params.get("radius", 1.0))
    name = params.get("name")

    ops_map = {
        "bezier": bpy.ops.curve.primitive_bezier_curve_add,
        "bezier_circle": bpy.ops.curve.primitive_bezier_circle_add,
        "nurbs": bpy.ops.curve.primitive_nurbs_curve_add,
        "nurbs_circle": bpy.ops.curve.primitive_nurbs_circle_add,
        "path": bpy.ops.curve.primitive_nurbs_path_add,
    }

    if ctype not in ops_map:
        return {
            "status": "error",
            "error": f"Unknown curve type: {ctype}. Valid types: {list(ops_map.keys())}"
        }

    try:
        if "circle" in ctype:
            ops_map[ctype](location=location, rotation=rotation, radius=radius)
        else:
            ops_map[ctype](location=location, rotation=rotation)
    except Exception as e:
        return {"status": "error", "error": f"Failed to create curve: {str(e)}"}

    obj = bpy.context.view_layer.objects.active
    if not obj:
        return {"status": "error", "error": "Curve creation failed"}

    if name and isinstance(name, str):
        obj.name = name

    return {
        "name": obj.name,
        "type": ctype,
        "location": list(obj.location)
    }


@register_tool("create_empty")
def create_empty(params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Create an empty object (useful for parenting, organization, or as targets).

    Params:
        type: Empty display type (PLAIN_AXES, ARROWS, SINGLE_ARROW, CIRCLE, CUBE, SPHERE, CONE, IMAGE)
        location: Optional [x, y, z] location
        rotation: Optional [x, y, z] rotation in radians
        radius: Display size (default 1.0)
        name: Optional name for the object

    Returns:
        Created empty object information.
    """
    etype = params.get("type", "PLAIN_AXES").upper()
    location = _validate_vec3(params.get("location")) or (0.0, 0.0, 0.0)
    rotation = _validate_vec3(params.get("rotation")) or (0.0, 0.0, 0.0)
    radius = float(params.get("radius", 1.0))
    name = params.get("name")

    valid_types = ['PLAIN_AXES', 'ARROWS', 'SINGLE_ARROW', 'CIRCLE', 'CUBE', 'SPHERE', 'CONE', 'IMAGE']
    if etype not in valid_types:
        return {
            "status": "error",
            "error": f"Unknown empty type: {etype}. Valid types: {valid_types}"
        }

    bpy.ops.object.empty_add(type=etype, location=location, rotation=rotation, radius=radius)

    obj = bpy.context.view_layer.objects.active
    if not obj:
        return {"status": "error", "error": "Empty creation failed"}

    if name and isinstance(name, str):
        obj.name = name

    return {
        "name": obj.name,
        "type": etype,
        "location": list(obj.location),
        "radius": radius
    }


@register_tool("create_camera")
def create_camera(params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Create a camera object.

    Params:
        location: Optional [x, y, z] location
        rotation: Optional [x, y, z] rotation in radians
        lens: Focal length in mm (default 50)
        sensor_width: Sensor width in mm (default 36)
        clip_start: Near clipping distance (default 0.1)
        clip_end: Far clipping distance (default 1000)
        type: Camera type (PERSP, ORTHO, PANO)
        name: Optional name for the camera
        set_active: If true, set as the active scene camera

    Returns:
        Created camera information.
    """
    location = _validate_vec3(params.get("location")) or (0.0, 0.0, 10.0)
    rotation = _validate_vec3(params.get("rotation")) or (0.0, 0.0, 0.0)
    lens = float(params.get("lens", 50))
    sensor_width = float(params.get("sensor_width", 36))
    clip_start = float(params.get("clip_start", 0.1))
    clip_end = float(params.get("clip_end", 1000))
    cam_type = params.get("type", "PERSP").upper()
    name = params.get("name")
    set_active = params.get("set_active", False)

    bpy.ops.object.camera_add(location=location, rotation=rotation)

    obj = bpy.context.view_layer.objects.active
    if not obj:
        return {"status": "error", "error": "Camera creation failed"}

    # Set camera properties
    obj.data.lens = lens
    obj.data.sensor_width = sensor_width
    obj.data.clip_start = clip_start
    obj.data.clip_end = clip_end

    if cam_type in ('PERSP', 'ORTHO', 'PANO'):
        obj.data.type = cam_type

    if name and isinstance(name, str):
        obj.name = name

    if set_active:
        bpy.context.scene.camera = obj

    return {
        "name": obj.name,
        "location": list(obj.location),
        "lens": lens,
        "type": cam_type,
        "is_active": bpy.context.scene.camera == obj
    }


@register_tool("create_light")
def create_light(params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Create a light object.

    Params:
        type: Light type (POINT, SUN, SPOT, AREA)
        location: Optional [x, y, z] location
        rotation: Optional [x, y, z] rotation in radians
        energy: Light power/intensity
        color: Optional [r, g, b] color (0-1 range)
        radius: Light radius for soft shadows
        name: Optional name for the light

        Type-specific params:
        - SPOT: spot_size, spot_blend
        - AREA: size, shape (SQUARE, RECTANGLE, DISK, ELLIPSE)

    Returns:
        Created light information.
    """
    ltype = params.get("type", "POINT").upper()
    location = _validate_vec3(params.get("location")) or (0.0, 0.0, 5.0)
    rotation = _validate_vec3(params.get("rotation")) or (0.0, 0.0, 0.0)
    energy = float(params.get("energy", 1000))
    color = _validate_vec3(params.get("color")) or (1.0, 1.0, 1.0)
    radius = float(params.get("radius", 0.25))
    name = params.get("name")

    valid_types = ['POINT', 'SUN', 'SPOT', 'AREA']
    if ltype not in valid_types:
        return {
            "status": "error",
            "error": f"Unknown light type: {ltype}. Valid types: {valid_types}"
        }

    bpy.ops.object.light_add(type=ltype, location=location, rotation=rotation)

    obj = bpy.context.view_layer.objects.active
    if not obj:
        return {"status": "error", "error": "Light creation failed"}

    # Set light properties
    light = obj.data
    light.energy = energy
    light.color = color

    if ltype == 'POINT':
        light.shadow_soft_size = radius
    elif ltype == 'SUN':
        light.angle = float(params.get("angle", 0.526))  # Default sun angle
    elif ltype == 'SPOT':
        light.shadow_soft_size = radius
        light.spot_size = float(params.get("spot_size", math.radians(45)))
        light.spot_blend = float(params.get("spot_blend", 0.15))
    elif ltype == 'AREA':
        light.size = float(params.get("size", 1.0))
        light.shape = params.get("shape", "SQUARE").upper()

    if name and isinstance(name, str):
        obj.name = name

    return {
        "name": obj.name,
        "type": ltype,
        "location": list(obj.location),
        "energy": energy,
        "color": list(color)
    }


@register_tool("create_armature")
def create_armature(params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Create an armature (skeleton) object.

    Params:
        location: Optional [x, y, z] location
        rotation: Optional [x, y, z] rotation in radians
        name: Optional name for the armature

    Returns:
        Created armature information.
    """
    location = _validate_vec3(params.get("location")) or (0.0, 0.0, 0.0)
    rotation = _validate_vec3(params.get("rotation")) or (0.0, 0.0, 0.0)
    name = params.get("name")

    bpy.ops.object.armature_add(location=location, rotation=rotation)

    obj = bpy.context.view_layer.objects.active
    if not obj:
        return {"status": "error", "error": "Armature creation failed"}

    if name and isinstance(name, str):
        obj.name = name

    return {
        "name": obj.name,
        "location": list(obj.location),
        "bone_count": len(obj.data.bones)
    }
