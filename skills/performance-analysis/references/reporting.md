# Performance Report Generation

Full reference for `claude-flow analysis performance-report` — formats, sections,
examples, and a sample rendered output.

## Command Syntax

```bash
npx claude-flow analysis performance-report [options]
```

### Options
- `--format <type>` - Report format: json, html, markdown (default: markdown)
- `--include-metrics` - Include detailed metrics and charts
- `--compare <id>` - Compare with previous swarm
- `--time-range <range>` - Analysis period: 1h, 24h, 7d, 30d, all
- `--output <file>` - Output file path
- `--sections <list>` - Comma-separated sections to include

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
# Generate HTML report with all metrics
npx claude-flow analysis performance-report --format html --include-metrics

# Compare current swarm with previous
npx claude-flow analysis performance-report --compare swarm-123 --format markdown

# Custom output with specific sections
npx claude-flow analysis performance-report \
  --sections summary,metrics,recommendations \
  --output reports/perf-analysis.html \
  --format html

# Weekly performance report
npx claude-flow analysis performance-report \
  --time-range 7d \
  --include-metrics \
  --format markdown \
  --output docs/weekly-performance.md

# JSON format for CI/CD integration
npx claude-flow analysis performance-report \
  --format json \
  --output build/performance.json
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
