---
name: pytorch-ml
description: "Train and fine-tune deep learning models in PyTorch with CUDA GPU acceleration — nn.Module definition, training loops, DataLoaders, checkpointing, mixed-precision (AMP), and transfer learning with torchvision/torchaudio pretrained models. Use when writing PyTorch model code, building a training loop or custom Dataset/DataLoader, moving tensors/models to a GPU device, fine-tuning a pretrained CNN/ResNet/Transformer, adding autocast/GradScaler mixed precision, or saving/loading checkpoints. Triggers: 'train a PyTorch model', 'nn.Module', 'DataLoader', '.to(device)', 'fine-tune ResNet', 'CUDA out of memory during training', 'mixed precision'. Not for custom CUDA kernels (cuda skill), Stable Diffusion/FLUX image generation (comfyui), notebook data exploration (jupyter-notebooks), or cloud-sandbox distributed training (flow-nexus-neural)."
---

# PyTorch ML Skill

Complete machine learning environment with PyTorch, CUDA, and the data science stack for deep learning research and production. Use it for building models, training loops, custom datasets, transfer learning, checkpointing, and mixed-precision GPU training.

## When Not To Use

- Custom CUDA kernel development and GPU profiling — use the **cuda** skill instead
- Distributed neural network training in cloud sandboxes — use **flow-nexus-neural** instead
- AgentDB reinforcement learning plugins — use **agentdb-advanced** (RL Plugins section) instead
- Interactive data exploration in notebooks — use **jupyter-notebooks** instead
- AI image generation (Stable Diffusion, FLUX) — use **comfyui** instead

## Quick start

```python
import torch
device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
print(f"Using device: {device}, CUDA {torch.version.cuda}, {torch.cuda.device_count()} GPU(s)")
```

Always move both model and data to the same device, batch with a `DataLoader`, and
enable `torch.backends.cudnn.benchmark = True` for fixed-shape workloads.

## References

Load the reference for the task at hand:

- [references/cookbook.md](references/cookbook.md) — core code: environment check, `nn.Module` definition, training loop, custom `Dataset`/`DataLoader`, pretrained-model fine-tuning, and checkpoint save/load.
- [references/mixed-precision-and-cuda.md](references/mixed-precision-and-cuda.md) — AMP mixed-precision training with the current `torch.amp` API, cache management, and GPU-properties introspection.
- [references/architectures.md](references/architectures.md) — ready-made module definitions: image CNN and Transformer encoder.
- [references/environment-and-best-practices.md](references/environment-and-best-practices.md) — installed packages, best-practice checklist, CUDA/multi-GPU environment notes, capability list, and related skills.
