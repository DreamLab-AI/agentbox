# Optimisation Recommendations & Operations

Automatic fixes applied by `--fix`, expected performance impact, continuous
monitoring / CI-CD integration, best practices, and troubleshooting recipes.

## Automatic Fixes (`--fix`)

When using `--fix`, the following optimizations may be applied:

**1. Topology Optimisation**
- Switch to more efficient topology (mesh → hierarchical)
- Adjust communication patterns
- Reduce coordination overhead
- Optimise message routing

**2. Caching Enhancement**
- Enable memory caching
- Optimise cache strategies
- Preload common patterns
- Implement cache warming

**3. Concurrency Tuning**
- Adjust agent counts
- Optimise parallel execution
- Balance workload distribution
- Implement load balancing

**4. Priority Adjustment**
- Reorder task queues
- Prioritize critical paths
- Reduce wait times
- Implement fair scheduling

**5. Resource Optimisation**
- Optimise memory usage
- Reduce I/O operations
- Batch API calls
- Implement connection pooling

## Performance Impact

Typical improvements after bottleneck resolution:

- **Communication**: 30-50% faster message delivery
- **Processing**: 20-40% reduced task completion time
- **Memory**: 40-60% fewer cache misses
- **Network**: 25-45% reduced API latency
- **Overall**: 25-45% total performance improvement

## Continuous Monitoring

```bash
# Monitor performance in real-time
npx claude-flow swarm monitor --interval 5

# Generate hourly reports
while true; do
  npx claude-flow analysis performance-report \
    --format json \
    --output logs/perf-$(date +%Y%m%d-%H%M).json
  sleep 3600
done
```

## CI/CD Integration

```yaml
# .github/workflows/performance.yml
name: Performance Analysis
on: [push, pull_request]

jobs:
  analyze:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Run Performance Analysis
        run: |
          npx claude-flow analysis performance-report \
            --format json \
            --output performance.json
      - name: Check Performance Thresholds
        run: |
          npx claude-flow bottleneck detect \
            --threshold 15 \
            --export bottlenecks.json
      - name: Upload Reports
        uses: actions/upload-artifact@v2
        with:
          name: performance-reports
          path: |
            performance.json
            bottlenecks.json
```

## Custom Analysis Scripts

```javascript
// scripts/analyze-performance.js
const { exec } = require('child_process');
const fs = require('fs');

async function analyzePerformance() {
  // Run bottleneck detection
  const bottlenecks = await runCommand(
    'npx claude-flow bottleneck detect --format json'
  );

  // Generate performance report
  const report = await runCommand(
    'npx claude-flow analysis performance-report --format json'
  );

  // Analyze results
  const analysis = {
    bottlenecks: JSON.parse(bottlenecks),
    performance: JSON.parse(report),
    timestamp: new Date().toISOString()
  };

  // Save combined analysis
  fs.writeFileSync(
    'analysis/combined-report.json',
    JSON.stringify(analysis, null, 2)
  );

  // Generate alerts if needed
  if (analysis.bottlenecks.critical.length > 0) {
    console.error('CRITICAL: Performance bottlenecks detected!');
    process.exit(1);
  }
}

function runCommand(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, (error, stdout, stderr) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}

analyzePerformance().catch(console.error);
```

## Best Practices

### 1. Regular Analysis
- Run bottleneck detection after major changes
- Generate weekly performance reports
- Monitor trends over time
- Set up automated alerts

### 2. Threshold Tuning
- Start with default threshold (20%)
- Lower for production systems (10-15%)
- Higher for development (25-30%)
- Adjust based on requirements

### 3. Fix Strategy
- Always review before applying --fix
- Test fixes in development first
- Apply fixes incrementally
- Monitor impact after changes

### 4. Report Integration
- Include in documentation
- Share with team regularly
- Track improvements over time
- Use for capacity planning

### 5. Continuous Optimisation
- Learn from each analysis
- Build performance budgets
- Establish baselines
- Set improvement goals

## Troubleshooting

**High Memory Usage**
```bash
# Analyze memory bottlenecks
npx claude-flow bottleneck detect --threshold 10

# Check cache performance
npx claude-flow cache manage --action stats

# Review memory metrics
npx claude-flow memory usage
```

**Slow Task Execution**
```bash
# Identify slow tasks
npx claude-flow task status --detailed

# Analyze coordination overhead
npx claude-flow bottleneck detect --time-range 1h

# Check agent utilization
npx claude-flow agent metrics
```

**Poor Cache Performance**
```bash
# Analyze cache hit rates
npx claude-flow analysis performance-report --sections metrics

# Review cache strategy
npx claude-flow cache manage --action analyze

# Enable cache warming
npx claude-flow bottleneck detect --fix
```

## Related Commands

- `npx claude-flow swarm monitor` - Real-time monitoring
- `npx claude-flow token usage` - Token optimisation analysis
- `npx claude-flow cache manage` - Cache optimisation
- `npx claude-flow agent metrics` - Agent performance metrics
- `npx claude-flow task status` - Task execution analysis

## Integration with Other Skills

- **swarm-orchestration**: Use performance data to optimise topology
- **memory-management**: Improve cache strategies based on analysis
- **task-coordination**: Adjust scheduling based on bottlenecks
- **neural-training**: Train patterns from performance data
