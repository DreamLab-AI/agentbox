---
name: PyTorch ML
description: Deep learning with PyTorch - model training, GPU acceleration, and data science workflows
---

# PyTorch ML Skill

Complete machine learning environment with PyTorch, CUDA, and data science stack for deep learning research and production.

## Capabilities

- Neural network definition and training
- CUDA GPU acceleration
- Data loading and preprocessing
- Model checkpointing and inference
- TensorBoard visualization
- Distributed training support
- Integration with NumPy, Pandas, scikit-learn
- Pretrained models (torchvision, torchtext, torchaudio)

## When to Use

- Deep learning model development
- Computer vision tasks
- Natural language processing
- Audio processing
- Transfer learning
- Research experiments
- Production model deployment

## When Not To Use

- For custom CUDA kernel development and GPU profiling -- use the cuda skill instead
- For distributed neural network training in cloud sandboxes -- use the flow-nexus-neural skill instead
- For AgentDB reinforcement learning plugins (Q-Learning, Decision Transformer) -- use the agentdb-learning skill instead
- For interactive data exploration in notebooks -- use the jupyter-notebooks skill instead
- For AI image generation (Stable Diffusion, FLUX) -- use the comfyui skill instead

## Environment

```python
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import DataLoader
import torchvision.models as models

# Check GPU
device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
print(f"Using device: {device}")
print(f"CUDA version: {torch.version.cuda}")
print(f"GPU count: {torch.cuda.device_count()}")
```

## Model Definition

```python
class SimpleNN(nn.Module):
    def __init__(self, input_size, hidden_size, num_classes):
        super(SimpleNN, self).__init__()
        self.fc1 = nn.Linear(input_size, hidden_size)
        self.relu = nn.ReLU()
        self.fc2 = nn.Linear(hidden_size, num_classes)

    def forward(self, x):
        out = self.fc1(x)
        out = self.relu(out)
        out = self.fc2(out)
        return out

model = SimpleNN(784, 256, 10).to(device)
```

## Training Loop

```python
criterion = nn.CrossEntropyLoss()
optimizer = optim.Adam(model.parameters(), lr=0.001)

for epoch in range(num_epochs):
    for batch_idx, (data, targets) in enumerate(train_loader):
        data = data.to(device)
        targets = targets.to(device)

        # Forward pass
        scores = model(data)
        loss = criterion(scores, targets)

        # Backward pass
        optimizer.zero_grad()
        loss.backward()
        optimizer.step()

        if batch_idx % 100 == 0:
            print(f'Epoch [{epoch}/{num_epochs}] '
                  f'Loss: {loss.item():.4f}')
```

## Data Loading

```python
from torch.utils.data import Dataset, DataLoader
import torchvision.transforms as transforms

# Custom dataset
class CustomDataset(Dataset):
    def __init__(self, data, labels):
        self.data = data
        self.labels = labels

    def __len__(self):
        return len(self.data)

    def __getitem__(self, idx):
        return self.data[idx], self.labels[idx]

# DataLoader
dataset = CustomDataset(train_data, train_labels)
loader = DataLoader(dataset, batch_size=64, shuffle=True, num_workers=4)
```

## Pretrained Models

```python
# Load pretrained ResNet
model = models.resnet50(pretrained=True)

# Fine-tune last layer
num_features = model.fc.in_features
model.fc = nn.Linear(num_features, num_classes)
model = model.to(device)

# Freeze early layers
for param in model.parameters():
    param.requires_grad = False
for param in model.fc.parameters():
    param.requires_grad = True
```

## Model Saving/Loading

```python
# Save checkpoint
torch.save({
    'epoch': epoch,
    'model_state_dict': model.state_dict(),
    'optimizer_state_dict': optimizer.state_dict(),
    'loss': loss,
}, 'checkpoint.pth')

# Load checkpoint
checkpoint = torch.load('checkpoint.pth')
model.load_state_dict(checkpoint['model_state_dict'])
optimizer.load_state_dict(checkpoint['optimizer_state_dict'])
epoch = checkpoint['epoch']
loss = checkpoint['loss']
```

## CUDA Optimisation

```python
# Mixed precision training
from torch.cuda.amp import autocast, GradScaler

scaler = GradScaler()

for data, targets in train_loader:
    data, targets = data.to(device), targets.to(device)

    with autocast():
        output = model(data)
        loss = criterion(output, targets)

    scaler.scale(loss).backward()
    scaler.step(optimizer)
    scaler.update()
    optimizer.zero_grad()

# Memory management
torch.cuda.empty_cache()
```

## Common Architectures

### CNN for Images
```python
class CNN(nn.Module):
    def __init__(self):
        super(CNN, self).__init__()
        self.conv1 = nn.Conv2d(3, 32, 3, padding=1)
        self.conv2 = nn.Conv2d(32, 64, 3, padding=1)
        self.pool = nn.MaxPool2d(2, 2)
        self.fc1 = nn.Linear(64 * 8 * 8, 512)
        self.fc2 = nn.Linear(512, 10)
        self.dropout = nn.Dropout(0.5)

    def forward(self, x):
        x = self.pool(torch.relu(self.conv1(x)))
        x = self.pool(torch.relu(self.conv2(x)))
        x = x.view(-1, 64 * 8 * 8)
        x = torch.relu(self.fc1(x))
        x = self.dropout(x)
        x = self.fc2(x)
        return x
```

### Transformer
```python
encoder_layer = nn.TransformerEncoderLayer(d_model=512, nhead=8)
transformer_encoder = nn.TransformerEncoder(encoder_layer, num_layers=6)
```

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

## GPU Info

```python
# Get GPU properties
if torch.cuda.is_available():
    props = torch.cuda.get_device_properties(0)
    print(f"GPU: {props.name}")
    print(f"Memory: {props.total_memory / 1024**3:.2f} GB")
    print(f"Compute Capability: {props.major}.{props.minor}")
```

## Related Skills

- jupyter-notebooks - Interactive ML development
- cuda - Custom CUDA kernels
- report-builder - Plot training metrics

## Best Practices

1. Always move model and data to same device
2. Use DataLoader for efficient batching
3. Enable cudnn benchmarking: `torch.backends.cudnn.benchmark = True`
4. Clear CUDA cache periodically
5. Use gradient checkpointing for large models
6. Profile with `torch.profiler` for optimisation

## Notes

- CUDA 12+ installed with cuDNN
- PyTorch built with CUDA support
- Mixed precision training available (FP16)
- Multi-GPU via DataParallel or DistributedDataParallel
