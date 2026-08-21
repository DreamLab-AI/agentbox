# PaperBanana Python API & MCP Integration

## Python API

```python
import asyncio
from paperbanana import PaperBananaPipeline, GenerationInput, DiagramType
from paperbanana.core.config import Settings

settings = Settings(vlm_provider="google", vlm_model="gemini-3.1-flash")
pipeline = PaperBananaPipeline(settings=settings)

result = asyncio.run(pipeline.generate(
    GenerationInput(
        source_context="Our framework uses a hierarchical mesh of agents...",
        communicative_intent="Architecture overview of the multi-agent system",
        diagram_type=DiagramType.METHODOLOGY,
    ),
    iterations=3,
    auto_refine=True,
    optimize_input=True,
))

# result.final_image is the generated image path
# result.evaluation contains critic scores
```

## MCP Server Integration

Add to Claude Code settings for IDE integration:

```json
{
  "mcpServers": {
    "paperbanana": {
      "command": "uvx",
      "args": ["--from", "paperbanana[mcp]", "paperbanana-mcp"],
      "env": {
        "GOOGLE_API_KEY": "your-gemini-key"
      }
    }
  }
}
```

**MCP Tools exposed:**
- `generate_diagram` — generate a methodology/architecture diagram
- `generate_plot` — generate a statistical plot from data
- `evaluate_diagram` — evaluate generated vs reference diagram
