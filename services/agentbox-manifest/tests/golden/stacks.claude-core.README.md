# claude-core

Provisioned stack profile for Agentbox.

Shared external projects mount: /projects
Shared workspace mount: /tmp/abm-golden-stacks-ws
Shared skills tree: /opt/agentbox/skills
Zellij layout: /tmp/abm-golden-stacks-ws/.config/zellij/layouts/claude-core.kdl
Agent URN: urn:agentbox:agent:claude-core

Tools:
- claude
- openai-codex
- codex-companion
- skill-router
- lazy-fetch

Recommended skills:
- skill-router
- lazy-fetch
- codebase-memory
- openai-codex
- codex-companion

Progressive disclosure index: /opt/agentbox/skills/SKILL-DIRECTORY.md
