"""
Unified Blender MCP Addon - Main Entry Point
Controls Blender 5.x via WebSocket RPC from Claude Code.

Architecture:
- WebSocket server runs in background thread
- Commands queued and executed on main thread via bpy.app.timers
- Thread-safe execution ensures Blender stability
"""

bl_info = {
    "name": "Unified Blender MCP",
    "author": "Unified Blender MCP Team",
    "version": (1, 0, 0),
    "blender": (5, 0, 0),
    "location": "View3D > Sidebar > MCP",
    "description": "WebSocket RPC bridge for Claude Code integration",
    "category": "Interface",
    "doc_url": "https://github.com/unified-blender-mcp",
    "tracker_url": "https://github.com/unified-blender-mcp/issues",
}

import bpy
from bpy.types import Panel, Operator, AddonPreferences, PropertyGroup
from bpy.props import StringProperty, IntProperty, BoolProperty, EnumProperty

# Conditional imports - may fail before dependencies installed
SERVER_AVAILABLE = False
try:
    from . import server
    from . import dispatcher
    SERVER_AVAILABLE = True
except ImportError:
    pass


class UnifiedMCPPreferences(AddonPreferences):
    """Addon preferences for API keys and server configuration."""
    bl_idname = __name__

    server_host: StringProperty(
        name="Host",
        description="WebSocket server host (keep localhost for security)",
        default="127.0.0.1"
    )

    server_port: IntProperty(
        name="Port",
        description="WebSocket server port",
        default=8765,
        min=1024,
        max=65535
    )

    auto_start: BoolProperty(
        name="Auto-start Server",
        description="Start WebSocket server when Blender launches",
        default=True
    )

    auth_token: StringProperty(
        name="Auth Token",
        description="Optional authentication token for security",
        default="",
        subtype='PASSWORD'
    )

    # API Keys for external services
    csm_api_key: StringProperty(
        name="CSM.ai API Key",
        description="API key for CSM.ai 3D model generation",
        default="",
        subtype='PASSWORD'
    )

    sketchfab_api_key: StringProperty(
        name="Sketchfab API Key",
        description="API key for Sketchfab model downloads",
        default="",
        subtype='PASSWORD'
    )

    polyhaven_enabled: BoolProperty(
        name="Enable PolyHaven",
        description="Enable PolyHaven asset integration (free, no API key needed)",
        default=True
    )

    rodin_api_key: StringProperty(
        name="Hyper3D Rodin API Key",
        description="API key for Hyper3D Rodin AI generation",
        default="",
        subtype='PASSWORD'
    )

    hunyuan_api_key: StringProperty(
        name="Hunyuan3D API Key",
        description="API key for Tencent Hunyuan3D generation",
        default="",
        subtype='PASSWORD'
    )

    def draw(self, context):
        layout = self.layout

        # Server Settings
        box = layout.box()
        box.label(text="Server Configuration", icon='WORLD')
        col = box.column(align=True)
        col.prop(self, "server_host")
        col.prop(self, "server_port")
        col.prop(self, "auto_start")
        col.prop(self, "auth_token")

        # Dependency Status
        box = layout.box()
        box.label(text="Dependencies", icon='SCRIPT')
        if SERVER_AVAILABLE:
            box.label(text="All dependencies installed", icon='CHECKMARK')
        else:
            box.label(text="Dependencies missing - click Install", icon='ERROR')
            box.operator("unified_mcp.install_deps", icon='IMPORT')

        # API Keys
        box = layout.box()
        box.label(text="API Keys for External Services", icon='KEY_HLT')
        col = box.column(align=True)
        col.prop(self, "csm_api_key")
        col.prop(self, "sketchfab_api_key")
        col.prop(self, "polyhaven_enabled")
        col.prop(self, "rodin_api_key")
        col.prop(self, "hunyuan_api_key")


class UNIFIED_MCP_OT_install_deps(Operator):
    """Install required Python dependencies into Blender's bundled Python."""
    bl_idname = "unified_mcp.install_deps"
    bl_label = "Install Dependencies"
    bl_description = "Install websockets and requests packages"
    bl_options = {'REGISTER'}

    def execute(self, context):
        import subprocess
        import sys
        import ensurepip

        python_exe = sys.executable

        try:
            # Ensure pip is available
            ensurepip.bootstrap(upgrade=True)

            # Install required packages
            packages = ['websockets', 'requests', 'numpy']
            for pkg in packages:
                self.report({'INFO'}, f"Installing {pkg}...")
                subprocess.check_call([
                    python_exe, '-m', 'pip', 'install',
                    '--user', '--upgrade', pkg
                ])

            self.report({'INFO'}, "Dependencies installed! Please restart Blender.")
            return {'FINISHED'}

        except Exception as e:
            self.report({'ERROR'}, f"Failed to install dependencies: {str(e)}")
            return {'CANCELLED'}


