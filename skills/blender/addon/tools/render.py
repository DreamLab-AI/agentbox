"""
Render Tools for Unified Blender MCP.

Tools for rendering images, animations, and capturing viewport screenshots.
"""

import bpy
import os
import base64
import tempfile
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


@register_tool("render_image")
def render_image(params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Render an image from the current camera view.

    Params:
        output_path: Optional output file path (if not provided, uses temp file)
        resolution_x: Optional width in pixels
        resolution_y: Optional height in pixels
        resolution_percentage: Optional render scale percentage (1-100)
        samples: Optional number of render samples (for Cycles)
        engine: Render engine (CYCLES, EEVEE, WORKBENCH)
        return_base64: If true, return the image as base64 string

    Returns:
        Render result with file path and optionally base64 data.
    """
    output_path = params.get("output_path")
    resolution_x = params.get("resolution_x")
    resolution_y = params.get("resolution_y")
    resolution_percentage = params.get("resolution_percentage")
    samples = params.get("samples")
    engine = params.get("engine")
    return_base64 = params.get("return_base64", False)

    scene = bpy.context.scene

    # Store original settings
    orig_path = scene.render.filepath
    orig_format = scene.render.image_settings.file_format

    try:
        # Set render settings
        if resolution_x:
            scene.render.resolution_x = int(resolution_x)
        if resolution_y:
            scene.render.resolution_y = int(resolution_y)
        if resolution_percentage:
            scene.render.resolution_percentage = int(resolution_percentage)

        if engine:
            engine = engine.upper()
            if engine in ('CYCLES', 'BLENDER_EEVEE', 'BLENDER_WORKBENCH', 'EEVEE'):
                if engine == 'EEVEE':
                    engine = 'BLENDER_EEVEE'
                scene.render.engine = engine

        if samples and scene.render.engine == 'CYCLES':
            scene.cycles.samples = int(samples)

        # Set output path
        if output_path:
            render_path = output_path
        else:
            temp_dir = tempfile.gettempdir()
            render_path = os.path.join(temp_dir, "blender_mcp_render.png")

        scene.render.filepath = render_path
        scene.render.image_settings.file_format = 'PNG'

        # Render
        bpy.ops.render.render(write_still=True)

        result = {
            "path": render_path,
            "resolution": [scene.render.resolution_x, scene.render.resolution_y],
            "engine": scene.render.engine
        }

        # Return base64 if requested
        if return_base64 and os.path.exists(render_path):
            with open(render_path, "rb") as f:
                result["base64"] = base64.b64encode(f.read()).decode("utf-8")

        return result

    finally:
        # Restore original settings
        scene.render.filepath = orig_path
        scene.render.image_settings.file_format = orig_format


@register_tool("render_animation")
def render_animation(params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Render an animation sequence.

    Params:
        output_path: Output directory or file path (with frame placeholder)
        frame_start: Optional start frame
        frame_end: Optional end frame
        file_format: Output format (PNG, JPEG, FFMPEG for video)
        resolution_x: Optional width
        resolution_y: Optional height

    Returns:
        Animation render result.
    """
    output_path = params.get("output_path")
    frame_start = params.get("frame_start")
    frame_end = params.get("frame_end")
    file_format = params.get("file_format", "PNG").upper()
    resolution_x = params.get("resolution_x")
    resolution_y = params.get("resolution_y")

    if not output_path:
        temp_dir = tempfile.gettempdir()
        output_path = os.path.join(temp_dir, "blender_mcp_anim_")

    scene = bpy.context.scene

    # Store original settings
    orig_path = scene.render.filepath
    orig_format = scene.render.image_settings.file_format

    try:
        scene.render.filepath = output_path

        if frame_start:
            scene.frame_start = int(frame_start)
        if frame_end:
            scene.frame_end = int(frame_end)
        if resolution_x:
            scene.render.resolution_x = int(resolution_x)
        if resolution_y:
            scene.render.resolution_y = int(resolution_y)

        if file_format in ('FFMPEG', 'AVI', 'MP4'):
            scene.render.image_settings.file_format = 'FFMPEG'
            scene.render.ffmpeg.format = 'MPEG4'
            scene.render.ffmpeg.codec = 'H264'
        else:
            scene.render.image_settings.file_format = file_format

        # Render animation
        bpy.ops.render.render(animation=True)

        return {
            "output_path": output_path,
            "frame_start": scene.frame_start,
            "frame_end": scene.frame_end,
            "frames": scene.frame_end - scene.frame_start + 1,
            "format": file_format
        }

    finally:
        scene.render.filepath = orig_path
        scene.render.image_settings.file_format = orig_format


@register_tool("get_viewport_screenshot")
def get_viewport_screenshot(params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Capture a screenshot of the 3D viewport.

    Params:
        output_path: Optional output file path
        width: Optional width (uses viewport size if not specified)
        height: Optional height
        view_type: View perspective (PERSP, ORTHO, CAMERA, etc.)
        return_base64: If true, return as base64 string

    Returns:
        Screenshot result with file path and optionally base64 data.
    """
    output_path = params.get("output_path")
    return_base64 = params.get("return_base64", True)

    if not output_path:
        temp_dir = tempfile.gettempdir()
        output_path = os.path.join(temp_dir, "blender_mcp_viewport.png")

    # Find a 3D view
    for area in bpy.context.screen.areas:
        if area.type == 'VIEW_3D':
            for region in area.regions:
                if region.type == 'WINDOW':
                    # Override context for the viewport
                    with bpy.context.temp_override(area=area, region=region):
                        # Save viewport render
                        bpy.ops.render.opengl(write_still=True)
                        bpy.data.images['Render Result'].save_render(filepath=output_path)

                    result = {
                        "path": output_path,
                        "width": region.width,
                        "height": region.height
                    }

                    if return_base64 and os.path.exists(output_path):
                        with open(output_path, "rb") as f:
                            result["base64"] = base64.b64encode(f.read()).decode("utf-8")

                    return result

    return {"status": "error", "error": "No 3D viewport found"}


@register_tool("set_render_settings")
def set_render_settings(params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Configure render settings.

    Params:
        engine: Render engine (CYCLES, EEVEE, WORKBENCH)
        resolution_x: Width in pixels
        resolution_y: Height in pixels
        resolution_percentage: Render scale (1-100)
        samples: Cycles samples
        use_denoising: Enable denoising (Cycles)
        film_transparent: Transparent background

    Returns:
        Updated render settings.
    """
    engine = params.get("engine")
    resolution_x = params.get("resolution_x")
    resolution_y = params.get("resolution_y")
    resolution_percentage = params.get("resolution_percentage")
    samples = params.get("samples")
    use_denoising = params.get("use_denoising")
    film_transparent = params.get("film_transparent")

    scene = bpy.context.scene
    render = scene.render

    if engine:
        engine = engine.upper()
        if engine == 'EEVEE':
            engine = 'BLENDER_EEVEE'
        if engine in ('CYCLES', 'BLENDER_EEVEE', 'BLENDER_WORKBENCH'):
            render.engine = engine

    if resolution_x is not None:
        render.resolution_x = int(resolution_x)
    if resolution_y is not None:
        render.resolution_y = int(resolution_y)
    if resolution_percentage is not None:
        render.resolution_percentage = int(resolution_percentage)

    if render.engine == 'CYCLES':
        if samples is not None:
            scene.cycles.samples = int(samples)
        if use_denoising is not None:
            scene.cycles.use_denoising = bool(use_denoising)

    if film_transparent is not None:
        render.film_transparent = bool(film_transparent)

    return {
        "engine": render.engine,
        "resolution": [render.resolution_x, render.resolution_y],
        "resolution_percentage": render.resolution_percentage,
        "samples": scene.cycles.samples if render.engine == 'CYCLES' else None,
        "film_transparent": render.film_transparent
    }


@register_tool("set_camera_view")
def set_camera_view(params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Configure camera settings and view.

    Params:
        camera_name: Optional camera name (uses scene camera if not specified)
        location: Optional [x, y, z] location
        target: Optional [x, y, z] point to look at
        lens: Optional focal length in mm
        set_active: If true, set as active scene camera

    Returns:
        Camera settings.
    """
    camera_name = params.get("camera_name")
    location = _validate_vec3(params.get("location"))
    target = _validate_vec3(params.get("target"))
    lens = params.get("lens")
    set_active = params.get("set_active", False)

    # Get camera
    if camera_name:
        cam_obj = bpy.data.objects.get(camera_name)
        if not cam_obj or cam_obj.type != 'CAMERA':
            return {"status": "error", "error": f"Camera '{camera_name}' not found"}
    else:
        cam_obj = bpy.context.scene.camera
        if not cam_obj:
            return {"status": "error", "error": "No active camera in scene"}

    # Set location
    if location:
        cam_obj.location = location

    # Point at target
    if target:
        import mathutils
        direction = mathutils.Vector(target) - cam_obj.location
        rot_quat = direction.to_track_quat('-Z', 'Y')
        cam_obj.rotation_euler = rot_quat.to_euler()

    # Set lens
    if lens is not None:
        cam_obj.data.lens = float(lens)

    # Set as active
    if set_active:
        bpy.context.scene.camera = cam_obj

    return {
        "camera": cam_obj.name,
        "location": list(cam_obj.location),
        "rotation": list(cam_obj.rotation_euler),
        "lens": cam_obj.data.lens,
        "is_active": bpy.context.scene.camera == cam_obj
    }


@register_tool("orbit_camera_render")
def orbit_camera_render(params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Render multiple views orbiting around an object.

    Params:
        object_name: Name of the object to orbit around
        output_dir: Output directory for rendered images
        num_views: Number of views to render (default 8)
        distance: Distance from object center
        elevation: Camera elevation angle in degrees
        return_base64: If true, return images as base64

    Returns:
        List of rendered view paths.
    """
    import math

    object_name = params.get("object_name")
    output_dir = params.get("output_dir")
    num_views = int(params.get("num_views", 8))
    distance = float(params.get("distance", 5.0))
    elevation = float(params.get("elevation", 30.0))
    return_base64 = params.get("return_base64", False)

    if not isinstance(object_name, str):
        return {"status": "error", "error": "object_name must be a string"}

    obj = bpy.data.objects.get(object_name)
    if not obj:
        return {"status": "error", "error": f"Object '{object_name}' not found"}

    if not output_dir:
        output_dir = tempfile.gettempdir()

    # Get object center
    center = obj.location

    # Create temporary camera
    bpy.ops.object.camera_add()
    temp_cam = bpy.context.view_layer.objects.active
    temp_cam.name = "MCP_Orbit_Camera"
    bpy.context.scene.camera = temp_cam

    rendered_views = []
    elevation_rad = math.radians(elevation)

    try:
        for i in range(num_views):
            # Calculate camera position
            angle = (2 * math.pi * i) / num_views
            x = center.x + distance * math.cos(angle) * math.cos(elevation_rad)
            y = center.y + distance * math.sin(angle) * math.cos(elevation_rad)
            z = center.z + distance * math.sin(elevation_rad)

            temp_cam.location = (x, y, z)

            # Point at object center
            import mathutils
            direction = mathutils.Vector(center) - temp_cam.location
            rot_quat = direction.to_track_quat('-Z', 'Y')
            temp_cam.rotation_euler = rot_quat.to_euler()

            # Render
            output_path = os.path.join(output_dir, f"orbit_view_{i:03d}.png")
            bpy.context.scene.render.filepath = output_path
            bpy.ops.render.render(write_still=True)

            view_result = {
                "view_index": i,
                "angle_degrees": math.degrees(angle),
                "path": output_path
            }

            if return_base64 and os.path.exists(output_path):
                with open(output_path, "rb") as f:
                    view_result["base64"] = base64.b64encode(f.read()).decode("utf-8")

            rendered_views.append(view_result)

    finally:
        # Clean up temporary camera
        bpy.data.objects.remove(temp_cam)

    return {
        "object": object_name,
        "views": rendered_views,
        "num_views": num_views,
        "distance": distance,
        "elevation": elevation
    }
