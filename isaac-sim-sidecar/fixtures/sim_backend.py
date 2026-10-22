"""The only module that touches Isaac Sim APIs. Fixtures call this; a Sim API change is a one-file fix.

These APIs have been exercised against the pinned 6.2.0 image. The baked fixtures'
verification outputs remain the authority for physics acceptance; a missing symbol
fails at import, never with a silent fallback.
"""
import os


def start(headless=True):
    from isaacsim import SimulationApp  # must precede every other omni/pxr import
    portable = os.environ.get("ISAAC_KIT_PORTABLE_ROOT", os.path.join(os.environ.get("HOME", "/tmp"), "kit"))
    return SimulationApp({"headless": headless, "renderer": "RayTracedLighting",
                          "extra_args": ["--portable-root", portable]})


def make_world(dt, substeps=1):
    """A World whose physics step is `dt` with no rendering, gravity -9.81 m/s^2 on -Z, metres."""
    from isaacsim.core.api import World
    world = World(stage_units_in_meters=1.0, physics_dt=dt, rendering_dt=dt)
    scene = world.get_physics_context()
    scene.set_gravity(-9.81)
    return world


def add_ground(world, size=20.0):
    from isaacsim.core.api.objects import GroundPlane
    world.scene.add(GroundPlane(prim_path="/World/ground", size=size, z_position=0.0))


def add_box(world, path, position, size=0.2, mass=1.0):
    import numpy as np
    from isaacsim.core.api.objects import DynamicCuboid
    return world.scene.add(DynamicCuboid(prim_path=path, name=path.strip("/").replace("/", "_"),
                                         position=np.array(position, dtype=float), scale=np.array([size] * 3),
                                         mass=mass))


def pose_and_velocity(prim):
    """(position[3], quaternion wxyz[4], linear[3], angular[3]) in world frame, SI units, as lists."""
    pos, quat = prim.get_world_pose()
    lin = prim.get_linear_velocity()
    ang = prim.get_angular_velocity()
    return [float(x) for x in pos], [float(x) for x in quat], [float(x) for x in lin], [float(x) for x in ang]


def rigid_view(world, path, name):
    """A pose/velocity view of ONE body (an articulation view reports only its root)."""
    from isaacsim.core.prims import SingleRigidPrim
    return world.scene.add(SingleRigidPrim(prim_path=path, name=name))


def build_pendulum(world, length, mass=1.0, limits=(-1.2, 1.2)):
    """Fixed anchor + one revolute hinge about +Y + a bob, authored AT REST (bob straight below).

    The release angle is applied after world.reset() with set_joint_positions, so the joint frames stay
    identity and the hinge angle is exactly what the caller sets. Returns (articulation, bob_path).
    """
    import math
    from pxr import Gf, UsdGeom, UsdPhysics
    import omni.usd
    from isaacsim.core.prims import SingleArticulation
    stage = omni.usd.get_context().get_stage()
    pivot_z = 2.0
    anchor = UsdGeom.Xform.Define(stage, "/World/pendulum").GetPrim()
    UsdPhysics.ArticulationRootAPI.Apply(anchor)
    base = UsdGeom.Cube.Define(stage, "/World/pendulum/anchor")
    base.GetSizeAttr().Set(0.05)
    UsdGeom.Xformable(base).AddTranslateOp().Set(Gf.Vec3d(0, 0, pivot_z))
    UsdPhysics.RigidBodyAPI.Apply(base.GetPrim())
    anchor_mass = UsdPhysics.MassAPI.Apply(base.GetPrim())
    anchor_mass.CreateMassAttr(1.0)
    anchor_mass.CreateDiagonalInertiaAttr(Gf.Vec3f(0.05 ** 2 / 6))
    bob = UsdGeom.Sphere.Define(stage, "/World/pendulum/bob")
    bob.GetRadiusAttr().Set(0.05)
    xf = UsdGeom.Xformable(bob)
    xf.AddTranslateOp().Set(Gf.Vec3d(0, 0, pivot_z - length))
    body = UsdPhysics.RigidBodyAPI.Apply(bob.GetPrim())
    UsdPhysics.CollisionAPI.Apply(bob.GetPrim())
    UsdPhysics.MassAPI.Apply(bob.GetPrim()).CreateMassAttr(mass)
    fixed = UsdPhysics.FixedJoint.Define(stage, "/World/pendulum/world_anchor")
    fixed.CreateBody1Rel().SetTargets([base.GetPath()])
    hinge = UsdPhysics.RevoluteJoint.Define(stage, "/World/pendulum/hinge")
    hinge.CreateBody0Rel().SetTargets([base.GetPath()])
    hinge.CreateBody1Rel().SetTargets([bob.GetPath()])
    hinge.CreateAxisAttr("Y")
    hinge.CreateLocalPos0Attr(Gf.Vec3f(0, 0, 0))
    hinge.CreateLocalPos1Attr(Gf.Vec3f(0, 0, length))
    hinge.CreateLowerLimitAttr(math.degrees(limits[0]))
    hinge.CreateUpperLimitAttr(math.degrees(limits[1]))
    art = world.scene.add(SingleArticulation(prim_path="/World/pendulum", name="pendulum"))
    return art, bob.GetPath().pathString


def stop(app, exit_code=0):
    app.close(exit_code=exit_code)


def env_seed():
    return int(os.environ.get("ISAAC_SEED", "0"))
