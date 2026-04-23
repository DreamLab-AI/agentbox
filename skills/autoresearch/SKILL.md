---
name: autoresearch
description: >
  Autonomous experiment loop that tries ideas, measures results, keeps what works, and discards what doesn't.
  Use when the user asks to optimize a metric, run an experiment loop, improve performance iteratively,
  benchmark GPU kernels, or automate any measure-mutate-repeat workflow.
args: <idea or metric to optimize>
section: Research Workflows
triggers:
  - optimize
  - experiment loop
  - benchmark
  - improve performance
  - automate benchmarking
  - autoresearch
tools:
  - Bash
  - Read
  - Write
  - Edit
  - Agent
  - Grep
  - Glob
memory:
  before: mcp__claude-flow__memory_search({query: "[topic] optimization experiments", namespace: "patterns", limit: 5})
  after: mcp__claude-flow__memory_store({namespace: "patterns", key: "autoresearch-[slug]", value: "[what worked, final metric]"})
---

# Autoresearch: Autonomous Experiment Loop

Adapted from Feynman's autoresearch methodology for Claude Code + RuVector memory.

## Step 1: Gather Context

If resuming, search RuVector memory first:
```javascript
mcp__claude-flow__memory_search({query: "[topic] autoresearch experiments", namespace: "patterns", limit: 10})
```

If starting fresh, collect from the user:
- **Metric**: What to optimize (latency, throughput, bundle size, GPU kernel time, accuracy, etc.)
- **Benchmark command**: The shell command that produces the metric
- **Direction**: Lower or higher is better
- **Files in scope**: Which source files can be modified
- **Max iterations**: Default 20
- **Environment**: Local working directory (default), git worktree branch, or Docker

## Step 2: Confirm Plan

Present the plan and get explicit approval before starting:

```
Optimization target: [metric] ([direction])
Benchmark command:   [command]
Files in scope:      [files]
Environment:         [environment]
Max iterations:      [N]
```

## Step 3: Baseline

Run the benchmark command once to establish baseline:
```bash
# Record baseline
time [benchmark_command] 2>&1 | tee /tmp/autoresearch-baseline.txt
```

Log baseline to experiment journal:
```bash
echo "$(date -Iseconds) | baseline | [metric_value] | [unit] | initial state" >> outputs/autoresearch.jsonl
```

## Step 4: Experiment Loop

For each iteration (1 to max_iterations):

1. **Hypothesize**: Based on prior results, identify the most promising change
2. **Implement**: Edit the files in scope (use Edit tool, keep changes minimal and reversible)
3. **Measure**: Run the benchmark command
4. **Log**: Record the result
   ```bash
   echo "$(date -Iseconds) | iter_[N] | [metric_value] | [unit] | [description of change]" >> outputs/autoresearch.jsonl
   ```
5. **Decide**:
   - If metric improved: **KEEP** the change, commit with `git commit -m "autoresearch: [change] ([metric improvement])"`
   - If metric regressed or unchanged: **REVERT** with `git checkout -- [files]`
6. **Learn**: Store successful patterns in RuVector:
   ```javascript
   mcp__claude-flow__memory_store({namespace: "patterns", key: "autoresearch-[slug]-iter[N]", value: "[what worked/failed]"})
   ```

## Step 5: Convergence

Stop when:
- Max iterations reached
- 3 consecutive iterations with < 1% improvement
- User interrupts

## Step 6: Report

Write final report to `outputs/autoresearch-[slug]-report.md`:
```markdown
# Autoresearch Report: [topic]

## Result
- Baseline: [value] [unit]
- Final: [value] [unit]
- Improvement: [percentage]
- Iterations: [N] ([kept] kept, [reverted] reverted)

## What Worked
1. [change] → [improvement]

## What Didn't Work
1. [change] → [regression or no effect]

## Experiment Log
[table from autoresearch.jsonl]
```

Store final result in memory:
```javascript
mcp__claude-flow__memory_store({namespace: "patterns", key: "autoresearch-[slug]-final", value: "[summary of what worked, final metric, key learnings]"})
```

## Subcommands
- `/autoresearch <topic>` — start or resume the loop
- `/autoresearch status` — show current iteration and best result
- `/autoresearch stop` — stop the loop, keep data

## Integration with GPU Pipeline
When optimizing GPU kernels, use:
- `nvidia-smi` for GPU utilization and memory monitoring
- CUDA event timing via the benchmark command
- `cargo bench` or custom benchmark binaries
- Kernel launch parameter sweeps (block size, grid size)
