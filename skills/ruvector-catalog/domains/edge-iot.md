# RuVector for Edge and IoT

> For IoT product managers, embedded architects, and edge computing teams.

## Ultra-Small Footprint
**What it does**: Vector similarity search in 11.8KB of WebAssembly with integrated spiking neural networks. Runs on microcontrollers, wearables, and constrained devices.
**Technologies**: micro-hnsw-wasm (11.8KB WASM, HNSW index, spiking neural networks, ASIC-compatible)
**Key metrics**: Fits in L1 cache; HNSW on devices with 64KB RAM; designed for neuromorphic/ASIC deployment.

## 25+ WASM Crates
**What it does**: The full RuVector stack as composable WebAssembly modules. Pick only what your device needs.
**Key modules**:
- **Search**: micro-hnsw-wasm, ruvector-wasm, ruvector-hyperbolic-hnsw-wasm
- **Graph**: ruvector-graph-wasm, ruvector-gnn-wasm, ruvector-dag-wasm
- **Intelligence**: ruvector-attention-wasm, ruvector-cnn-wasm, ruvector-nervous-system-wasm
- **Learning**: ruvector-learning-wasm (MicroLoRA), ruvector-domain-expansion-wasm
- **Math**: ruvector-solver-wasm, ruvector-math-wasm, ruvector-sparsifier-wasm
- **Database**: rvlite (SQL + SPARQL + Cypher, IndexedDB), rvf-wasm
- **LLM**: ruvllm-wasm (BitNet ternary inference in browser)
- **Specialized**: ruvector-sparse-inference-wasm, ruvector-temporal-tensor-wasm, ruvector-verified-wasm, ruvector-fpga-transformer-wasm, neural-trader-wasm, ruvector-delta-wasm, ruvector-economy-wasm

## Browser Deployment
**What it does**: Vector search, graph queries, and AI inference in the browser with no backend. rvlite provides a full embedded database persisting to IndexedDB.
**Technologies**: ruvector-wasm, rvlite, ruvllm-wasm (WebGPU, BitNet b1.58), rvagent-wasm
**Use cases**: Offline-first PWA with client-side semantic search; browser LLM with BitNet ternary quantization (multiplication-free); field apps that sync when connectivity returns.

## Spiking Neural Networks
**What it does**: Event-driven processing that computes only when input changes. Dramatically lower energy than conventional neural networks.
**Technologies**: ruvector-nervous-system (LIF neurons, STDP, DVS bus at 10K+ events/ms, Hopfield with exponential storage, HDC 10K-bit vectors, WTA under 1us, predictive coding)
**Key advantage**: Predictive coding reduces transmission by 90-99% -- only changes are sent. Critical for bandwidth-constrained IoT networks.

## On-Device Learning
**What it does**: Devices learn locally without cloud connectivity. MicroLoRA adapts in under 100 microseconds.
**Technologies**: ruvector-learning-wasm (MicroLoRA rank-2, <100us), SONA (instant <1ms, hourly, weekly EWC++), ruvector-domain-expansion-wasm
**Use cases**: Predictive maintenance sensors adapt thresholds locally; fleet federated learning exchanges only weight deltas; EWC++ prevents forgetting seasonal calibrations.

## Privacy by Design
**What it does**: All processing on-device. When aggregation is needed, differential privacy ensures individual data cannot be reconstructed.
**Technologies**: rvf-federation (PII stripping, differential privacy), rvf-crypto (Ed25519, SHA-3), ruvector-cognitive-container (sealed WASM, tamper-evident witness chains)
**Regulatory**: GDPR data minimization by architecture. Cognitive containers provide tamper-evident execution with cryptographic audit trails.
