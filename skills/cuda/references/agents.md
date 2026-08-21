# Specialist Agents

The CUDA skill routes work to 4 AI specialist agents: General, Optimizer, Debugger, Analyzer.

### 1. General Assistant
**When to use**: General CUDA questions, kernel creation, learning

```bash
# Example: Create basic kernel
cuda_general "Create a parallel reduction kernel for sum"
```

### 2. Optimizer Agent
**When to use**: Performance optimisation, memory coalescing, shared memory

```bash
# Example: Optimize existing kernel
cuda_optimize --file kernel.cu --target-gpu rtx4090
```

### 3. Debugger Agent
**When to use**: Fix compilation errors, race conditions, memory issues

```bash
# Example: Debug kernel
cuda_debug --file buggy_kernel.cu --error "incorrect results for large arrays"
```

### 4. Analyzer Agent
**When to use**: Code review, best practices, complexity analysis

```bash
# Example: Analyze kernel quality
cuda_analyze --file my_kernel.cu --report-format markdown
```
