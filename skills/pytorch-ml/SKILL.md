---
name: pytorch-ml
description: "Trains and fine-tunes PyTorch models on CUDA GPUs: nn.Module design, training loops, Dataset and DataLoader, AMP mixed precision, checkpointing, transfer learning from torchvision. Use for 'train a PyTorch model', '.to(device)', 'fine-tune ResNet', 'CUDA out of memory during training' or adding autocast and GradScaler. Not for custom CUDA kernels (cuda), Stable Diffusion or FLUX generation (comfyui), notebook exploration (jupyter-notebooks) or AgentDB RL plugins (agentdb-advanced)."
---

# PyTorch ML Skill

Complete machine learning environment with PyTorch, CUDA, and the data science stack for deep learning research and production. Use it for building models, training loops, custom datasets, transfer learning, checkpointing, and mixed-precision GPU training.

## When Not To Use

- Custom CUDA kernel development and GPU profiling — use the **cuda** skill instead
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