class UNIFIED_MCP_OT_start_server(Operator):
    """Start the WebSocket RPC server."""
    bl_idname = "unified_mcp.start_server"
    bl_label = "Start Server"
    bl_description = "Start the MCP WebSocket server"
    bl_options = {'REGISTER'}

    def execute(self, context):
        if not SERVER_AVAILABLE:
            self.report({'ERROR'}, "Dependencies not installed. Install them first.")
            return {'CANCELLED'}

        prefs = context.preferences.addons[__name__].preferences

        try:
            server.start(prefs.server_host, prefs.server_port, prefs.auth_token)
            self.report({'INFO'}, f"Server started on ws://{prefs.server_host}:{prefs.server_port}")
            return {'FINISHED'}
        except Exception as e:
            self.report({'ERROR'}, f"Failed to start server: {str(e)}")
            return {'CANCELLED'}


class UNIFIED_MCP_OT_stop_server(Operator):
    """Stop the WebSocket RPC server."""
    bl_idname = "unified_mcp.stop_server"
    bl_label = "Stop Server"
    bl_description = "Stop the MCP WebSocket server"
    bl_options = {'REGISTER'}

    def execute(self, context):
        if not SERVER_AVAILABLE:
            self.report({'WARNING'}, "Server module not available")
            return {'CANCELLED'}

        try:
            server.stop()
            self.report({'INFO'}, "Server stopped")
            return {'FINISHED'}
        except Exception as e:
            self.report({'ERROR'}, f"Failed to stop server: {str(e)}")
            return {'CANCELLED'}


class UNIFIED_MCP_PT_main_panel(Panel):
    """Main panel in the 3D View sidebar."""
    bl_label = "Unified MCP"
    bl_idname = "UNIFIED_MCP_PT_main_panel"
    bl_space_type = 'VIEW_3D'
    bl_region_type = 'UI'
    bl_category = 'MCP'

    def draw(self, context):
        layout = self.layout
        prefs = context.preferences.addons[__name__].preferences

        # Server Status
        box = layout.box()
        box.label(text="Server Status", icon='WORLD')

        if not SERVER_AVAILABLE:
            box.label(text="Dependencies not installed", icon='ERROR')
            box.operator("unified_mcp.install_deps", icon='IMPORT')
            return

        is_running = server.is_running() if SERVER_AVAILABLE else False

        if is_running:
            box.label(text=f"Running on ws://{prefs.server_host}:{prefs.server_port}", icon='CHECKMARK')
            box.operator("unified_mcp.stop_server", text="Stop Server", icon='PAUSE')
        else:
            box.label(text="Server stopped", icon='X')
            box.operator("unified_mcp.start_server", text="Start Server", icon='PLAY')

        # Quick Info
        box = layout.box()
        box.label(text="Connection Info", icon='INFO')
        col = box.column(align=True)
        col.label(text=f"Host: {prefs.server_host}")
        col.label(text=f"Port: {prefs.server_port}")
        if prefs.auth_token:
            col.label(text="Auth: Enabled", icon='LOCKED')
        else:
            col.label(text="Auth: Disabled", icon='UNLOCKED')

        # External Services Status
        box = layout.box()
        box.label(text="External Services", icon='LINKED')
        col = box.column(align=True)

        # CSM.ai
        if prefs.csm_api_key:
            col.label(text="CSM.ai: Configured", icon='CHECKMARK')
        else:
            col.label(text="CSM.ai: Not configured", icon='X')

        # PolyHaven
        if prefs.polyhaven_enabled:
            col.label(text="PolyHaven: Enabled", icon='CHECKMARK')
        else:
            col.label(text="PolyHaven: Disabled", icon='X')

        # Sketchfab
        if prefs.sketchfab_api_key:
            col.label(text="Sketchfab: Configured", icon='CHECKMARK')
        else:
            col.label(text="Sketchfab: Not configured", icon='X')


# Registration
classes = [
    UnifiedMCPPreferences,
    UNIFIED_MCP_OT_install_deps,
    UNIFIED_MCP_OT_start_server,
    UNIFIED_MCP_OT_stop_server,
    UNIFIED_MCP_PT_main_panel,
]


def register():
    for cls in classes:
        bpy.utils.register_class(cls)

    # Register dispatcher timer if available
    if SERVER_AVAILABLE:
        dispatcher.register()

        # Auto-start server if enabled
        prefs = bpy.context.preferences.addons.get(__name__)
        if prefs and prefs.preferences.auto_start:
            bpy.app.timers.register(
                lambda: _delayed_server_start(),
                first_interval=1.0
            )


def unregister():
    # Stop server if running
    if SERVER_AVAILABLE:
        try:
            server.stop()
        except:
            pass
        dispatcher.unregister()

    for cls in reversed(classes):
        bpy.utils.unregister_class(cls)


def _delayed_server_start():
    """Start server after Blender is fully initialized."""
    try:
        prefs = bpy.context.preferences.addons[__name__].preferences
        server.start(prefs.server_host, prefs.server_port, prefs.auth_token)
        print(f"[UnifiedMCP] Auto-started server on ws://{prefs.server_host}:{prefs.server_port}")
    except Exception as e:
        print(f"[UnifiedMCP] Auto-start failed: {e}")
    return None  # Don't repeat


if __name__ == "__main__":
    register()
