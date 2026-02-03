"""
Material Tools for Unified Blender MCP.

Tools for creating and manipulating materials and shaders.
"""

import bpy
from typing import Any, Dict, Optional, Tuple, List
from . import register_tool


def _validate_vec3(val: Any) -> Optional[Tuple[float, float, float]]:
    """Validate and convert a value to a 3D vector tuple."""
    try:
        if isinstance(val, (list, tuple)) and len(val) == 3:
            return (float(val[0]), float(val[1]), float(val[2]))
    except (TypeError, ValueError):
        pass
    return None


def _validate_vec4(val: Any) -> Optional[Tuple[float, float, float, float]]:
    """Validate and convert a value to a 4D vector tuple (RGBA)."""
    try:
        if isinstance(val, (list, tuple)):
            if len(val) == 4:
                return (float(val[0]), float(val[1]), float(val[2]), float(val[3]))
            elif len(val) == 3:
                return (float(val[0]), float(val[1]), float(val[2]), 1.0)
    except (TypeError, ValueError):
        pass
    return None


@register_tool("create_material")
def create_material(params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Create a new material with PBR properties.

    Params:
        name: Material name
        color: Base color [r, g, b] or [r, g, b, a] (0-1 range)
        metallic: Metallic value (0-1)
        roughness: Roughness value (0-1)
        specular: Specular intensity (0-1)
        emission: Emission color [r, g, b] (optional)
        emission_strength: Emission strength (default 1.0)
        alpha: Alpha/opacity (0-1)
        blend_mode: Blend mode for transparency (OPAQUE, CLIP, HASHED, BLEND)

    Returns:
        Created material information.
    """
    name = params.get("name", "Material")
    color = _validate_vec4(params.get("color")) or (0.8, 0.8, 0.8, 1.0)
    metallic = float(params.get("metallic", 0.0))
    roughness = float(params.get("roughness", 0.5))
    specular = float(params.get("specular", 0.5))
    emission = _validate_vec3(params.get("emission"))
    emission_strength = float(params.get("emission_strength", 1.0))
    alpha = float(params.get("alpha", 1.0))
    blend_mode = params.get("blend_mode", "OPAQUE").upper()

    # Create material
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True

    # Get the principled BSDF node
    nodes = mat.node_tree.nodes
    principled = nodes.get("Principled BSDF")

    if principled:
        # Set base properties
        principled.inputs["Base Color"].default_value = color
        principled.inputs["Metallic"].default_value = metallic
        principled.inputs["Roughness"].default_value = roughness

        # Handle Blender 4.0+ API changes for specular
        if "Specular IOR Level" in principled.inputs:
            principled.inputs["Specular IOR Level"].default_value = specular
        elif "Specular" in principled.inputs:
            principled.inputs["Specular"].default_value = specular

        # Set emission if provided
        if emission:
            if "Emission Color" in principled.inputs:
                principled.inputs["Emission Color"].default_value = (*emission, 1.0)
            elif "Emission" in principled.inputs:
                principled.inputs["Emission"].default_value = (*emission, 1.0)

            if "Emission Strength" in principled.inputs:
                principled.inputs["Emission Strength"].default_value = emission_strength

        # Set alpha
        principled.inputs["Alpha"].default_value = alpha

    # Set blend mode for transparency
    if blend_mode in ('OPAQUE', 'CLIP', 'HASHED', 'BLEND'):
        mat.blend_method = blend_mode
        if blend_mode != 'OPAQUE':
            mat.shadow_method = 'HASHED'

    return {
        "name": mat.name,
        "color": list(color),
        "metallic": metallic,
        "roughness": roughness,
        "blend_mode": blend_mode
    }


@register_tool("assign_material")
def assign_material(params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Assign a material to an object.

    Params:
        object_name: Name of the object
        material_name: Name of the material to assign
        slot_index: Optional material slot index (default appends or uses slot 0)

    Returns:
        Assignment result.
    """
    object_name = params.get("object_name")
    material_name = params.get("material_name")
    slot_index = params.get("slot_index")

    if not isinstance(object_name, str):
        return {"status": "error", "error": "object_name must be a string"}
    if not isinstance(material_name, str):
        return {"status": "error", "error": "material_name must be a string"}

    obj = bpy.data.objects.get(object_name)
    if not obj:
        return {"status": "error", "error": f"Object '{object_name}' not found"}

    mat = bpy.data.materials.get(material_name)
    if not mat:
        return {"status": "error", "error": f"Material '{material_name}' not found"}

    # Assign material
    if obj.data and hasattr(obj.data, 'materials'):
        if slot_index is not None and isinstance(slot_index, int):
            if 0 <= slot_index < len(obj.data.materials):
                obj.data.materials[slot_index] = mat
            else:
                return {"status": "error", "error": f"Invalid slot_index: {slot_index}"}
        else:
            # Append or replace first slot
            if len(obj.data.materials) == 0:
                obj.data.materials.append(mat)
            else:
                obj.data.materials[0] = mat

        return {
            "object": object_name,
            "material": material_name,
            "slot_count": len(obj.data.materials)
        }
    else:
        return {"status": "error", "error": f"Object '{object_name}' cannot have materials"}


@register_tool("set_object_color")
def set_object_color(params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Quick method to set an object's color (creates/modifies material automatically).

    Params:
        object_name: Name of the object
        color: Color [r, g, b] or [r, g, b, a] (0-1 range)
        metallic: Optional metallic value
        roughness: Optional roughness value

    Returns:
        Result information.
    """
    object_name = params.get("object_name")
    color = _validate_vec4(params.get("color"))
    metallic = params.get("metallic")
    roughness = params.get("roughness")

    if not isinstance(object_name, str):
        return {"status": "error", "error": "object_name must be a string"}
    if not color:
        return {"status": "error", "error": "color must be [r, g, b] or [r, g, b, a]"}

    obj = bpy.data.objects.get(object_name)
    if not obj:
        return {"status": "error", "error": f"Object '{object_name}' not found"}

    if not obj.data or not hasattr(obj.data, 'materials'):
        return {"status": "error", "error": f"Object '{object_name}' cannot have materials"}

    # Get or create material
    mat_name = f"{object_name}_Material"
    mat = bpy.data.materials.get(mat_name)

    if not mat:
        mat = bpy.data.materials.new(name=mat_name)
        mat.use_nodes = True

    # Set color
    nodes = mat.node_tree.nodes
    principled = nodes.get("Principled BSDF")

    if principled:
        principled.inputs["Base Color"].default_value = color
        if metallic is not None:
            principled.inputs["Metallic"].default_value = float(metallic)
        if roughness is not None:
            principled.inputs["Roughness"].default_value = float(roughness)

    # Assign to object
    if len(obj.data.materials) == 0:
        obj.data.materials.append(mat)
    else:
        obj.data.materials[0] = mat

    return {
        "object": object_name,
        "material": mat_name,
        "color": list(color)
    }


@register_tool("list_materials")
def list_materials(params: Dict[str, Any]) -> Dict[str, Any]:
    """
    List all materials in the blend file.

    Params:
        object_name: Optional - if provided, list only materials on this object

    Returns:
        List of materials.
    """
    object_name = params.get("object_name")

    if object_name:
        obj = bpy.data.objects.get(object_name)
        if not obj:
            return {"status": "error", "error": f"Object '{object_name}' not found"}

        if not obj.data or not hasattr(obj.data, 'materials'):
            return {"materials": [], "count": 0}

        materials = [m.name if m else None for m in obj.data.materials]
        return {"materials": materials, "count": len(materials), "object": object_name}
    else:
        materials = [m.name for m in bpy.data.materials]
        return {"materials": materials, "count": len(materials)}


@register_tool("get_material_info")
def get_material_info(params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Get detailed information about a material.

    Params:
        name: Material name

    Returns:
        Material properties.
    """
    name = params.get("name")
    if not isinstance(name, str):
        return {"status": "error", "error": "name must be a string"}

    mat = bpy.data.materials.get(name)
    if not mat:
        return {"status": "error", "error": f"Material '{name}' not found"}

    info = {
        "name": mat.name,
        "use_nodes": mat.use_nodes,
        "blend_method": mat.blend_method,
        "shadow_method": mat.shadow_method,
        "users": mat.users
    }

    # Get principled BSDF properties if available
    if mat.use_nodes and mat.node_tree:
        nodes = mat.node_tree.nodes
        principled = nodes.get("Principled BSDF")

        if principled:
            info["base_color"] = list(principled.inputs["Base Color"].default_value)
            info["metallic"] = principled.inputs["Metallic"].default_value
            info["roughness"] = principled.inputs["Roughness"].default_value
            info["alpha"] = principled.inputs["Alpha"].default_value

            # Get specular (API varies by version)
            if "Specular IOR Level" in principled.inputs:
                info["specular"] = principled.inputs["Specular IOR Level"].default_value
            elif "Specular" in principled.inputs:
                info["specular"] = principled.inputs["Specular"].default_value

        # List all nodes
        info["nodes"] = [{"name": n.name, "type": n.type} for n in nodes]

    return info


@register_tool("delete_material")
def delete_material(params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Delete a material.

    Params:
        name: Material name
        force: If true, delete even if material has users

    Returns:
        Deletion result.
    """
    name = params.get("name")
    force = params.get("force", False)

    if not isinstance(name, str):
        return {"status": "error", "error": "name must be a string"}

    mat = bpy.data.materials.get(name)
    if not mat:
        return {"status": "error", "error": f"Material '{name}' not found"}

    if mat.users > 0 and not force:
        return {
            "status": "error",
            "error": f"Material '{name}' has {mat.users} users. Use force=true to delete anyway."
        }

    bpy.data.materials.remove(mat)
    return {"deleted": name}


@register_tool("create_pbr_from_folder")
def create_pbr_from_folder(params: dict) -> dict:
    """
    Auto-detect PBR maps from a folder (e.g., ComfyUI/Chord output) and build material.
    
    Args:
        material_name: Name for the new material
        folder_path: Path to folder containing PBR maps
        
    Expected files (case-insensitive matching):
        - *albedo*.png or *diffuse*.png → Base Color
        - *roughness*.png → Roughness
        - *metallic*.png or *metalness*.png → Metallic
        - *normal*.png → Normal Map
        - *height*.png or *displacement*.png → Displacement (optional)
        - *ao*.png or *ambient_occlusion*.png → AO (optional)
    """
    import bpy
    import os
    
    material_name = params.get("material_name", "PBR_Material")
    folder_path = params.get("folder_path")
    
    if not folder_path or not os.path.isdir(folder_path):
        return {"error": f"Invalid folder path: {folder_path}"}
    
    mat = bpy.data.materials.new(name=material_name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    nodes.clear()

    # Create Principled BSDF & Output
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.location = (0, 0)
    output = nodes.new("ShaderNodeOutputMaterial")
    output.location = (300, 0)
    links.new(bsdf.outputs[0], output.inputs[0])

    # Map file patterns to BSDF sockets
    map_config = {
        ("albedo", "diffuse", "basecolor", "base_color"): ("Base Color", True),
        ("roughness", "rough"): ("Roughness", False),
        ("metallic", "metalness", "metal"): ("Metallic", False),
        ("normal", "norm", "nrm"): ("Normal", False),
    }

    files = os.listdir(folder_path)
    loaded_maps = []
    x_offset = -600
    
    for f in files:
        if not (f.lower().endswith(".png") or f.lower().endswith(".jpg") or f.lower().endswith(".exr")):
            continue
            
        lower_f = f.lower()
        
        for patterns, (socket_name, is_color) in map_config.items():
            if any(p in lower_f for p in patterns):
                # Create Image Texture node
                tex_node = nodes.new("ShaderNodeTexImage")
                tex_node.location = (x_offset, len(loaded_maps) * -300)
                tex_node.image = bpy.data.images.load(os.path.join(folder_path, f))
                
                # Set colorspace
                if not is_color:
                    tex_node.image.colorspace_settings.name = 'Non-Color'
                
                # Handle Normal Map with normal map node
                if socket_name == "Normal":
                    normal_node = nodes.new("ShaderNodeNormalMap")
                    normal_node.location = (x_offset + 300, len(loaded_maps) * -300)
                    links.new(tex_node.outputs["Color"], normal_node.inputs["Color"])
                    links.new(normal_node.outputs["Normal"], bsdf.inputs["Normal"])
                else:
                    links.new(tex_node.outputs["Color"], bsdf.inputs[socket_name])
                
                loaded_maps.append(f"{socket_name}: {f}")
                break
    
    return {
        "material": material_name,
        "maps_loaded": loaded_maps,
        "folder": folder_path
    }
