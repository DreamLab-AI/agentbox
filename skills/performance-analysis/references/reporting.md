# Performance Report Generation

Full reference for `claude-flow performance metrics` — formats, sections,
examples, and a sample rendered output. There is no `analysis` top-level
command or `performance-report` subcommand in the deployed CLI (verified:
`claude-flow analysis --help` → "Unknown command: analysis, did you mean
analyze?"; `claude-flow analyze --help` lists diff/code/deps/ast/complexity/
symbols/imports/boundaries/modules/dependencies/circular, none named
`performance-report`). Reporting in this build goes through `performance
metrics` and `performance benchmark`.

## Command Syntax

```bash
claude-flow performance metrics [options]
```

### Options (verified: `claude-flow performance metrics --help`)
- `-t, --timeframe <range>` - Timeframe: 1h, 24h, 7d, 30d (default: 24h)
- `-f, --format <type>` - Output format: text, json, prometheus (default: text)
- `-c, --component <name>` - Component to filter

There is no `--include-metrics`, `--compare`, `--output`, or `--sections` flag
on `metrics` in this build. For a full-scope benchmark run instead, see
`claude-flow performance benchmark` (options: `-s/--suite`, `-i/--iterations`,
`-w/--warmup`, `-o/--output` format).

## Report Sections

1. **Executive Summary**
   - Overall performance score
   - Key metrics overview
   - Critical findings

2. **Swarm Overview**
   - Topology configuration
   - Agent distribution
   - Task statistics

3. **Performance Metrics**
   - Execution times
   - Throughput analysis
   - Resource utilization
   - Latency breakdown

4. **Bottleneck Analysis**
   - Identified bottlenecks
   - Impact assessment
   - Optimisation priorities

5. **Comparative Analysis** (when --compare used)
   - Performance trends
   - Improvement metrics
   - Regression detection

6. **Recommendations**
   - Prioritized action items
   - Expected improvements
   - Implementation guidance

## Usage Examples

```bash
# Text metrics for the last 24h (default)
claude-flow performance metrics

# Weekly metrics, filtered to one component
claude-flow performance metrics -t 7d -c coordinator

# Prometheus format for scraping
claude-flow performance metrics -f prometheus

# JSON for CI/CD integration
claude-flow performance metrics -f json > build/performance.json

# Full benchmark suite (a different command — not filterable by timeframe)
claude-flow performance benchmark -s all -o json > build/benchmark.json
```

## Sample Markdown Output

```markdown
# Performance Analysis Report

## Executive Summary
- **Overall Score**: 87/100
- **Analysis Period**: Last 24 hours
- **Swarms Analyzed**: 3
- **Critical Issues**: 1

## Key Metrics
| Metric | Value | Trend | Target |
|--------|-------|-------|--------|
| Avg Task Time | 42s | ↓ 12% | 35s |
| Agent Utilization | 78% | ↑ 5% | 85% |
| Cache Hit Rate | 91% | → | 90% |
| Parallel Efficiency | 2.3x | ↑ 0.4x | 2.5x |

## Bottleneck Analysis
### Critical
1. **Agent Communication Delay** (Impact: 35%)
   - Coordinator → Coder messages delayed by 2.3s avg
   - **Fix**: Switch to hierarchical topology

### Warnings
1. **Memory Access Pattern** (Impact: 18%)
   - Neural pattern loading: 1.8s per access
   - **Fix**: Enable memory caching

## Recommendations
1. **High Priority**: Switch to hierarchical topology (40% improvement)
2. **Medium Priority**: Enable memory caching (25% improvement)
3. **Low Priority**: Increase agent concurrency to 8 (20% improvement)
```
