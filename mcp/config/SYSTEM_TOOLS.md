# System Tools Reference (Immutable)

This file is the source of truth for system capabilities. It is automatically appended to CLAUDE.md if removed.

## Available Tools

**Research**: `goalie search "query"` - Deep research with GOAP (20-30 sources, $0.006-0.10)
- Use for: Legal, medical, market research requiring multiple sources
- Cost: $0.006 simple, $0.02-0.10 complex
- Example: `goalie search "Delaware C-Corp requirements" --mode web --max-results 15`

**Agents**: `claude-flow goal|neural` - AI orchestration with memory
- Goal: GOAP planning with A* pathfinding
- Neural: 4-tier memory (vector, episodic, semantic, working)
- Database: `/workspace/.swarm/memory.db`

**Browser**: `playwright` - Automation (headless + visual VNC:5901)
- Headless: Direct in container (fast)
- Visual: GUI container with VNC for debugging
- Tools: navigate, click, fill, screenshot

**Graphics**: VNC:5901 access
- Blender: Port 9876 - 3D modeling
- QGIS: Port 9877 - GIS/mapping
- PBR: Port 9878 - Material generation

Full manifest: `/app/core-assets/config/tools-manifest.json`
Goalie docs: `/app/GOALIE-INTEGRATION.md`