# Mixed precision (AMP) and CUDA optimisation

## Mixed precision training

Uses the current `torch.amp` API (the older `torch.cuda.amp.autocast` /
`torch.cuda.amp.GradScaler` entry points are deprecated — pass `device_type` to
`torch.amp` instead).

```python
# Mixed precision training
from torch.amp import autocast, GradScaler

scaler = GradScaler("cuda")

for data, targets in train_loader:
    data, targets = data.to(device), targets.to(device)

    with autocast("cuda"):
        output = model(data)
        loss = criterion(output, targets)

    scaler.scale(loss).backward()
    scaler.step(optimizer)
    scaler.update()
    optimizer.zero_grad()

# Memory management
torch.cuda.empty_cache()
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
