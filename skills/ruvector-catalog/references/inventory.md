# RuVector Inventory — WASM Crates, Algorithms, Freshness

Deep-lookup tiers and the raw catalogs. For any specific capability lookup, also
read `docs/ruvector-reference/INVENTORY.md` (~2,000 lines) from the project
directory — this file is a summary.

## Lookup tiers
- **Level 2**: Read `docs/<topic>.md` in this skill directory
- **Level 3**: Read `docs/ruvector-reference/INVENTORY.md` (~2,000 lines)
- **Level 4**: Read `ruvector/crates/<crate>/src/lib.rs`

## All 30 WASM crates
micro-hnsw-wasm, neural-trader-wasm, ruqu-wasm, ruvector-attention-unified-wasm, ruvector-attention-wasm, ruvector-cnn-wasm, ruvector-dag-wasm, ruvector-delta-wasm, ruvector-domain-expansion-wasm, ruvector-economy-wasm, ruvector-exotic-wasm, ruvector-fpga-transformer-wasm, ruvector-gnn-wasm, ruvector-graph-transformer-wasm, ruvector-graph-wasm, ruvector-hyperbolic-hnsw-wasm, ruvector-learning-wasm, ruvector-math-wasm, ruvector-mincut-gated-transformer-wasm, ruvector-mincut-wasm, ruvector-nervous-system-wasm, ruvector-router-wasm, ruvector-solver-wasm, ruvector-sparse-inference-wasm, ruvector-sparsifier-wasm, ruvector-temporal-tensor-wasm, ruvector-tiny-dancer-wasm, ruvector-verified-wasm, ruvector-wasm, ruvllm-wasm

## Named algorithms
Adam, BTSP, BitNet b1.58, Blake3, BFS, DFS, Chebyshev, ChaCha20, ColBERT, Conjugate Gradient, CP decomposition, CUSUM, Dijkstra, Dilithium, Dinic's max-flow, DiskANN, Ed25519, EigenTrust, E-prop, EWC/EWC++, Fisher Information, FlashAttention-3, Floyd-Warshall, Gauss-Seidel, GAT, GCN, Gomory-Hu, GraphSAGE, Grover, Gromov-Wasserstein, HDC, HNSW, Hopfield, Ising, Jacobi, Johnson-Lindenstrauss, K-FAC, Karger min-cut, Kruskal MST, Kuramoto, Kyber, Lanczos, Langevin, LoRA/MicroLoRA, Louvain, Mamba S5, Matryoshka, Metropolis-Hastings, MoE, Monte Carlo, Neumann, Neural hashing, PageRank, PCA, PDE diffusion, Poincaré, QAOA, ReLU, RMSNorm, RoPE, RWKV, SHA-3, Sheaf Laplacian, Sinkhorn, Sliced Wasserstein, Softmax, Spectral sparsification, STDP, Stoer-Wagner, SVD, Surface Code, Tensor Train, Thompson Sampling, TRUE solver, Tucker, VQE, Wasserstein, Winner-Take-All

## Freshness
Built from: 1.58M lines Rust, 2,535 .rs files, 113 crates, 56 npm packages, 30 WASM builds, 131 ADRs, 42 examples, 170 npm exports. Verified 2026-03-30 against commit `ff5acfb2`.
