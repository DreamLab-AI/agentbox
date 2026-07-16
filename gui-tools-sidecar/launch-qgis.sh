#!/bin/bash
# Run the headless QGIS MCP server: QgsApplication + the qgis_mcp_plugin QgisMCPServer on
# its own Qt event loop under the offscreen Qt platform. This is the proven pattern (cf.
# the original qgis_mcp_standalone.py, CHANGELOG-QGIS.md): the full QGIS *desktop* does not
# initialise headlessly in this sidecar (no window manager; `--code` never runs), so we
# run the bindings directly. Supervised foreground process; supervisord autorestarts it.
# Binds ${QGIS_MCP_BIND:-0.0.0.0}:${QGIS_MCP_PORT:-9877} for the agentbox qgis-mcp proxy.
#
# Note: iface is None (no desktop), so canvas/render tools are unavailable; layer,
# feature, processing-algorithm and layout-export tools work. Bringing up the interactive
# QGIS desktop for VNC would additionally need a window manager on the Xvfb display.
set -uo pipefail
export QGIS_MCP_BIND="${QGIS_MCP_BIND:-0.0.0.0}"
export QGIS_MCP_PORT="${QGIS_MCP_PORT:-9877}"
export QT_QPA_PLATFORM="${QT_QPA_PLATFORM:-offscreen}"

exec python3 /opt/gui-tools/qgis-mcp-headless.py
