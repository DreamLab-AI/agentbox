# AgentDB Vector Search — Performance & Troubleshooting

Tuning tips and fixes for common vector-search issues.

## Performance Tips

1. **Enable HNSW indexing**: Automatic with AgentDB, 10-100x faster
2. **Use quantization**: Binary (32x), Scalar (4x), Product (8-16x) memory reduction
3. **Batch operations**: 500x faster for bulk inserts
4. **Match dimensions**: 1536 (OpenAI), 768 (sentence-transformers), 384 (MiniLM) <!-- lint-ok: third-party/meta fact, not a RuVector claim -->
5. **Similarity threshold**: Start at 0.7 for quality, adjust based on use case
6. **Enable caching**: 1000 pattern cache for frequent queries

## Troubleshooting

### Issue: Slow search performance
```bash
# Check if HNSW indexing is enabled (automatic)
npx agentdb@latest stats ./vectors.db

# Expected: <100µs search time
```

### Issue: High memory usage
```bash
# Enable binary quantization (32x reduction)
# Use in adapter: quantizationType: 'binary'
```

### Issue: Poor relevance
```bash
# Adjust similarity threshold
npx agentdb@latest query ./db.sqlite "[...]" -t 0.8  # Higher threshold

# Or use MMR for diverse results
# Use in adapter: useMMR: true
```

### Issue: Wrong dimensions
```bash
# Check embedding model dimensions:
# - OpenAI ada-002: 1536
# - sentence-transformers: 768
# - all-MiniLM-L6-v2: 384 <!-- lint-ok: third-party/meta fact, not a RuVector claim -->

npx agentdb@latest init ./db.sqlite --dimension 768
```
