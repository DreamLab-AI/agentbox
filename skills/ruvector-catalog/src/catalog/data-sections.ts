// ruvector-catalog — Technology recommender for the RuVector monorepo
// https://github.com/ruvnet/ruvector

import type { ProblemSection, CatalogExample } from '../types/index.js';

// ───────────────────────────────────────────────────────────
// Problem-solution section headers (machine-readable SKILL.md)
// ───────────────────────────────────────────────────────────

export const PROBLEM_SECTIONS: ProblemSection[] = [
  {
    id: 'ps-vector-search',
    header: 'I need fast vector similarity search / nearest-neighbor lookup / semantic retrieval',
    synonyms: ['find similar items', 'vector database', 'embedding search', 'RAG retrieval', 'recommendation engine', 'semantic search', 'HNSW indexing', 'similarity matching', 'nearest neighbor index'],
    technologies: ['hnsw', 'hyperbolic-hnsw', 'diskann', 'colbert', 'neural-hashing', 'micro-hnsw', 'hybrid-search', 'matryoshka'],
    primaryCrate: 'ruvector-core',
  },
  {
    id: 'ps-knowledge-graph',
    header: 'I need to model relationships / build a knowledge graph / analyze network structure',
    synonyms: ['graph database', 'connected data', 'find communities', 'relationship mapping', 'social network analysis'],
    technologies: ['hypergraph-db', 'gnn', 'graph-transformer', 'causal-dag', 'graph-sparsifier'],
    primaryCrate: 'ruvector-graph',
  },
  {
    id: 'ps-attention',
    header: 'I need attention mechanisms / transformer building blocks / sequence modeling',
    synonyms: ['build a transformer', 'process long sequences', 'mixture of experts', 'efficient attention'],
    technologies: ['flash-attention', 'mamba-s5', 'moe-attention', 'sheaf-attention', 'mincut-gated', 'hyperbolic-attention', 'topology-gated', 'spiking-graph-attention'],
    primaryCrate: 'ruvector-attention',
  },
  {
    id: 'ps-self-learning',
    header: 'I need a system that learns and adapts from experience',
    synonyms: ['self-improving AI', 'continual learning', 'fine-tuning', 'adaptation', 'LoRA', 'online learning'],
    technologies: ['sona', 'reasoning-bank', 'micro-lora-wasm', 'domain-expansion'],
    primaryCrate: 'sona',
  },
  {
    id: 'ps-hallucination',
    header: 'I need to verify AI outputs / prevent hallucination / detect drift',
    synonyms: ['catch contradictions', 'ensure consistency', 'fact-check AI', 'validate reasoning', 'AI governance', 'hallucination detection', 'coherence scoring', 'drift detection', 'safety verification', 'grounding check'],
    technologies: ['prime-radiant', 'coherence-gate', 'tilezero', 'verified', 'cusum-drift'],
    primaryCrate: 'prime-radiant',
  },
  {
    id: 'ps-neuromorphic',
    header: 'I need bio-inspired computing / neuromorphic processing / brain-like AI',
    synonyms: ['spiking neurons', 'brain-inspired', 'neuromorphic', 'associative memory', 'hyperdimensional'],
    technologies: ['spiking-nn', 'hdc', 'hopfield', 'predictive-coding', 'global-workspace'],
    primaryCrate: 'ruvector-nervous-system',
  },
  {
    id: 'ps-math',
    header: 'I need advanced math primitives / optimal transport / topological analysis',
    synonyms: ['distribution comparison', 'tensor decomposition', 'natural gradient', 'TDA', 'Wasserstein distance'],
    technologies: ['optimal-transport', 'tropical-geometry', 'persistent-homology', 'tensor-networks', 'info-geometry'],
    primaryCrate: 'ruvector-math',
  },
  {
    id: 'ps-solvers',
    header: 'I need to solve large sparse linear systems / compute PageRank',
    synonyms: ['matrix solver', 'sparse computation', 'linear algebra', 'conjugate gradient'],
    technologies: ['auto-solver'],
    primaryCrate: 'ruvector-solver',
  },
  {
    id: 'ps-partitioning',
    header: 'I need graph partitioning / network flow / min-cut computation',
    synonyms: ['split a graph', 'divide networks', 'bottleneck detection', 'max-flow'],
    technologies: ['dynamic-mincut'],
    primaryCrate: 'ruvector-mincut',
  },
  {
    id: 'ps-local-llm',
    header: 'I need local LLM inference / model serving / on-device AI',
    synonyms: ['run models locally', 'self-hosted AI', 'GPU inference', 'edge AI', 'quantized models'],
    technologies: ['ruvllm', 'metal-gpu', 'continuous-batching', 'self-reflection'],
    primaryCrate: 'ruvllm',
  },
  {
    id: 'ps-quantum',
    header: 'I need quantum computing simulation / quantum algorithms',
    synonyms: ['quantum circuits', 'qubit simulation', 'quantum optimization', 'VQE', 'QAOA'],
    technologies: ['ruqu', 'exotic-quantum'],
    primaryCrate: 'ruqu-core',
  },
  {
    id: 'ps-distributed',
    header: 'I need distributed consensus / replication / multi-node coordination',
    synonyms: ['cluster management', 'data replication', 'fault tolerance', 'distributed database', 'Raft'],
    technologies: ['raft', 'auto-sharding', 'delta-crdt'],
    primaryCrate: 'ruvector-raft',
  },
  {
    id: 'ps-storage',
    header: 'I need a database / persistent storage / data containers',
    synonyms: ['store data', 'SQL database', 'embedded database', 'mobile database', 'PostgreSQL'],
    technologies: ['postgres-ext', 'rvlite', 'rvf'],
    primaryCrate: 'ruvector-postgres',
  },
  {
    id: 'ps-agents',
    header: 'I need an AI agent framework / tool orchestration / MCP integration',
    synonyms: ['build agents', 'agent routing', 'model orchestration', 'agentic AI', 'MCP'],
    technologies: ['rvagent', 'tiny-dancer', 'mcp-brain'],
    primaryCrate: 'rvagent-core',
  },
  {
    id: 'ps-robotics',
    header: 'I need cognitive robotics / ROS integration / real-time perception',
    synonyms: ['robot control', 'autonomous systems', 'sensor fusion', 'ROS3'],
    technologies: ['agentic-robotics'],
    primaryCrate: 'agentic-robotics-core',
  },
  {
    id: 'ps-trading',
    header: 'I need AI-powered trading signals / financial coherence gates',
    synonyms: ['algorithmic trading', 'market signals', 'trading AI', 'fintech'],
    technologies: ['neural-trader'],
    primaryCrate: 'neural-trader-core',
  },
  {
    id: 'ps-edge',
    header: 'I need to deploy AI on edge devices / IoT / constrained environments',
    synonyms: ['microcontroller AI', 'tiny ML', 'embedded AI', 'WASM deployment'],
    technologies: ['micro-hnsw', 'micro-lora-wasm', 'spiking-nn', 'hdc', 'predictive-coding', 'neural-hashing'],
    primaryCrate: 'micro-hnsw-wasm',
  },
  {
    id: 'ps-rag',
    header: 'I need to build a RAG pipeline / improve retrieval quality',
    synonyms: ['retrieval augmented generation', 'context retrieval', 'document search for LLMs'],
    technologies: ['hnsw', 'hybrid-search', 'colbert', 'matryoshka'],
    primaryCrate: 'ruvector-core',
  },
  {
    id: 'ps-causal',
    header: 'I need causal inference / cause-and-effect analysis',
    synonyms: ['causal discovery', 'treatment effect', 'counterfactual', 'DAG analysis'],
    technologies: ['causal-dag', 'hypergraph-db'],
    primaryCrate: 'ruvector-dag',
  },
  {
    id: 'ps-privacy',
    header: 'I need formal verification / compliance / PII protection',
    synonyms: ['prove correctness', 'model checking', 'SAT solver', 'data privacy'],
    technologies: ['verified', 'prime-radiant', 'coherence-gate'],
    primaryCrate: 'ruvector-verified',
  },
  {
    id: 'ps-genomics',
    header: 'I need genomics / biomarker scoring / pharmacogenomics',
    synonyms: ['DNA analysis', 'SNP scoring', 'variant analysis', 'bioinformatics'],
    technologies: ['hnsw', 'persistent-homology', 'gnn', 'hyperbolic-hnsw'],
    primaryCrate: 'ruvector-core',
  },
];

