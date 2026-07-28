# Agentic Jujutsu — API Reference & Operations

Full method catalog, validation rules, performance data, RuVector storage
details, and troubleshooting. See `cookbook.md` for worked examples.

## RuVector PostgreSQL (Learning Memory)

ReasoningBank patterns are stored in centralized PostgreSQL:

```bash
# Connection (auto-configured via RUVECTOR_PG_CONNINFO)
host=ruvector-postgres port=5432 user=ruvector database=ruvector

# Agentic-jujutsu data tables:
# - sona_trajectories: Self-learning trajectory storage
# - reasoning_patterns: Conflict resolution patterns
# - memory_entries: Agent coordination state

# Check learning patterns
PGPASSWORD=ruvector_secure_pass psql -h ruvector-postgres -U ruvector -d ruvector \
  -c "SELECT COUNT(*) FROM sona_trajectories"
```

Pattern retrieval uses pgvector HNSW indexing (~150x faster than a sequential
scan of the trajectory store).

## API Reference

### Core Methods

| Method | Description | Returns |
|--------|-------------|---------|
| `new JjWrapper()` | Create wrapper instance | JjWrapper |
| `status()` | Get repository status | Promise<JjResult> |
| `newCommit(msg)` | Create new commit | Promise<JjResult> |
| `log(limit)` | Show commit history | Promise<JjCommit[]> |
| `diff(from, to)` | Show differences | Promise<JjDiff> |
| `branchCreate(name, rev?)` | Create branch | Promise<JjResult> |
| `rebase(source, dest)` | Rebase commits | Promise<JjResult> |

### ReasoningBank Methods

| Method | Description | Returns |
|--------|-------------|---------|
| `startTrajectory(task)` | Begin learning trajectory | string (trajectory ID) |
| `addToTrajectory()` | Add recent operations | void |
| `finalizeTrajectory(score, critique?)` | Complete trajectory (score: 0.0-1.0) | void |
| `getSuggestion(task)` | Get AI recommendation | JSON: DecisionSuggestion |
| `getLearningStats()` | Get learning metrics | JSON: LearningStats |
| `getPatterns()` | Get discovered patterns | JSON: Pattern[] |
| `queryTrajectories(task, limit)` | Find similar trajectories | JSON: Trajectory[] |
| `resetLearning()` | Clear learned data | void |

### AgentDB Methods

| Method | Description | Returns |
|--------|-------------|---------|
| `getStats()` | Get operation statistics | JSON: Stats |
| `getOperations(limit)` | Get recent operations | JjOperation[] |
| `getUserOperations(limit)` | Get user operations only | JjOperation[] |
| `clearLog()` | Clear operation log | void |

### Quantum Security Methods (v2.3.0+)

| Method | Description | Returns |
|--------|-------------|---------|
| `generateQuantumFingerprint(data)` | Generate SHA3-512 fingerprint | Buffer (64 bytes) |
| `verifyQuantumFingerprint(data, fp)` | Verify fingerprint | boolean |
| `enableEncryption(key, pubKey?)` | Enable HQC-128 encryption | void |
| `disableEncryption()` | Disable encryption | void |
| `isEncryptionEnabled()` | Check encryption status | boolean |

## Performance Characteristics

| Metric | Git | Agentic Jujutsu |
|--------|-----|-----------------|
| Concurrent commits | 15 ops/s | 350 ops/s (23x) |
| Context switching | 500-1000ms | 50-100ms (10x) |
| Conflict resolution | 30-40% auto | 87% auto (2.5x) |
| Lock waiting | 50 min/day | 0 min (∞) |
| Quantum fingerprints | N/A | <1ms |

## Validation Rules (v2.3.1+)

### Task Description
- ✅ Cannot be empty or whitespace-only
- ✅ Maximum length: 10,000 bytes
- ✅ Automatically trimmed

### Success Score
- ✅ Must be finite (not NaN or Infinity)
- ✅ Must be between 0.0 and 1.0 (inclusive)

### Operations
- ✅ Must have at least one operation before finalizing

### Context
- ✅ Cannot be empty
- ✅ Keys cannot be empty or whitespace-only
- ✅ Keys max 1,000 bytes, values max 10,000 bytes

## Troubleshooting

### Issue: Low Confidence Suggestions

```javascript
const suggestion = JSON.parse(jj.getSuggestion('new task'));

if (suggestion.confidence < 0.5) {
    // Not enough data - check learning stats
    const stats = JSON.parse(jj.getLearningStats());
    console.log(`Need more data. Current trajectories: ${stats.totalTrajectories}`);
    
    // Recommend: Record 5-10 trajectories first
}
```

### Issue: Validation Errors

```javascript
try {
    jj.startTrajectory(''); // Empty task
} catch (err) {
    if (err.message.includes('Validation error')) {
        console.log('Invalid input:', err.message);
        // Use non-empty, meaningful task description
    }
}

try {
    jj.finalizeTrajectory(1.5); // Score > 1.0
} catch (err) {
    // Use score between 0.0 and 1.0
    jj.finalizeTrajectory(Math.max(0, Math.min(1, score)));
}
```

### Issue: No Patterns Discovered

```javascript
const patterns = JSON.parse(jj.getPatterns());

if (patterns.length === 0) {
    // Need more trajectories with >70% success
    // Record at least 3-5 successful trajectories
}
```

## Related Documentation

- **NPM Package**: https://npmjs.com/package/agentic-jujutsu
- **GitHub**: https://github.com/ruvnet/agentic-flow/tree/main/packages/agentic-jujutsu
- **Full README**: See package README.md
- **Validation Guide**: docs/VALIDATION_FIXES_v2.3.1.md
- **AgentDB Guide**: docs/AGENTDB_GUIDE.md

## Version History

- **v2.3.2** - Documentation updates
- **v2.3.1** - Validation fixes for ReasoningBank
- **v2.3.0** - Quantum-resistant security with @qudag/napi-core
- **v2.1.0** - Self-learning AI with ReasoningBank
- **v2.0.0** - Zero-dependency installation with embedded jj binary

---

**Status**: ✅ Production Ready · **License**: MIT · **Maintained**: Active
