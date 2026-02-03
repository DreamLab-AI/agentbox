"""
Asset Integration Tools for Unified Blender MCP.

Tools for importing assets from external sources:
- PolyHaven (free HDRIs, textures, models)
- CSM.ai (AI 3D model generation)
- Sketchfab (community models)
- Hyper3D Rodin (AI generation)
"""

import bpy
import os
import tempfile
from typing import Any, Dict, List, Optional
from . import register_tool

# Try to import requests (may fail before dependency install)
try:
    import requests
    REQUESTS_AVAILABLE = True
except ImportError:
    REQUESTS_AVAILABLE = False


def _get_addon_prefs():
    """Get addon preferences."""
    try:
        from .. import __name__ as addon_name
        return bpy.context.preferences.addons[addon_name].preferences
    except:
        return None


# ============================================================================
# PolyHaven Integration
# ============================================================================

@register_tool("search_polyhaven")
def search_polyhaven(params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Search for assets on PolyHaven (free CC0 assets).

    Params:
        query: Search query text
        type: Asset type (hdris, textures, models)
        limit: Maximum results (default 20)
        categories: Optional category filter

    Returns:
        List of matching assets.
    """
    if not REQUESTS_AVAILABLE:
        return {"status": "error", "error": "requests package not installed"}

    query = params.get("query", "")
    asset_type = params.get("type", "all").lower()
    limit = int(params.get("limit", 20))
    categories = params.get("categories")

    # PolyHaven API
    base_url = "https://api.polyhaven.com/assets"

    type_map = {
        "hdris": "hdris",
        "hdri": "hdris",
        "textures": "textures",
        "texture": "textures",
        "models": "models",
        "model": "models",
        "all": "all"
    }
    asset_type = type_map.get(asset_type, "all")

    try:
        response = requests.get(base_url, timeout=30)
        response.raise_for_status()
        all_assets = response.json()

        # Filter by type and query
        results = []
        for asset_id, asset_data in all_assets.items():
            if asset_type != "all" and asset_data.get("type") != asset_type.rstrip("s"):
                continue

            if query:
                name = asset_data.get("name", "").lower()
                tags = " ".join(asset_data.get("tags", [])).lower()
                if query.lower() not in name and query.lower() not in tags:
                    continue

            if categories:
                asset_cats = asset_data.get("categories", [])
                if not any(c in asset_cats for c in categories):
                    continue

            results.append({
                "id": asset_id,
                "name": asset_data.get("name"),
                "type": asset_data.get("type"),
                "categories": asset_data.get("categories", []),
                "tags": asset_data.get("tags", []),
                "download_count": asset_data.get("download_count", 0)
            })

            if len(results) >= limit:
                break

        return {
            "query": query,
            "type": asset_type,
            "results": results,
            "count": len(results)
        }

    except Exception as e:
        return {"status": "error", "error": f"PolyHaven search failed: {str(e)}"}


@register_tool("download_polyhaven_asset")
def download_polyhaven_asset(params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Download and import a PolyHaven asset.

    Params:
        asset_id: PolyHaven asset ID
        type: Asset type (hdri, texture, model)
        resolution: Resolution (1k, 2k, 4k, etc.)
        format: File format (hdr, exr for hdris; jpg, png for textures; gltf, fbx for models)

    Returns:
        Import result with asset information.
    """
    if not REQUESTS_AVAILABLE:
        return {"status": "error", "error": "requests package not installed"}

    asset_id = params.get("asset_id")
    asset_type = params.get("type", "texture").lower()
    resolution = params.get("resolution", "1k")
    file_format = params.get("format")

    if not asset_id:
        return {"status": "error", "error": "asset_id is required"}

    # Determine default format
    if not file_format:
        if asset_type in ("hdri", "hdris"):
            file_format = "hdr"
        elif asset_type in ("texture", "textures"):
            file_format = "jpg"
        else:
            file_format = "gltf"

    # Get download URL
    files_url = f"https://api.polyhaven.com/files/{asset_id}"

    try:
        response = requests.get(files_url, timeout=30)
        response.raise_for_status()
        files_data = response.json()

        # Find the appropriate file
        download_url = None

        if asset_type in ("hdri", "hdris"):
            hdri_files = files_data.get("hdri", {})
            resolution_data = hdri_files.get(resolution, {})
            download_url = resolution_data.get(file_format, {}).get("url")
        elif asset_type in ("texture", "textures"):
            # For textures, we need the diffuse map at minimum
            diffuse_maps = files_data.get("Diffuse", files_data.get("diffuse", {}))
            resolution_data = diffuse_maps.get(resolution, {})
            download_url = resolution_data.get(file_format, {}).get("url")
        elif asset_type in ("model", "models"):
            model_files = files_data.get(file_format, files_data.get("gltf", {}))
            download_url = model_files.get(resolution, {}).get("url")

        if not download_url:
            return {"status": "error", "error": f"Could not find {file_format} file at {resolution}"}

        # Download the file
        temp_dir = tempfile.mkdtemp(prefix="polyhaven_")
        file_ext = download_url.split(".")[-1].split("?")[0]
        local_path = os.path.join(temp_dir, f"{asset_id}.{file_ext}")

        dl_response = requests.get(download_url, timeout=120)
        dl_response.raise_for_status()

        with open(local_path, "wb") as f:
            f.write(dl_response.content)

        # Import based on type
        if asset_type in ("hdri", "hdris"):
            # Load as world texture
            world = bpy.context.scene.world
            if not world:
                world = bpy.data.worlds.new("World")
                bpy.context.scene.world = world

            world.use_nodes = True
            nodes = world.node_tree.nodes
            links = world.node_tree.links

            # Create environment texture node
            env_tex = nodes.new("ShaderNodeTexEnvironment")
            env_tex.image = bpy.data.images.load(local_path)

            bg_node = nodes.get("Background")
            if bg_node:
                links.new(env_tex.outputs["Color"], bg_node.inputs["Color"])

            return {
                "asset_id": asset_id,
                "type": "hdri",
                "path": local_path,
                "applied_to_world": True
            }

        elif asset_type in ("texture", "textures"):
            # Load as image
            img = bpy.data.images.load(local_path)
            return {
                "asset_id": asset_id,
                "type": "texture",
                "path": local_path,
                "image_name": img.name
            }

        elif asset_type in ("model", "models"):
            # Import the model
            if file_ext in ("glb", "gltf"):
                bpy.ops.import_scene.gltf(filepath=local_path)
            elif file_ext == "fbx":
                bpy.ops.import_scene.fbx(filepath=local_path)
            elif file_ext == "blend":
                with bpy.data.libraries.load(local_path, link=False) as (data_from, data_to):
                    data_to.objects = data_from.objects

                for obj in data_to.objects:
                    bpy.context.collection.objects.link(obj)

            imported = [obj.name for obj in bpy.context.selected_objects]
            return {
                "asset_id": asset_id,
                "type": "model",
                "path": local_path,
                "imported_objects": imported
            }

    except Exception as e:
        return {"status": "error", "error": f"Download failed: {str(e)}"}


# ============================================================================
# CSM.ai Integration
# ============================================================================

@register_tool("get_csm_status")
def get_csm_status(params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Check if CSM.ai integration is enabled and configured.

    Returns:
        CSM.ai configuration status.
    """
    prefs = _get_addon_prefs()
    if not prefs:
        return {"enabled": False, "error": "Addon preferences not found"}

    return {
        "enabled": bool(prefs.csm_api_key),
        "has_api_key": bool(prefs.csm_api_key)
    }


@register_tool("search_csm_models")
def search_csm_models(params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Search for 3D models on CSM.ai.

    Params:
        query: Search query text
        limit: Maximum results (default 20)

    Returns:
        List of matching models.
    """
    if not REQUESTS_AVAILABLE:
        return {"status": "error", "error": "requests package not installed"}

    prefs = _get_addon_prefs()
    if not prefs or not prefs.csm_api_key:
        return {"status": "error", "error": "CSM.ai API key not configured"}

    query = params.get("query", "")
    limit = int(params.get("limit", 20))

    headers = {
        "Content-Type": "application/json",
        "x-api-key": prefs.csm_api_key,
        "x-platform": "web"
    }

    try:
        response = requests.get(
            "https://api.csm.ai/search",
            headers=headers,
            params={"searchTerm": query, "limit": limit},
            timeout=30
        )
        response.raise_for_status()
        data = response.json()

        models = data.get("data", [])
        return {
            "query": query,
            "models": models,
            "count": len(models)
        }

    except Exception as e:
        return {"status": "error", "error": f"CSM search failed: {str(e)}"}


@register_tool("import_csm_model")
def import_csm_model(params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Import a 3D model from CSM.ai.

    Params:
        model_id: CSM model ID
        mesh_url_glb: URL to the GLB file
        name: Optional name for the imported model

    Returns:
        Import result.
    """
    if not REQUESTS_AVAILABLE:
        return {"status": "error", "error": "requests package not installed"}

    model_id = params.get("model_id")
    mesh_url = params.get("mesh_url_glb")
    name = params.get("name")

    if not mesh_url:
        return {"status": "error", "error": "mesh_url_glb is required"}

    try:
        # Download the GLB file
        response = requests.get(mesh_url, timeout=120)
        response.raise_for_status()

        temp_dir = tempfile.mkdtemp(prefix="csm_")
        local_path = os.path.join(temp_dir, f"{model_id or 'model'}.glb")

        with open(local_path, "wb") as f:
            f.write(response.content)

        # Import the model
        bpy.ops.import_scene.gltf(filepath=local_path)

        imported_objects = [obj.name for obj in bpy.context.selected_objects]

        # Rename if requested
        if name and imported_objects:
            main_obj = bpy.data.objects.get(imported_objects[0])
            if main_obj:
                main_obj.name = name
                imported_objects[0] = name

        return {
            "model_id": model_id,
            "path": local_path,
            "imported_objects": imported_objects,
            "succeed": True
        }

    except Exception as e:
        return {"status": "error", "error": f"CSM import failed: {str(e)}"}


# ============================================================================
# File Import/Export
# ============================================================================

@register_tool("import_model")
def import_model(params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Import a 3D model file.

    Params:
        filepath: Path to the model file
        format: Optional format hint (gltf, fbx, obj, stl, ply, blend)

    Returns:
        Import result with imported object names.
    """
    filepath = params.get("filepath")
    file_format = params.get("format")

    if not filepath:
        return {"status": "error", "error": "filepath is required"}

    if not os.path.exists(filepath):
        return {"status": "error", "error": f"File not found: {filepath}"}

    # Detect format from extension if not provided
    if not file_format:
        ext = os.path.splitext(filepath)[1].lower()
        format_map = {
            ".glb": "gltf",
            ".gltf": "gltf",
            ".fbx": "fbx",
            ".obj": "obj",
            ".stl": "stl",
            ".ply": "ply",
            ".blend": "blend",
            ".dae": "collada",
            ".abc": "alembic"
        }
        file_format = format_map.get(ext, "obj")

    try:
        # Clear selection
        bpy.ops.object.select_all(action='DESELECT')

        # Import based on format
        if file_format == "gltf":
            bpy.ops.import_scene.gltf(filepath=filepath)
        elif file_format == "fbx":
            bpy.ops.import_scene.fbx(filepath=filepath)
        elif file_format == "obj":
            bpy.ops.wm.obj_import(filepath=filepath)
        elif file_format == "stl":
            bpy.ops.wm.stl_import(filepath=filepath)
        elif file_format == "ply":
            bpy.ops.wm.ply_import(filepath=filepath)
        elif file_format == "blend":
            with bpy.data.libraries.load(filepath, link=False) as (data_from, data_to):
                data_to.objects = data_from.objects
            for obj in data_to.objects:
                if obj:
                    bpy.context.collection.objects.link(obj)
        elif file_format == "collada":
            bpy.ops.wm.collada_import(filepath=filepath)
        elif file_format == "alembic":
            bpy.ops.wm.alembic_import(filepath=filepath)
        else:
            return {"status": "error", "error": f"Unsupported format: {file_format}"}

        imported = [obj.name for obj in bpy.context.selected_objects]
        return {
            "filepath": filepath,
            "format": file_format,
            "imported_objects": imported,
            "count": len(imported)
        }

    except Exception as e:
        return {"status": "error", "error": f"Import failed: {str(e)}"}


@register_tool("export_model")
def export_model(params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Export objects to a model file.

    Params:
        filepath: Output file path
        format: Export format (gltf, fbx, obj, stl, ply, blend)
        selected_only: If true, export only selected objects
        object_names: Optional list of specific object names to export

    Returns:
        Export result.
    """
    filepath = params.get("filepath")
    file_format = params.get("format")
    selected_only = params.get("selected_only", False)
    object_names = params.get("object_names")

    if not filepath:
        return {"status": "error", "error": "filepath is required"}

    # Detect format from extension if not provided
    if not file_format:
        ext = os.path.splitext(filepath)[1].lower()
        format_map = {
            ".glb": "gltf",
            ".gltf": "gltf",
            ".fbx": "fbx",
            ".obj": "obj",
            ".stl": "stl",
            ".ply": "ply",
            ".blend": "blend"
        }
        file_format = format_map.get(ext, "gltf")

    try:
        # Select specific objects if provided
        if object_names:
            bpy.ops.object.select_all(action='DESELECT')
            for name in object_names:
                obj = bpy.data.objects.get(name)
                if obj:
                    obj.select_set(True)
            selected_only = True

        # Export based on format
        if file_format == "gltf":
            export_format = 'GLB' if filepath.endswith('.glb') else 'GLTF_SEPARATE'
            bpy.ops.export_scene.gltf(
                filepath=filepath,
                export_format=export_format,
                use_selection=selected_only
            )
        elif file_format == "fbx":
            bpy.ops.export_scene.fbx(
                filepath=filepath,
                use_selection=selected_only
            )
        elif file_format == "obj":
            bpy.ops.wm.obj_export(
                filepath=filepath,
                export_selected_objects=selected_only
            )
        elif file_format == "stl":
            bpy.ops.wm.stl_export(
                filepath=filepath,
                export_selected_objects=selected_only
            )
        elif file_format == "ply":
            bpy.ops.wm.ply_export(
                filepath=filepath,
                export_selected_objects=selected_only
            )
        elif file_format == "blend":
            bpy.ops.wm.save_as_mainfile(filepath=filepath, copy=True)
        else:
            return {"status": "error", "error": f"Unsupported format: {file_format}"}

        return {
            "filepath": filepath,
            "format": file_format,
            "selected_only": selected_only
        }

    except Exception as e:
        return {"status": "error", "error": f"Export failed: {str(e)}"}