// ───────────────────────────────────────────────────────────
// Out-of-scope categories
// ───────────────────────────────────────────────────────────

export const OUT_OF_SCOPE: string[] = [
  'Content generation (no text writing, image generation, or creative tools)',
  'General-purpose web frameworks (no React, Next.js, Express alternatives)',
  'Cloud provider management (no AWS/GCP/Azure orchestration)',
  'CI/CD pipelines (no GitHub Actions, Jenkins alternatives)',
  'Package management (no npm/cargo registry hosting)',
  'User authentication (no OAuth, SSO, or identity providers)',
  'Payment processing (no Stripe, billing, or commerce)',
  'Email/notification services',
  'CSS/styling frameworks',
  'Mobile app frameworks (Flutter, React Native)',
  'Video/audio streaming protocols',
  'Game engines',
  'Operating system kernels',
  'Cryptocurrency/blockchain consensus (we have Raft/CRDT, not blockchain)',
  'Natural language generation (we detect hallucinations, not generate text)',
];

// ───────────────────────────────────────────────────────────
// Examples (44 from the RuVector monorepo)
// ───────────────────────────────────────────────────────────

export const EXAMPLES: CatalogExample[] = [
  { name: 'OSpipe', path: 'examples/OSpipe', description: 'ScreenPipe + RuVector semantic AI memory integration for monitoring user actions on desktop, suggesting efficiency improvements through AI automation', technologiesUsed: ['hnsw', 'sona', 'ruqu'] },
  { name: 'prime-radiant', path: 'examples/prime-radiant', description: 'Sheaf cohomology, category theory, HoTT, quantum topology', technologiesUsed: ['prime-radiant', 'sheaf-attention'] },
  { name: 'neural-trader', path: 'examples/neural-trader', description: 'Coherence-gated financial trading signals', technologiesUsed: ['neural-trader', 'cusum-drift'] },
  { name: 'dna', path: 'examples/dna', description: 'rvDNA: 20-SNP biomarker scoring, pharmacogenomics', technologiesUsed: ['hnsw'] },
  { name: 'refrag-pipeline', path: 'examples/refrag-pipeline', description: '30x RAG latency reduction pipeline', technologiesUsed: ['hnsw', 'hybrid-search'] },
  { name: 'robotics', path: 'examples/robotics', description: 'ROS3 cognitive robotics demo', technologiesUsed: ['agentic-robotics'] },
  { name: 'spiking-network', path: 'examples/spiking-network', description: 'ASIC neuromorphic spiking network', technologiesUsed: ['spiking-nn', 'micro-hnsw'] },
  { name: 'verified-applications', path: 'examples/verified-applications', description: '10 apps: weapons filters, legal forensics, etc.', technologiesUsed: ['verified'] },
  { name: 'wasm-react', path: 'examples/wasm-react', description: 'React + RuVector WASM integration', technologiesUsed: ['hnsw'] },
  { name: 'edge', path: 'examples/edge', description: 'Edge deployment (Vercel, Cloudflare, Deno)', technologiesUsed: ['hnsw', 'micro-hnsw'] },
  { name: 'hello-ruvector', path: 'examples/hello-ruvector', description: 'Minimal getting-started example', technologiesUsed: ['hnsw'] },
  { name: 'graph-analytics', path: 'examples/graph-analytics', description: 'PageRank, community detection, shortest path', technologiesUsed: ['hypergraph-db'] },
  { name: 'attention-zoo', path: 'examples/attention-zoo', description: 'All 18 attention variants side by side', technologiesUsed: ['flash-attention', 'mamba-s5', 'moe-attention', 'sheaf-attention'] },
  { name: 'sona-demo', path: 'examples/sona-demo', description: 'SONA self-learning with MicroLoRA and EWC++', technologiesUsed: ['sona'] },
  { name: 'rvlite-browser', path: 'examples/rvlite-browser', description: 'RVLite embedded DB in browser with IndexedDB', technologiesUsed: ['rvlite'] },
  { name: 'postgres-extension', path: 'examples/postgres-extension', description: 'PostgreSQL extension with vector + graph + TDA', technologiesUsed: ['postgres-ext'] },
  { name: 'rvf-containers', path: 'examples/rvf-containers', description: 'RVF cognitive container packing and federation', technologiesUsed: ['rvf'] },
  { name: 'raft-cluster', path: 'examples/raft-cluster', description: '3-node Raft consensus cluster', technologiesUsed: ['raft'] },
  { name: 'delta-crdt-sync', path: 'examples/delta-crdt-sync', description: 'Offline-first CRDT synchronization', technologiesUsed: ['delta-crdt'] },
  { name: 'gnn-molecules', path: 'examples/gnn-molecules', description: 'GNN for molecular property prediction', technologiesUsed: ['gnn'] },
  { name: 'causal-health', path: 'examples/causal-health', description: 'Causal DAG for treatment effect estimation', technologiesUsed: ['causal-dag'] },
  { name: 'mincut-partitioning', path: 'examples/mincut-partitioning', description: 'Dynamic graph partitioning benchmark', technologiesUsed: ['dynamic-mincut'] },
  { name: 'ruvllm-chat', path: 'examples/ruvllm-chat', description: 'Local LLM chat with SONA learning', technologiesUsed: ['ruvllm', 'sona'] },
  { name: 'metal-bench', path: 'examples/metal-bench', description: 'Apple Metal GPU inference benchmarks', technologiesUsed: ['metal-gpu'] },
  { name: 'ruqu-circuits', path: 'examples/ruqu-circuits', description: 'Quantum circuit builder and simulator', technologiesUsed: ['ruqu'] },
  { name: 'hopfield-memory', path: 'examples/hopfield-memory', description: 'Associative memory pattern retrieval', technologiesUsed: ['hopfield'] },
  { name: 'hdc-classify', path: 'examples/hdc-classify', description: 'Hyperdimensional classification benchmark', technologiesUsed: ['hdc'] },
  { name: 'predictive-stream', path: 'examples/predictive-stream', description: 'Predictive coding for streaming data', technologiesUsed: ['predictive-coding'] },
  { name: 'optimal-transport', path: 'examples/optimal-transport', description: 'Wasserstein distance and Sinkhorn solver', technologiesUsed: ['optimal-transport'] },
  { name: 'tda-shapes', path: 'examples/tda-shapes', description: 'Persistent homology on point clouds', technologiesUsed: ['persistent-homology'] },
  { name: 'tensor-compress', path: 'examples/tensor-compress', description: 'Tensor train decomposition for embeddings', technologiesUsed: ['tensor-networks'] },
  { name: 'natural-gradient', path: 'examples/natural-gradient', description: 'K-FAC natural gradient training', technologiesUsed: ['info-geometry'] },
  { name: 'rvagent-todo', path: 'examples/rvagent-todo', description: 'Agent framework with tool use and MCP', technologiesUsed: ['rvagent'] },
  { name: 'tiny-dancer-routing', path: 'examples/tiny-dancer-routing', description: 'Neural model router demo', technologiesUsed: ['tiny-dancer'] },
  { name: 'tropical-nn', path: 'examples/tropical-nn', description: 'Tropical geometry linear region counting', technologiesUsed: ['tropical-geometry'] },
  { name: 'coherence-fabric', path: 'examples/coherence-fabric', description: '256-tile coherence gate fabric', technologiesUsed: ['coherence-gate', 'tilezero'] },
  { name: 'self-reflection', path: 'examples/self-reflection', description: 'ReflectiveAgent multi-perspective critique', technologiesUsed: ['self-reflection'] },
  { name: 'hyperbolic-taxonomy', path: 'examples/hyperbolic-taxonomy', description: 'Hyperbolic HNSW for product taxonomies', technologiesUsed: ['hyperbolic-hnsw'] },
  { name: 'diskann-billion', path: 'examples/diskann-billion', description: 'Billion-scale SSD-backed search', technologiesUsed: ['diskann'] },
  { name: 'colbert-passages', path: 'examples/colbert-passages', description: 'ColBERT late interaction passage retrieval', technologiesUsed: ['colbert'] },
  { name: 'matryoshka-adaptive', path: 'examples/matryoshka-adaptive', description: 'Adaptive dimension embeddings', technologiesUsed: ['matryoshka'] },
  { name: 'graph-sparsify', path: 'examples/graph-sparsify', description: 'Spectral graph sparsification', technologiesUsed: ['graph-sparsifier'] },
  { name: 'bitnet-inference', path: 'examples/bitnet-inference', description: 'BitNet b1.58 ternary quantization', technologiesUsed: ['ruvllm'] },
  { name: 'mcp-brain-demo', path: 'examples/mcp-brain-demo', description: 'Cross-session agent memory via MCP Brain', technologiesUsed: ['mcp-brain'] },
];
