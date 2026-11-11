---
name: jupyter-notebooks
description: "Authors and runs Jupyter .ipynb notebooks with what the image has: NotebookEdit for cell edits, the code-interpreter MCP kernel (kernel_exec, kernel_inspect, kernel_list_vars) for live execution, and plain nbformat-4 JSON for new files. Use when building a notebook for data analysis, an ML pipeline or a tutorial and checking its cells run. Not for a one-off edit to a single open notebook (NotebookEdit alone), stateful Python without a notebook (codeact) or production code."
---

# Jupyter Notebooks

There is no notebook MCP server. Three things in the image do the work:

| Job | Tool |
|---|---|
| Add, replace, delete or reorder cells in an existing `.ipynb` | Claude Code `NotebookEdit` |
| Run code live and keep variables between calls | `code-interpreter` MCP: `kernel_exec`, `kernel_inspect`, `kernel_list_vars`, `kernel_reset`, `kernel_interrupt` |
| Create a new notebook file | Write the nbformat-4 JSON directly (below) |

## When Not To Use

- Production code that needs no exploration -- write files directly
- LaTeX typesetting -- use latex-documents or report-builder
- GPU kernel work -- use the cuda skill
- Stateful Python with no `.ipynb` -- use the codeact skill

## What the image has (and lacks)

`jupyter`, `ipykernel` and `jupyter_client` are baked. `nbformat`, `nbclient` and `nbconvert` are **not** importable, so there is no `jupyter nbconvert --execute` and no HTML/PDF export here. The image is immutable: if a package is missing, say so rather than installing it. Check first with `python3 -c "import nbformat"`.

## Workflow

1. **Create**: write the notebook as JSON. Minimal valid file:
```json
{"nbformat": 4, "nbformat_minor": 5,
 "metadata": {"kernelspec": {"name": "python3", "display_name": "Python 3", "language": "python"},
              "language_info": {"name": "python"}},
 "cells": [
  {"cell_type": "markdown", "id": "intro", "metadata": {}, "source": ["# Title"]},
  {"cell_type": "code", "id": "setup", "metadata": {}, "execution_count": null, "outputs": [],
   "source": ["import numpy as np"]}
 ]}
```
Each cell needs a unique `id` (nbformat 4.5); code cells need `outputs` and `execution_count`.
2. **Edit**: use `NotebookEdit` (insert, replace or delete by cell id).
3. **Try the cells**: run each code cell's source through `kernel_exec` in order, inspecting with `kernel_list_vars` / `kernel_inspect`. `kernel_reset` gives a clean "restart and run all".
4. **Outputs**: `kernel_exec` results are not written back to the file. Leave `outputs` empty (clean for version control) unless the operator wants them embedded, in which case paste results into the cell's `outputs` by hand.
5. **Export a script**: extract code cells with `python3 -c 'import json,sys; print("\n\n".join("".join(c["source"]) for c in json.load(open(sys.argv[1]))["cells"] if c["cell_type"]=="code"))' nb.ipynb`.

## Notebook structure for ML work

Setup/imports, data load, model definition, training loop, evaluation, save. For GPU: `device = torch.device("cuda" if torch.cuda.is_available() else "cpu")`; check torch is importable in the kernel first.

## Best practices

1. One task per cell; markdown cells for narrative.
2. Run all cells top to bottom after `kernel_reset` before handing over.
3. Keep outputs out of committed notebooks, especially anything sensitive.
4. Do not rely on hidden state: a cell must work when run in order.

## Related Skills

- **pytorch-ml** -- deep learning workflows
- **report-builder** -- plotting and report generation
- **cuda** -- GPU programming
