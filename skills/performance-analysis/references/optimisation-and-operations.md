# Optimisation Recommendations & Operations

Automatic fixes applied by `claude-flow performance optimize --apply`,
expected performance impact, continuous monitoring / CI-CD integration, best
practices, and troubleshooting recipes.

## Automatic Fixes (`performance optimize --apply`)

Verified against `claude-flow performance optimize --help` (options: `-t/
--target memory|cpu|latency|all`, `-a/--apply`, `-d/--dry-run`) — there is no
`--fix` flag on `bottleneck`; optimisation is its own command:

```bash
# Preview optimisations without applying
claude-flow performance optimize --dry-run

# Apply all recommended optimisations
claude-flow performance optimize --apply

# Target one area
claude-flow performance optimize -t memory --apply
```

The following optimizations may be applied:

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

There is no `swarm monitor` subcommand (verified: `claude-flow swarm --help`
lists init/start/status/stop/scale/coordinate/compress-message/pheromone/join
only). Poll `performance metrics` on an interval instead:

```bash
# Poll metrics every 5 seconds (no built-in --interval flag; loop it yourself)
while true; do
  claude-flow performance metrics -f json
  sleep 5
done

# Generate hourly metrics snapshots
while true; do
  claude-flow performance metrics -f json > "logs/perf-$(date +%Y%m%d-%H%M).json"
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
          claude-flow performance metrics -f json > performance.json
      - name: Check Performance Thresholds
        run: |
          # No `--format` flag on `bottleneck` (text output only); capture as text
          claude-flow performance bottleneck -d full > bottlenecks.txt
      - name: Upload Reports
        uses: actions/upload-artifact@v2
        with:
          name: performance-reports
          path: |
            performance.json
            bottlenecks.txt
```

## Custom Analysis Scripts

```javascript
// scripts/analyze-performance.js
const { exec } = require('child_process');
const fs = require('fs');

async function analyzePerformance() {
  // Run bottleneck detection (there is no --format flag on `bottleneck`;
  // it always prints its report, so parse text or use the MCP tool for JSON)
  const bottlenecks = await runCommand(
    'claude-flow performance bottleneck -d full'
  );

  // Fetch metrics as JSON (there is no `analysis performance-report`)
  const report = await runCommand(
    'claude-flow performance metrics -f json'
  );

  // bottlenecks is plain text (no --format flag exists); keep it as-is rather
  // than JSON.parse-ing it. Use the MCP tool (mcp__claude-flow__bottleneck_analyze)
  // instead of this script if you need a structured result.
  const analysis = {
    bottlenecksReport: bottlenecks,
    performance: JSON.parse(report),
    timestamp: new Date().toISOString()
  };

  // Save combined analysis
  fs.writeFileSync(
    'analysis/combined-report.json',
    JSON.stringify(analysis, null, 2)
  );

  // Generate alerts if needed (text heuristic, since the CLI output isn't structured)
  if (/critical/i.test(bottlenecks)) {
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

There is no top-level `token` or `cache` command in this build (verified:
`claude-flow token --help` and `claude-flow cache --help` both →
"Unknown command"). Use `performance metrics`/`memory stats` instead.

**High Memory Usage**
```bash
# Analyze memory-related bottlenecks
claude-flow performance bottleneck -c memory -d full

# Review memory metrics (no `cache manage`; use memory stats)
claude-flow memory stats
```

**Slow Task Execution**
```bash
# Identify slow tasks
claude-flow task list --all

# Analyze coordination overhead
claude-flow performance bottleneck -c coordinator -d full

# Check agent utilization
claude-flow agent metrics
```

**Poor Cache Performance**
```bash
# Review metrics (no `analysis performance-report --sections`; filter by component)
claude-flow performance metrics -c cache

# Review embedding cache specifically (a different subsystem — see `embeddings --help`)
claude-flow embeddings cache

# Apply recommended optimisations, including caching
claude-flow performance optimize --apply
```

## Related Commands

Verified against `claude-flow --help` (ruflo v3.38.21):
- `claude-flow performance metrics` - Real-time and historical metrics (no `swarm monitor` exists)
- `claude-flow performance benchmark` - Benchmark suites (wasm/neural/memory/search)
- `claude-flow agent metrics` - Agent performance metrics
- `claude-flow task list` / `task status <id>` - Task execution analysis
- `claude-flow memory stats` - Memory backend statistics (no top-level `cache` or `token` command exists)

## Integration with Other Skills

- **swarm-orchestration**: Use performance data to optimise topology
- **memory-management**: Improve cache strategies based on analysis
- **task-coordination**: Adjust scheduling based on bottlenecks
- **neural-training**: Train patterns from performance data
