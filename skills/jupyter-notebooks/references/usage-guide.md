# Jupyter Notebooks — usage guide

Depth moved out of `../SKILL.md` to keep the entry file under the estate's 250-line
progressive-disclosure threshold. Read this when you need example workflows, error
handling behaviour, performance notes, technical details, or troubleshooting steps.

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
