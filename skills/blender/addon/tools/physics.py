"""
Physics Tools for Unified Blender MCP.

Tools for setting up physics simulations (rigid body, cloth, fluid, etc.).
"""

import bpy
from typing import Any, Dict, Optional
from . import register_tool


@register_tool("setup_rigid_body")
def setup_rigid_body(params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Set up rigid body physics on an object.

    Params:
        object_name: Name of the object
        type: Rigid body type (ACTIVE or PASSIVE)
        mass: Mass of the object (default 1.0)
        friction: Friction coefficient (default 0.5)
        restitution: Bounciness (default 0.0)
        collision_shape: Shape for collisions (BOX, SPHERE, CAPSULE, CYLINDER, CONE, CONVEX_HULL, MESH)
        use_margin: Enable collision margin
        collision_margin: Collision margin value

    Returns:
        Rigid body setup information.
    """
    object_name = params.get("object_name")
    rb_type = params.get("type", "ACTIVE").upper()
    mass = float(params.get("mass", 1.0))
    friction = float(params.get("friction", 0.5))
    restitution = float(params.get("restitution", 0.0))
    collision_shape = params.get("collision_shape", "CONVEX_HULL").upper()
    use_margin = params.get("use_margin", False)
    collision_margin = float(params.get("collision_margin", 0.04))

    if not isinstance(object_name, str):
        return {"status": "error", "error": "object_name must be a string"}

    obj = bpy.data.objects.get(object_name)
    if not obj:
        return {"status": "error", "error": f"Object '{object_name}' not found"}

    # Ensure we have a rigid body world
    scene = bpy.context.scene
    if not scene.rigidbody_world:
        bpy.ops.rigidbody.world_add()

    # Select and activate the object
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj

    # Add rigid body
    try:
        bpy.ops.rigidbody.object_add(type=rb_type)
    except Exception as e:
        return {"status": "error", "error": f"Failed to add rigid body: {str(e)}"}

    # Configure rigid body properties
    rb = obj.rigid_body
    if rb:
        rb.mass = mass
        rb.friction = friction
        rb.restitution = restitution
        rb.collision_shape = collision_shape
        rb.use_margin = use_margin
        rb.collision_margin = collision_margin

    return {
        "object": object_name,
        "type": rb_type,
        "mass": mass,
        "collision_shape": collision_shape
    }


@register_tool("setup_cloth")
def setup_cloth(params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Set up cloth simulation on a mesh object.

    Params:
        object_name: Name of the object
        quality: Simulation quality steps (default 5)
        mass: Vertex mass (default 0.3)
        air_damping: Air resistance (default 1.0)
        tension_stiffness: Cloth stiffness (default 15.0)
        compression_stiffness: Compression resistance (default 15.0)
        bending_stiffness: Bending resistance (default 0.5)
        use_pressure: Enable pressure simulation
        pressure: Pressure value

    Returns:
        Cloth setup information.
    """
    object_name = params.get("object_name")
    quality = int(params.get("quality", 5))
    mass = float(params.get("mass", 0.3))
    air_damping = float(params.get("air_damping", 1.0))
    tension_stiffness = float(params.get("tension_stiffness", 15.0))
    compression_stiffness = float(params.get("compression_stiffness", 15.0))
    bending_stiffness = float(params.get("bending_stiffness", 0.5))
    use_pressure = params.get("use_pressure", False)
    pressure = float(params.get("pressure", 0.0))

    if not isinstance(object_name, str):
        return {"status": "error", "error": "object_name must be a string"}

    obj = bpy.data.objects.get(object_name)
    if not obj:
        return {"status": "error", "error": f"Object '{object_name}' not found"}

    if obj.type != 'MESH':
        return {"status": "error", "error": f"Object '{object_name}' must be a mesh for cloth simulation"}

    # Select and activate the object
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj

    # Add cloth modifier
    cloth_mod = obj.modifiers.get("Cloth")
    if not cloth_mod:
        cloth_mod = obj.modifiers.new(name="Cloth", type='CLOTH')

    # Configure cloth settings
    cloth = cloth_mod.settings
    cloth.quality = quality
    cloth.mass = mass
    cloth.air_damping = air_damping
    cloth.tension_stiffness = tension_stiffness
    cloth.compression_stiffness = compression_stiffness
    cloth.bending_stiffness = bending_stiffness
    cloth.use_pressure = use_pressure
    if use_pressure:
        cloth.uniform_pressure_force = pressure

    return {
        "object": object_name,
        "modifier": cloth_mod.name,
        "quality": quality,
        "mass": mass
    }


@register_tool("setup_collision")
def setup_collision(params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Set up collision physics on an object (for cloth/soft body interactions).

    Params:
        object_name: Name of the object
        thickness_outer: Outer collision thickness (default 0.02)
        thickness_inner: Inner collision thickness (default 0.01)
        damping: Collision damping (default 1.0)
        friction: Collision friction (default 0.0)

    Returns:
        Collision setup information.
    """
    object_name = params.get("object_name")
    thickness_outer = float(params.get("thickness_outer", 0.02))
    thickness_inner = float(params.get("thickness_inner", 0.01))
    damping = float(params.get("damping", 1.0))
    friction = float(params.get("friction", 0.0))

    if not isinstance(object_name, str):
        return {"status": "error", "error": "object_name must be a string"}

    obj = bpy.data.objects.get(object_name)
    if not obj:
        return {"status": "error", "error": f"Object '{object_name}' not found"}

    # Select and activate the object
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj

    # Add collision modifier
    collision_mod = obj.modifiers.get("Collision")
    if not collision_mod:
        collision_mod = obj.modifiers.new(name="Collision", type='COLLISION')

    # Configure collision settings
    coll = collision_mod.settings
    coll.thickness_outer = thickness_outer
    coll.thickness_inner = thickness_inner
    coll.damping = damping
    coll.cloth_friction = friction

    return {
        "object": object_name,
        "modifier": collision_mod.name,
        "thickness_outer": thickness_outer,
        "thickness_inner": thickness_inner
    }


@register_tool("setup_soft_body")
def setup_soft_body(params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Set up soft body physics on a mesh object.

    Params:
        object_name: Name of the object
        mass: Total mass (default 1.0)
        friction: Friction coefficient (default 0.5)
        speed: Simulation speed (default 1.0)
        goal_spring: Goal spring strength (default 0.5)
        goal_friction: Goal friction (default 0.5)
        use_edges: Use edge springs
        use_stiff_quads: Use stiff quads
        push: Push force (default 0.0)
        pull: Pull force (default 0.0)

    Returns:
        Soft body setup information.
    """
    object_name = params.get("object_name")
    mass = float(params.get("mass", 1.0))
    friction = float(params.get("friction", 0.5))
    speed = float(params.get("speed", 1.0))
    goal_spring = float(params.get("goal_spring", 0.5))
    goal_friction = float(params.get("goal_friction", 0.5))
    use_edges = params.get("use_edges", True)
    use_stiff_quads = params.get("use_stiff_quads", True)
    push = float(params.get("push", 0.0))
    pull = float(params.get("pull", 0.0))

    if not isinstance(object_name, str):
        return {"status": "error", "error": "object_name must be a string"}

    obj = bpy.data.objects.get(object_name)
    if not obj:
        return {"status": "error", "error": f"Object '{object_name}' not found"}

    # Select and activate the object
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj

    # Add soft body modifier
    sb_mod = obj.modifiers.get("Softbody")
    if not sb_mod:
        sb_mod = obj.modifiers.new(name="Softbody", type='SOFT_BODY')

    # Configure soft body settings
    sb = sb_mod.settings
    sb.mass = mass
    sb.friction = friction
    sb.speed = speed
    sb.goal_spring = goal_spring
    sb.goal_friction = goal_friction
    sb.use_edges = use_edges
    sb.use_stiff_quads = use_stiff_quads
    sb.push = push
    sb.pull = pull

    return {
        "object": object_name,
        "modifier": sb_mod.name,
        "mass": mass,
        "friction": friction
    }


@register_tool("bake_physics")
def bake_physics(params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Bake physics simulation for an object or all physics.

    Params:
        object_name: Optional - specific object to bake (if not provided, bakes all)
        type: Type of physics to bake (ALL, RIGID_BODY, CLOTH, SOFT_BODY)
        frame_start: Start frame for baking
        frame_end: End frame for baking

    Returns:
        Baking result.
    """
    object_name = params.get("object_name")
    bake_type = params.get("type", "ALL").upper()
    frame_start = params.get("frame_start", bpy.context.scene.frame_start)
    frame_end = params.get("frame_end", bpy.context.scene.frame_end)

    scene = bpy.context.scene

    if object_name:
        obj = bpy.data.objects.get(object_name)
        if not obj:
            return {"status": "error", "error": f"Object '{object_name}' not found"}

        # Select the object
        bpy.ops.object.select_all(action='DESELECT')
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj

    try:
        if bake_type == "RIGID_BODY":
            if scene.rigidbody_world:
                scene.rigidbody_world.point_cache.frame_start = frame_start
                scene.rigidbody_world.point_cache.frame_end = frame_end
                bpy.ops.ptcache.bake_all(bake=True)
        elif bake_type == "CLOTH":
            bpy.ops.ptcache.bake_all(bake=True)
        elif bake_type == "SOFT_BODY":
            bpy.ops.ptcache.bake_all(bake=True)
        else:
            bpy.ops.ptcache.bake_all(bake=True)
    except Exception as e:
        return {"status": "error", "error": f"Baking failed: {str(e)}"}

    return {
        "baked": bake_type,
        "frame_start": frame_start,
        "frame_end": frame_end,
        "object": object_name
    }


@register_tool("remove_physics")
def remove_physics(params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Remove physics from an object.

    Params:
        object_name: Name of the object
        type: Type of physics to remove (RIGID_BODY, CLOTH, COLLISION, SOFT_BODY, ALL)

    Returns:
        Removal result.
    """
    object_name = params.get("object_name")
    physics_type = params.get("type", "ALL").upper()

    if not isinstance(object_name, str):
        return {"status": "error", "error": "object_name must be a string"}

    obj = bpy.data.objects.get(object_name)
    if not obj:
        return {"status": "error", "error": f"Object '{object_name}' not found"}

    # Select the object
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj

    removed = []

    if physics_type in ("RIGID_BODY", "ALL") and obj.rigid_body:
        bpy.ops.rigidbody.object_remove()
        removed.append("RIGID_BODY")

    if physics_type in ("CLOTH", "ALL"):
        cloth_mod = obj.modifiers.get("Cloth")
        if cloth_mod:
            obj.modifiers.remove(cloth_mod)
            removed.append("CLOTH")

    if physics_type in ("COLLISION", "ALL"):
        coll_mod = obj.modifiers.get("Collision")
        if coll_mod:
            obj.modifiers.remove(coll_mod)
            removed.append("COLLISION")

    if physics_type in ("SOFT_BODY", "ALL"):
        sb_mod = obj.modifiers.get("Softbody")
        if sb_mod:
            obj.modifiers.remove(sb_mod)
            removed.append("SOFT_BODY")

    return {
        "object": object_name,
        "removed": removed
    }
