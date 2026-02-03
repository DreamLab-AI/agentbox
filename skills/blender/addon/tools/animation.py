"""
Animation Tools for Unified Blender MCP.

Tools for creating and managing animations and keyframes.
"""

import bpy
from typing import Any, Dict, List, Optional, Tuple
from . import register_tool


def _validate_vec3(val: Any) -> Optional[Tuple[float, float, float]]:
    """Validate and convert a value to a 3D vector tuple."""
    try:
        if isinstance(val, (list, tuple)) and len(val) == 3:
            return (float(val[0]), float(val[1]), float(val[2]))
    except (TypeError, ValueError):
        pass
    return None


@register_tool("create_keyframe")
def create_keyframe(params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Create a keyframe for an object property.

    Params:
        object_name: Name of the object
        data_path: Property path (location, rotation_euler, scale, etc.)
        frame: Frame number
        value: Optional value to set before keying (array for vector properties)
        index: Optional index for array properties (-1 for all)

    Returns:
        Keyframe creation result.
    """
    object_name = params.get("object_name")
    data_path = params.get("data_path", "location")
    frame = int(params.get("frame", bpy.context.scene.frame_current))
    value = params.get("value")
    index = int(params.get("index", -1))

    if not isinstance(object_name, str):
        return {"status": "error", "error": "object_name must be a string"}

    obj = bpy.data.objects.get(object_name)
    if not obj:
        return {"status": "error", "error": f"Object '{object_name}' not found"}

    # Set value if provided
    if value is not None:
        try:
            attr = getattr(obj, data_path)
            if isinstance(attr, (tuple, list)) or hasattr(attr, '__iter__'):
                if isinstance(value, (list, tuple)):
                    for i, v in enumerate(value):
                        attr[i] = v
                elif index >= 0:
                    attr[index] = value
            else:
                setattr(obj, data_path, value)
        except Exception as e:
            return {"status": "error", "error": f"Failed to set value: {str(e)}"}

    # Insert keyframe
    try:
        obj.keyframe_insert(data_path=data_path, frame=frame, index=index)
    except Exception as e:
        return {"status": "error", "error": f"Failed to create keyframe: {str(e)}"}

    return {
        "object": object_name,
        "data_path": data_path,
        "frame": frame,
        "index": index
    }


@register_tool("animate_transform")
def animate_transform(params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Create a simple transform animation between two states.

    Params:
        object_name: Name of the object
        start_frame: Start frame
        end_frame: End frame
        start_location: Optional start location [x, y, z]
        end_location: Optional end location [x, y, z]
        start_rotation: Optional start rotation [x, y, z] in radians
        end_rotation: Optional end rotation [x, y, z] in radians
        start_scale: Optional start scale [x, y, z]
        end_scale: Optional end scale [x, y, z]
        interpolation: Interpolation type (LINEAR, BEZIER, CONSTANT)

    Returns:
        Animation creation result.
    """
    object_name = params.get("object_name")
    start_frame = int(params.get("start_frame", 1))
    end_frame = int(params.get("end_frame", 60))
    start_location = _validate_vec3(params.get("start_location"))
    end_location = _validate_vec3(params.get("end_location"))
    start_rotation = _validate_vec3(params.get("start_rotation"))
    end_rotation = _validate_vec3(params.get("end_rotation"))
    start_scale = _validate_vec3(params.get("start_scale"))
    end_scale = _validate_vec3(params.get("end_scale"))
    interpolation = params.get("interpolation", "BEZIER").upper()

    if not isinstance(object_name, str):
        return {"status": "error", "error": "object_name must be a string"}

    obj = bpy.data.objects.get(object_name)
    if not obj:
        return {"status": "error", "error": f"Object '{object_name}' not found"}

    keyframes_created = []

    # Set start frame keyframes
    bpy.context.scene.frame_set(start_frame)

    if start_location:
        obj.location = start_location
        obj.keyframe_insert(data_path="location", frame=start_frame)
        keyframes_created.append(("location", start_frame))

    if start_rotation:
        obj.rotation_euler = start_rotation
        obj.keyframe_insert(data_path="rotation_euler", frame=start_frame)
        keyframes_created.append(("rotation_euler", start_frame))

    if start_scale:
        obj.scale = start_scale
        obj.keyframe_insert(data_path="scale", frame=start_frame)
        keyframes_created.append(("scale", start_frame))

    # Set end frame keyframes
    bpy.context.scene.frame_set(end_frame)

    if end_location:
        obj.location = end_location
        obj.keyframe_insert(data_path="location", frame=end_frame)
        keyframes_created.append(("location", end_frame))

    if end_rotation:
        obj.rotation_euler = end_rotation
        obj.keyframe_insert(data_path="rotation_euler", frame=end_frame)
        keyframes_created.append(("rotation_euler", end_frame))

    if end_scale:
        obj.scale = end_scale
        obj.keyframe_insert(data_path="scale", frame=end_frame)
        keyframes_created.append(("scale", end_frame))

    # Set interpolation type
    if obj.animation_data and obj.animation_data.action:
        for fcurve in obj.animation_data.action.fcurves:
            for keyframe in fcurve.keyframe_points:
                keyframe.interpolation = interpolation

    return {
        "object": object_name,
        "start_frame": start_frame,
        "end_frame": end_frame,
        "keyframes": len(keyframes_created),
        "interpolation": interpolation
    }


@register_tool("delete_keyframes")
def delete_keyframes(params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Delete keyframes from an object.

    Params:
        object_name: Name of the object
        data_path: Optional - specific property path to clear
        frame: Optional - specific frame to clear (otherwise clears all)
        clear_all: If true, clear all animation data

    Returns:
        Deletion result.
    """
    object_name = params.get("object_name")
    data_path = params.get("data_path")
    frame = params.get("frame")
    clear_all = params.get("clear_all", False)

    if not isinstance(object_name, str):
        return {"status": "error", "error": "object_name must be a string"}

    obj = bpy.data.objects.get(object_name)
    if not obj:
        return {"status": "error", "error": f"Object '{object_name}' not found"}

    if not obj.animation_data:
        return {"status": "error", "error": f"Object '{object_name}' has no animation data"}

    if clear_all:
        obj.animation_data_clear()
        return {"object": object_name, "cleared": "all"}

    if data_path:
        try:
            if frame is not None:
                obj.keyframe_delete(data_path=data_path, frame=int(frame))
            else:
                # Remove all keyframes for this data path
                action = obj.animation_data.action
                if action:
                    fcurves_to_remove = [fc for fc in action.fcurves if fc.data_path == data_path]
                    for fc in fcurves_to_remove:
                        action.fcurves.remove(fc)
        except Exception as e:
            return {"status": "error", "error": f"Failed to delete keyframes: {str(e)}"}

    return {
        "object": object_name,
        "data_path": data_path,
        "frame": frame
    }


@register_tool("set_frame")
def set_frame(params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Set the current frame in the timeline.

    Params:
        frame: Frame number to set

    Returns:
        New frame information.
    """
    frame = params.get("frame")
    if frame is None:
        return {"status": "error", "error": "frame must be specified"}

    frame = int(frame)
    bpy.context.scene.frame_set(frame)

    return {
        "frame": frame,
        "frame_start": bpy.context.scene.frame_start,
        "frame_end": bpy.context.scene.frame_end
    }


@register_tool("set_frame_range")
def set_frame_range(params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Set the animation frame range.

    Params:
        frame_start: Start frame
        frame_end: End frame
        fps: Optional frames per second

    Returns:
        New frame range information.
    """
    frame_start = params.get("frame_start")
    frame_end = params.get("frame_end")
    fps = params.get("fps")

    scene = bpy.context.scene

    if frame_start is not None:
        scene.frame_start = int(frame_start)
    if frame_end is not None:
        scene.frame_end = int(frame_end)
    if fps is not None:
        scene.render.fps = int(fps)

    return {
        "frame_start": scene.frame_start,
        "frame_end": scene.frame_end,
        "fps": scene.render.fps,
        "duration_seconds": (scene.frame_end - scene.frame_start + 1) / scene.render.fps
    }


@register_tool("get_animation_info")
def get_animation_info(params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Get animation information for an object.

    Params:
        object_name: Name of the object

    Returns:
        Animation data including actions, fcurves, and keyframes.
    """
    object_name = params.get("object_name")

    if not isinstance(object_name, str):
        return {"status": "error", "error": "object_name must be a string"}

    obj = bpy.data.objects.get(object_name)
    if not obj:
        return {"status": "error", "error": f"Object '{object_name}' not found"}

    info = {
        "object": object_name,
        "has_animation": False,
        "action": None,
        "fcurves": [],
        "keyframe_count": 0
    }

    if obj.animation_data and obj.animation_data.action:
        info["has_animation"] = True
        action = obj.animation_data.action
        info["action"] = action.name

        for fc in action.fcurves:
            fc_info = {
                "data_path": fc.data_path,
                "array_index": fc.array_index,
                "keyframe_count": len(fc.keyframe_points),
                "keyframes": [
                    {"frame": kp.co[0], "value": kp.co[1], "interpolation": kp.interpolation}
                    for kp in fc.keyframe_points
                ]
            }
            info["fcurves"].append(fc_info)
            info["keyframe_count"] += len(fc.keyframe_points)

    return info


@register_tool("play_animation")
def play_animation(params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Control animation playback.

    Params:
        action: Playback action (PLAY, PAUSE, STOP, TOGGLE)

    Returns:
        Playback status.
    """
    action = params.get("action", "TOGGLE").upper()

    if action == "PLAY":
        bpy.ops.screen.animation_play()
    elif action == "PAUSE" or action == "STOP":
        bpy.ops.screen.animation_cancel()
    elif action == "TOGGLE":
        if bpy.context.screen.is_animation_playing:
            bpy.ops.screen.animation_cancel()
        else:
            bpy.ops.screen.animation_play()

    return {
        "action": action,
        "is_playing": bpy.context.screen.is_animation_playing,
        "current_frame": bpy.context.scene.frame_current
    }
