---
name: jupyter-notebooks
description: "Programmatically build and run Jupyter .ipynb notebooks end-to-end via the jupyter-notebooks MCP server — add/delete/move/update cells, execute cells or whole notebooks, manage kernel state, capture outputs, and export to HTML/PDF/Python. Use when authoring or executing a notebook from Claude (data-analysis or ML pipelines, reproducible research docs, tutorial/educational notebooks), driving cell and kernel operations, or converting a .ipynb to another format. Not for one-off edits to a single already-open notebook (use NotebookEdit) or non-interactive production code."
---

# Jupyter Notebooks Skill

This skill provides complete Jupyter notebook interaction capabilities through MCP server integration, enabling notebook-based data science and research workflows.

## Capabilities

- Create and manage Jupyter notebooks (.ipynb files)
- Execute cells and entire notebooks
- Read and write cell content (code and markdown)
- Access cell outputs and execution results
- Manipulate notebook structure (add, delete, move cells)
- Cell-level operations with execution state tracking
- Support for JupyterLab and Jupyter Notebook interfaces
- Integration with Python data science stack (NumPy, Pandas, PyTorch, etc.)

## When to Use This Skill

Use this skill when you need to:
- Create interactive computational notebooks
- Run data analysis workflows
- Execute machine learning experiments
- Generate reproducible research documents
- Visualize data with matplotlib/seaborn
- Prototype code interactively
- Create tutorial or educational notebooks
- Document analysis procedures with code + narrative

## When Not To Use

- For production code implementation that does not need interactive exploration -- write files directly with Claude Code
- For LaTeX document preparation and professional typesetting -- use the latex-documents or report-builder skills instead
- For GPU kernel development and CUDA programming -- use the cuda skill instead
- For deploying trained models to production -- use the pytorch-ml or flow-nexus-neural skills instead
- For non-Python data processing pipelines -- use the stream-chain skill or appropriate language-specific tooling
- For stateful Python execution without notebook structure (no .ipynb, no cell-by-cell narrative) -- use the codeact skill instead

## Prerequisites

- Jupyter notebooks installed (`jupyter` and `jupyterlab` available in /opt/venv)
- MCP server running on stdio
- Python virtual environment at /opt/venv with data science packages

## Available Operations

### Notebook Management
- `create_notebook` - Create new notebook with optional cells
- `list_notebooks` - List all notebooks in directory
- `get_notebook_info` - Get metadata and structure info
- `delete_notebook` - Remove notebook file

### Cell Operations
- `add_cell` - Add code or markdown cell at position
- `delete_cell` - Remove cell by index
- `move_cell` - Reorder cells
- `get_cell` - Read cell content and metadata
- `update_cell` - Modify cell content

### Execution
- `execute_cell` - Run specific cell and capture output
- `execute_notebook` - Run entire notebook sequentially
- `clear_outputs` - Clear all cell outputs
- `restart_kernel` - Restart notebook kernel

### Content Access
- `get_all_cells` - Read all cells in notebook
- `get_output` - Access cell execution results
- `export_notebook` - Convert to HTML, PDF, or Python script

## Instructions

### Creating a New Notebook

To create a notebook for data analysis:
1. Use `create_notebook` with file path
2. Optionally provide initial cells (imports, setup)
3. Notebook created with nbformat 4.x schema

Example cells structure:
```python
[
  {
    "cell_type": "code",
    "source": "import numpy as np\nimport pandas as pd\nimport matplotlib.pyplot as plt"
  },
  {
    "cell_type": "markdown",
    "source": "# Data Analysis\n\nThis notebook analyzes..."
  }
]
```

### Executing Notebooks

For data processing pipelines:
1. Use `execute_notebook` for full run
2. Or `execute_cell` for incremental execution
3. Outputs captured with display data, errors, and execution counts

### PyTorch/ML Workflow

Typical machine learning notebook structure:
1. **Setup cell**: Import torch, torchvision, datasets
2. **Data cell**: Load and preprocess data
3. **Model cell**: Define neural network architecture
4. **Training cell**: Training loop with loss tracking
5. **Evaluation cell**: Test metrics and visualizations
6. **Export cell**: Save model weights

### Integration with CUDA

For GPU-accelerated computing:
```python
import torch
device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
model = MyModel().to(device)
```

The skill automatically detects CUDA availability and uses GPU when present.

## Environment Variables

- `JUPYTER_CONFIG_DIR` - Jupyter configuration directory
- `JUPYTER_DATA_DIR` - Data files location
- `JUPYTER_RUNTIME_DIR` - Runtime files (kernels, etc.)

## Output Formats

Notebooks can be exported to:
- **HTML** - Static web page with outputs
- **PDF** - Via LaTeX (requires texlive installation)
- **Python** - Pure Python script (.py file)
- **Markdown** - Documentation format
- **Slides** - Reveal.js presentation

## Best Practices

1. **Cell Organisation**: Keep cells focused on single tasks
2. **Markdown Documentation**: Use markdown cells for explanations
3. **Restart & Run All**: Test full execution before sharing
4. **Version Control**: Use nbdime for notebook diffs
5. **Clear Outputs**: Clear sensitive data before committing
6. **Kernel Management**: Restart kernel when imports change

## Related Skills

- **pytorch-ml** - Deep learning workflows
- **latex-documents** - Scientific paper generation
- **report-builder** - Advanced plotting and report generation
- **cuda** - GPU programming

For example workflows, error handling, performance notes, technical details, and
troubleshooting, see [references/usage-guide.md](references/usage-guide.md).

## Configuration (manual setup — not wired into the boot path)

This skill's `server.js` is **not** registered in `skills/mcp.json` (the canonical
boot-projection source) or in `config/entrypoint-unified.sh`, and its `node_modules`
are not installed by default. Nothing auto-provisions this MCP server on container
start — treat everything below as a one-off manual setup, not a working-out-of-the-box
integration.

To use it, from the skill directory: `npm install`, then register it yourself.

Claude Code — add to `~/.claude/settings.json`:
```json
{
  "mcpServers": {
    "jupyter-notebooks": {
      "command": "node",
      "args": ["<skill-dir>/jupyter-notebooks/server.js"],
      "cwd": "<skill-dir>/jupyter-notebooks"
    }
  }
}
```
Replace `<skill-dir>` with wherever this skill is checked out (skill-relative — never
hard-code an absolute path under the user's home `.claude/skills` directory).

Codex / GPT-6 Astra — add an equivalent stdio server entry under `~/.codex/config.toml`.

## Notes

- Compatible with Claude Code and other MCP clients once manually registered
- Supports both JupyterLab and classic Notebook interfaces
- Full compatibility with existing .ipynb files
- Execution state preserved across sessions
- Output includes rich media (images, HTML, LaTeX)
