#!/usr/bin/env python3
"""
QGIS MCP Server - Launcher shim.

This delegates to the nkarasiak/qgis-mcp FastMCP server which provides 51+ tools
for QGIS control via MCP protocol. The actual server lives at:
  /home/devuser/workspace/qgis-mcp/src/qgis_mcp/server.py

To run directly:
  uv run --project /home/devuser/workspace/qgis-mcp src/qgis_mcp/server.py

Or via claude mcp:
  claude mcp add --transport stdio qgis -- uv run --project /home/devuser/workspace/qgis-mcp src/qgis_mcp/server.py

Environment variables:
  QGIS_MCP_HOST  (default: localhost)
  QGIS_MCP_PORT  (default: 9877)
"""
import os
import subprocess
import sys

QGIS_MCP_REPO = "/home/devuser/workspace/qgis-mcp"

def ensure_repo():
    """Clone the qgis-mcp repo if not present."""
    if not os.path.isdir(QGIS_MCP_REPO):
        subprocess.check_call([
            "git", "clone", "--depth", "1",
            "https://github.com/nkarasiak/qgis-mcp",
            QGIS_MCP_REPO
        ])
        # Patch default port to 9877
        for fpath, old, new in [
            (os.path.join(QGIS_MCP_REPO, "qgis_mcp_plugin/plugin.py"),
             "_DEFAULT_PORT = 9876", "_DEFAULT_PORT = 9877"),
            (os.path.join(QGIS_MCP_REPO, "src/qgis_mcp/helpers.py"),
             "DEFAULT_PORT = 9876", "DEFAULT_PORT = 9877"),
        ]:
            with open(fpath, "r") as f:
                content = f.read()
            content = content.replace(old, new)
            with open(fpath, "w") as f:
                f.write(content)

def ensure_plugin_symlink():
    """Symlink the QGIS plugin if not already present."""
    plugin_dir = os.path.expanduser(
        "~/.local/share/QGIS/QGIS3/profiles/default/python/plugins/qgis_mcp_plugin"
    )
    if not os.path.exists(plugin_dir):
        os.makedirs(os.path.dirname(plugin_dir), exist_ok=True)
        os.symlink(
            os.path.join(QGIS_MCP_REPO, "qgis_mcp_plugin"),
            plugin_dir
        )
        print(f"[qgis-mcp] Symlinked plugin to {plugin_dir}", file=sys.stderr)

def main():
    ensure_repo()
    ensure_plugin_symlink()

    # Set default port via env if not already set
    os.environ.setdefault("QGIS_MCP_PORT", "9877")

    # Exec into the real server
    os.execvp("uv", [
        "uv", "run",
        "--project", QGIS_MCP_REPO,
        os.path.join(QGIS_MCP_REPO, "src/qgis_mcp/server.py")
    ])

if __name__ == "__main__":
    main()
