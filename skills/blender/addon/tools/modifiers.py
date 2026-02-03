"""
Modifier Tools for Unified Blender MCP.

Tools for adding, configuring, and applying modifiers to objects.
"""

import bpy
from typing import Any, Dict, Optional
from . import register_tool


@register_tool("add_modifier")
def add_modifier(params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Add a modifier to an object.

    Params:
        object_name: Name of the object
        type: Modifier type (SUBSURF, MIRROR, ARRAY, BEVEL, SOLIDIFY, BOOLEAN, DECIMATE, SMOOTH, etc.)
        name: Optional name for the modifier
        properties: Optional dict of modifier-specific properties

    Returns:
        Added modifier information.
    """
    object_name = params.get("object_name")
    mod_type = params.get("type", "").upper()
    mod_name = params.get("name")
    properties = params.get("properties", {})

    if not isinstance(object_name, str):
        return {"status": "error", "error": "object_name must be a string"}
    if not mod_type:
        return {"status": "error", "error": "type must be specified"}

    obj = bpy.data.objects.get(object_name)
    if not obj:
        return {"status": "error", "error": f"Object '{object_name}' not found"}

    if not hasattr(obj, 'modifiers'):
        return {"status": "error", "error": f"Object '{object_name}' cannot have modifiers"}

    # Map common names to Blender modifier types
    type_map = {
        "SUBSURF": "SUBSURF",
        "SUBDIVISION": "SUBSURF",
        "MIRROR": "MIRROR",
        "ARRAY": "ARRAY",
        "BEVEL": "BEVEL",
        "SOLIDIFY": "SOLIDIFY",
        "BOOLEAN": "BOOLEAN",
        "DECIMATE": "DECIMATE",
        "SMOOTH": "SMOOTH",
        "TRIANGULATE": "TRIANGULATE",
        "WIREFRAME": "WIREFRAME",
        "REMESH": "REMESH",
        "SHRINKWRAP": "SHRINKWRAP",
        "SIMPLE_DEFORM": "SIMPLE_DEFORM",
        "ARMATURE": "ARMATURE",
        "LATTICE": "LATTICE",
        "CURVE": "CURVE",
        "DISPLACE": "DISPLACE",
        "CAST": "CAST",
        "WAVE": "WAVE",
        "SKIN": "SKIN",
        "SCREW": "SCREW",
        "MULTIRES": "MULTIRES",
        "WELD": "WELD",
        "WEIGHTED_NORMAL": "WEIGHTED_NORMAL",
    }

    actual_type = type_map.get(mod_type, mod_type)

    try:
        modifier = obj.modifiers.new(name=mod_name or actual_type, type=actual_type)
    except TypeError as e:
        return {"status": "error", "error": f"Invalid modifier type '{mod_type}': {str(e)}"}

    # Apply common properties based on modifier type
    if actual_type == "SUBSURF":
        modifier.levels = properties.get("levels", 2)
        modifier.render_levels = properties.get("render_levels", 2)
        modifier.subdivision_type = properties.get("subdivision_type", "CATMULL_CLARK")

    elif actual_type == "MIRROR":
        modifier.use_axis = [
            properties.get("use_x", True),
            properties.get("use_y", False),
            properties.get("use_z", False)
        ]
        modifier.use_bisect_axis = [
            properties.get("bisect_x", False),
            properties.get("bisect_y", False),
            properties.get("bisect_z", False)
        ]
        if properties.get("mirror_object"):
            mirror_obj = bpy.data.objects.get(properties["mirror_object"])
            if mirror_obj:
                modifier.mirror_object = mirror_obj

    elif actual_type == "ARRAY":
        modifier.count = properties.get("count", 2)
        modifier.use_relative_offset = properties.get("use_relative_offset", True)
        if "relative_offset" in properties:
            offset = properties["relative_offset"]
            if isinstance(offset, (list, tuple)) and len(offset) >= 3:
                modifier.relative_offset_displace = offset[:3]
        modifier.use_constant_offset = properties.get("use_constant_offset", False)
        if "constant_offset" in properties:
            offset = properties["constant_offset"]
            if isinstance(offset, (list, tuple)) and len(offset) >= 3:
                modifier.constant_offset_displace = offset[:3]

    elif actual_type == "BEVEL":
        modifier.width = properties.get("width", 0.1)
        modifier.segments = properties.get("segments", 1)
        modifier.limit_method = properties.get("limit_method", "NONE")
        modifier.affect = properties.get("affect", "EDGES")

    elif actual_type == "SOLIDIFY":
        modifier.thickness = properties.get("thickness", 0.1)
        modifier.offset = properties.get("offset", -1.0)
        modifier.use_even_offset = properties.get("use_even_offset", True)

    elif actual_type == "BOOLEAN":
        modifier.operation = properties.get("operation", "DIFFERENCE")
        modifier.solver = properties.get("solver", "FAST")
        if properties.get("object"):
            bool_obj = bpy.data.objects.get(properties["object"])
            if bool_obj:
                modifier.object = bool_obj

    elif actual_type == "DECIMATE":
        modifier.decimate_type = properties.get("decimate_type", "COLLAPSE")
        modifier.ratio = properties.get("ratio", 0.5)

    elif actual_type == "SMOOTH":
        modifier.factor = properties.get("factor", 0.5)
        modifier.iterations = properties.get("iterations", 1)

    elif actual_type == "REMESH":
        modifier.mode = properties.get("mode", "VOXEL")
        modifier.voxel_size = properties.get("voxel_size", 0.1)

    elif actual_type == "DISPLACE":
        modifier.strength = properties.get("strength", 1.0)
        modifier.mid_level = properties.get("mid_level", 0.5)

    elif actual_type == "SIMPLE_DEFORM":
        modifier.deform_method = properties.get("deform_method", "TWIST")
        modifier.angle = properties.get("angle", 0.785398)  # 45 degrees
        modifier.factor = properties.get("factor", 0.0)

    # Apply any additional properties directly
    for key, value in properties.items():
        if hasattr(modifier, key):
            try:
                setattr(modifier, key, value)
            except:
                pass  # Skip invalid properties

    return {
        "object": object_name,
        "modifier": modifier.name,
        "type": actual_type
    }


@register_tool("apply_modifier")
def apply_modifier(params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Apply a modifier to an object (makes it permanent).

    Params:
        object_name: Name of the object
        modifier_name: Name of the modifier to apply
        apply_as: How to apply (DATA or SHAPE) - default DATA

    Returns:
        Application result.
    """
    object_name = params.get("object_name")
    modifier_name = params.get("modifier_name")
    apply_as = params.get("apply_as", "DATA").upper()

    if not isinstance(object_name, str):
        return {"status": "error", "error": "object_name must be a string"}
    if not isinstance(modifier_name, str):
        return {"status": "error", "error": "modifier_name must be a string"}

    obj = bpy.data.objects.get(object_name)
    if not obj:
        return {"status": "error", "error": f"Object '{object_name}' not found"}

    if modifier_name not in obj.modifiers:
        return {"status": "error", "error": f"Modifier '{modifier_name}' not found on '{object_name}'"}

    # Select and activate the object
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj

    try:
        if apply_as == "SHAPE":
            bpy.ops.object.modifier_apply_as_shapekey(modifier=modifier_name)
        else:
            bpy.ops.object.modifier_apply(modifier=modifier_name)
    except Exception as e:
        return {"status": "error", "error": f"Failed to apply modifier: {str(e)}"}

    return {
        "object": object_name,
        "applied": modifier_name
    }


@register_tool("remove_modifier")
def remove_modifier(params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Remove a modifier from an object.

    Params:
        object_name: Name of the object
        modifier_name: Name of the modifier to remove

    Returns:
        Removal result.
    """
    object_name = params.get("object_name")
    modifier_name = params.get("modifier_name")

    if not isinstance(object_name, str):
        return {"status": "error", "error": "object_name must be a string"}
    if not isinstance(modifier_name, str):
        return {"status": "error", "error": "modifier_name must be a string"}

    obj = bpy.data.objects.get(object_name)
    if not obj:
        return {"status": "error", "error": f"Object '{object_name}' not found"}

    modifier = obj.modifiers.get(modifier_name)
    if not modifier:
        return {"status": "error", "error": f"Modifier '{modifier_name}' not found on '{object_name}'"}

    obj.modifiers.remove(modifier)

    return {
        "object": object_name,
        "removed": modifier_name
    }


@register_tool("list_modifiers")
def list_modifiers(params: Dict[str, Any]) -> Dict[str, Any]:
    """
    List all modifiers on an object.

    Params:
        object_name: Name of the object

    Returns:
        List of modifiers with their types.
    """
    object_name = params.get("object_name")

    if not isinstance(object_name, str):
        return {"status": "error", "error": "object_name must be a string"}

    obj = bpy.data.objects.get(object_name)
    if not obj:
        return {"status": "error", "error": f"Object '{object_name}' not found"}

    if not hasattr(obj, 'modifiers'):
        return {"modifiers": [], "count": 0}

    modifiers = []
    for mod in obj.modifiers:
        mod_info = {
            "name": mod.name,
            "type": mod.type,
            "show_viewport": mod.show_viewport,
            "show_render": mod.show_render
        }
        modifiers.append(mod_info)

    return {
        "object": object_name,
        "modifiers": modifiers,
        "count": len(modifiers)
    }


@register_tool("set_modifier_property")
def set_modifier_property(params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Set a property on an existing modifier.

    Params:
        object_name: Name of the object
        modifier_name: Name of the modifier
        property_name: Name of the property to set
        value: Value to set

    Returns:
        Result of property change.
    """
    object_name = params.get("object_name")
    modifier_name = params.get("modifier_name")
    property_name = params.get("property_name")
    value = params.get("value")

    if not all(isinstance(x, str) for x in [object_name, modifier_name, property_name]):
        return {"status": "error", "error": "object_name, modifier_name, and property_name must be strings"}

    obj = bpy.data.objects.get(object_name)
    if not obj:
        return {"status": "error", "error": f"Object '{object_name}' not found"}

    modifier = obj.modifiers.get(modifier_name)
    if not modifier:
        return {"status": "error", "error": f"Modifier '{modifier_name}' not found on '{object_name}'"}

    if not hasattr(modifier, property_name):
        return {"status": "error", "error": f"Modifier '{modifier_name}' has no property '{property_name}'"}

    try:
        setattr(modifier, property_name, value)
    except Exception as e:
        return {"status": "error", "error": f"Failed to set property: {str(e)}"}

    return {
        "object": object_name,
        "modifier": modifier_name,
        "property": property_name,
        "value": value
    }
