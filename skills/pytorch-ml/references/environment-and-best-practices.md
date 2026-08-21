# Environment, installed packages and best practices

## Installed Packages

```python
# Core ML
import torch, torchvision, torchaudio
import numpy as np
import pandas as pd
import scipy
import sklearn

# Visualization
import matplotlib.pyplot as plt
import seaborn as sns

# Jupyter integration
from IPython.display import display
```

## Best Practices

1. Always move model and data to same device
2. Use DataLoader for efficient batching
3. Enable cudnn benchmarking: `torch.backends.cudnn.benchmark = True`
4. Clear CUDA cache periodically
5. Use gradient checkpointing for large models
6. Profile with `torch.profiler` for optimisation

## Environment notes

- CUDA 12+ installed with cuDNN
- PyTorch built with CUDA support
- Mixed precision training available (FP16)
- Multi-GPU via DataParallel or DistributedDataParallel

## Capabilities

- Neural network definition and training
- CUDA GPU acceleration
- Data loading and preprocessing
- Model checkpointing and inference
- TensorBoard visualization
- Distributed training support
- Integration with NumPy, Pandas, scikit-learn
- Pretrained models (torchvision, torchtext, torchaudio)

## When to use (task types)

- Deep learning model development
- Computer vision tasks
- Natural language processing
- Audio processing
- Transfer learning
- Research experiments
- Production model deployment

## Related skills

- jupyter-notebooks - Interactive ML development
- cuda - Custom CUDA kernels
- report-builder - Plot training metrics
