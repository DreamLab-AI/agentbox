# Troubleshooting

### CUDA Not Found
```bash
# Check PATH includes CUDA bin
echo $PATH | grep cuda

# Should include: /opt/cuda/bin
```

### GPU Not Accessible
```bash
# Verify GPU passthrough in container
nvidia-smi

# Check PyTorch can see GPUs
python -c "import torch; print(torch.cuda.device_count())"
```

### Compilation Errors
```bash
# Use debugger agent
cuda_debug --file kernel.cu --verbose
```
