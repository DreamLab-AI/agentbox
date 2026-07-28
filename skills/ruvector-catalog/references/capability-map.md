# RuVector Capability Map — Problem → Solution

Match the user's need to a RuVector capability. Package/crate names, npm exports,
and key algorithms are listed per problem class. When a capability is not in npm,
build it from the submodule (see the three access paths in `SKILL.md`).

## "I need to find similar things"
- **ruvector-core**: HNSW (61μs, 2.5K q/s), DiskANN, Hybrid Search (RRF), ColBERT, Matryoshka, Neural Hashing (32x)
- **ruvector-hyperbolic-hnsw** + wasm: Poincaré ball for hierarchies
- **micro-hnsw-wasm**: 11.8KB for IoT/edge
- npm: `VectorDb`, `cosineSimilarity`, `differentiableSearch`, `embed`, `embedBatch`

## "I need relationships between entities"
- **ruvector-graph** + wasm + node: Neo4j-compatible, Cypher, PageRank, Louvain, BFS, DFS, Dijkstra
- **rvlite**: Embedded DB with SQL + SPARQL + Cypher + IndexedDB
- **ruvector-gnn** + wasm + node: GCN, GAT, GraphSAGE on HNSW
- npm: `buildGraph`, `louvainCommunities`, `minCut`, `spectralClustering`, `CodeGraph`

## "I need to process images"
- **ruvector-cnn** + wasm: MobileNet-V3, SIMD, INT8, SimCLR contrastive learning
- Build: `wasm-pack build --target nodejs` from `ruvector/crates/ruvector-cnn-wasm` (90s)
- API: `new WasmCnnEmbedder().extract(rgbBytes, 224, 224)` → 512D Float32Array
- **TESTED 2026-03-30** ✓

## "I need something that learns from experience"
- **sona**: 3 loops — Instant (<1ms MicroLoRA), Background (hourly), Deep (EWC++)
- **AdaptiveEmbedder**: ONNX + LoRA adapters, prototype memory, contrastive learning
- **ReasoningBank**: HNSW-indexed trajectory patterns (150x faster)
- npm: `SonaEngine`, `AdaptiveEmbedder`, `LearningEngine`, `IntelligenceEngine`

## "I need to verify AI outputs / detect drift"
- **ruvector-coherence**: Spectral health (Fiedler, effective resistance), contradiction rate
- **prime-radiant**: Sheaf Cohomology, Blake3 witness chains, governance
- **cognitum-gate-kernel/tilezero**: Evidence accumulation, permit tokens
- npm: `CoherenceMonitor`, `SemanticDriftDetector`

## "I need attention mechanisms"
- **ruvector-attention**: 50+ — FlashAttention-3, Mamba S5, RWKV, MLA, MoE, Sheaf, PDE, Hyperbolic, Spiking Graph, Info Bottleneck, Info Geometry, Mixed Curvature, Optimal Transport, Topology-Gated
- npm: `FlashAttention`, `MultiHeadAttention`, `HyperbolicAttention`, `MoEAttention`, `LinearAttention`, + 5 more
- @ruvector/attention: 38 exports

## "I need bio-inspired computation"
- **ruvector-nervous-system** + wasm: Spiking NN (LIF), STDP, Hopfield (Modern), HDC (10K-bit), Dendritic, Kuramoto, Global Workspace, Predictive Coding
- Build: `ruvector-nervous-system-wasm`

## "I need advanced mathematics"
- **ruvector-math** + wasm: Optimal Transport (Wasserstein, Sinkhorn, Gromov-Wasserstein), Info Geometry (Fisher, K-FAC), TDA (Betti, persistence diagrams), Tropical, Tensor Networks (TT/Tucker/CP), Manifolds
- **ruvector-solver** + wasm + node: 8 algorithms — Neumann, CG, Push, Random Walk, TRUE O(log n), BMSSP
- npm: `expMap`, `logMap`, `poincareDistance`, `spectralClustering`

## "I need to run LLMs"
- **ruvllm** + wasm + cli: BitNet b1.58, QAT, MoE, MicroLoRA, Metal/CUDA/WebGPU, Batching, GGUF
- npm: `@ruvector/ruvllm`, `@ruvector/ruvllm-wasm`

## "I need distributed systems"
- **ruvector-raft**: Leader election, log replication, snapshots
- **ruvector-cluster**: Consistent hashing, DAG consensus, gossip
- **ruvector-replication**: Vector clocks, CRDTs, failover
- **ruvector-delta-core/graph/index/consensus**: Incremental change tracking

## "I need a persistent vector format"
- **RVF** (19 sub-crates): Binary HNSW, witness chains, crypto, quantization, eBPF, federation, kernel
- npm: `RvfDatabase.create()`, `.openReadonly()`, `.query()`, `.ingestBatch([{id, vector}])`
- Note: `ingestBatch` takes array of `{id: number, vector: Float32Array}` objects

## "I need a database"
- **ruvector-postgres**: 230+ SQL functions, pgvector drop-in, graph, attention, SONA, healing, multi-tenancy
- **rvlite**: Embedded SQL + SPARQL + Cypher (WASM, IndexedDB)
- **RVF**: Binary format, zero-server, persistent HNSW

## "I need agents"
- **rvAgent** (9 sub-crates): Agent graph state machine, SONA middleware, MCP bridge, filesystem, sandbox, subagents, CRDT merge, tools (ls/read/write/edit/glob/grep)
- npm: via `@ruvector/agentic-integration`

---

## Response adaptation

Adapt language to the audience:

**For engineers**: Use specific API names, code examples, performance numbers, complexity notation. Example: "Use `RvfDatabase.openReadonly()` for O(log n) HNSW search — 61us per query on 10K vectors."

**For non-technical stakeholders** (Board members, PMs, executives): Use plain English, analogies, and business impact. Example: "Instead of reading every document to find an answer (which takes 10 seconds), the new system jumps directly to the right document (under 1 second) — like having a librarian who memorized every page."

**For mixed audiences**: Lead with business impact, follow with technical details in parentheses.
