---
name: Jupyter Notebooks
description: Comprehensive Jupyter notebook operations - create, execute, and analyze notebooks with full cell manipulation
version: 1.0.0
mcp_server: true
protocol: mcp-sdk
entry_point: server.js
---

# Jupyter Notebooks Skill

> **KNOWN LIMITATION**: The current implementation executes each cell in a **fresh Python process**. Variables and state do NOT persist between cells. This is suitable for independent code snippets but NOT for traditional notebook workflows where cells share state. For complex data science workflows requiring kernel persistence, consider using JupyterLab directly.

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

1. **Cell Organization**: Keep cells focused on single tasks
2. **Markdown Documentation**: Use markdown cells for explanations
3. **Restart & Run All**: Test full execution before sharing
4. **Version Control**: Use nbdime for notebook diffs
5. **Clear Outputs**: Clear sensitive data before committing
6. **Kernel Management**: Restart kernel when imports change

## Example Workflows

### Data Science Pipeline
1. Create notebook with data exploration cells
2. Execute EDA (exploratory data analysis)
3. Add visualization cells
4. Run statistical analysis
5. Export results to HTML report

### Machine Learning Experiment
1. Set up experiment notebook
2. Load training data
3. Define model architecture
4. Train with progress tracking
5. Evaluate on test set
6. Save model and metrics

### Research Documentation
1. Create markdown cells for methodology
2. Add code cells for implementations
3. Include result visualizations
4. Export to PDF for publication

## Error Handling

The skill provides detailed error messages for:
- Kernel execution failures
- Cell syntax errors
- Missing dependencies
- File I/O errors
- nbformat validation issues

## Performance Considerations

- Notebooks execute in isolated kernels
- CUDA operations utilize GPU when available
- Large datasets may require memory management
- Long-running cells can be interrupted
- Output size limits may apply

## Related Skills

- **pytorch-ml** - Deep learning workflows
- **latex-documents** - Scientific paper generation
- **data-visualization** - Advanced plotting
- **cuda-development** - GPU programming

## Technical Details

- **Protocol**: Model Context Protocol (MCP) over stdio
- **Server**: Node.js-based MCP server
- **Format**: nbformat 4.x JSON schema
- **Kernel**: IPython kernel with Python 3.x
- **Extensions**: JupyterLab extensions supported

## Troubleshooting

### Kernel Not Starting
- Check `/opt/venv/bin/python` exists
- Verify ipykernel installed
- Check kernel specifications: `jupyter kernelspec list`

### Import Errors
- Activate virtual environment: `source /opt/venv/bin/activate`
- Install missing packages: `pip install <package>`
- Verify CUDA installation for GPU packages

### Cell Execution Hangs
- Interrupt kernel execution
- Restart kernel
- Check for infinite loops or blocking operations

## Configuration

MCP server configuration in `~/.claude/settings.json`:
```json
{
  "mcpServers": {
    "jupyter-notebooks": {
      "command": "node",
      "args": ["/home/devuser/.claude/skills/jupyter-notebooks/server.js"],
      "cwd": "/home/devuser/.claude/skills/jupyter-notebooks"
    }
  }
}
```

## Notes

- Compatible with Claude Code and other MCP clients
- Supports both JupyterLab and classic Notebook interfaces
- Full compatibility with existing .ipynb files
- Execution state preserved across sessions
- Output includes rich media (images, HTML, LaTeX)
