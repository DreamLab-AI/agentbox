# RuVector for Robotics

> For robotics team leads, systems integrators, and embedded engineers. See agentic-robotics-* crates and ruvector-robotics for APIs.

## Perception Pipeline
**What it does**: CNN feature extraction from cameras, LIDAR, and sensor arrays with SIMD-accelerated inference. Attention mechanisms focus compute on the most relevant parts of the scene.
**Technologies**: ruvector-cnn (SimCLR/NNCLR, Int8 quantization, AVX2/SSE4/NEON SIMD), ruvector-attention (FlashAttention-3 O(n) memory, spiking graph attention for DVS sensors, topology-gated attention)
**Use cases**: Int8-quantized visual recognition on embedded GPUs; DVS event streams at 10K+ events/ms via spiking graph attention; MoE routing weights camera/LIDAR/IMU by reliability.

## Motion Planning
**What it does**: Collision-free path computation using DAG optimization with neural heuristic refinement. Solver suite handles kinematic constraints and obstacle avoidance.
**Technologies**: ruvector-dag (neural learning, QuDAG, SONA integration), ruvector-solver (Conjugate Gradient, TRUE solver O(log n), Johnson-Lindenstrauss projection)
**Use cases**: 6-DOF arm planning with sub-ms constraint solving; multi-robot DAG coordination; online replanning with SONA-adapted heuristics.

## Safety Verification
**What it does**: Formally proves safety properties of control logic via SAT/SMT solving and bounded model checking -- not testing, mathematical proof with sub-microsecond overhead.
**Technologies**: ruvector-verified (SAT/SMT, bounded model checking, K-induction), prime-radiant coherence (witness chains), ruvector-coherence (Fiedler value, effective resistance)
**Use cases**: Prove joint torque limits hold under all reachable states; coherence monitoring triggers safe-stop on inconsistent sensor fusion; witness chains log every safety decision.

## Framework Integration
**What it does**: Production robotics framework with ROS3/Zenoh, cognitive platform, and full perception pipeline.
**Technologies**: agentic-robotics-core (agent graph state machine), agentic-robotics-embedded (no_std, RTIC+Embassy), agentic-robotics-rt (dual-runtime), agentic-robotics-mcp, ruvector-robotics (ROS3, Zenoh)
**Deployment**: Full Linux with ROS3/Zenoh; bare-metal with RTIC+Embassy for hard real-time; dual-runtime (RT control + async planning); MCP for remote monitoring.

## Embedded and Real-Time
**What it does**: Bare-metal execution with no_std. No heap allocation on critical paths.
**Technologies**: agentic-robotics-embedded (RTIC+Embassy), micro-hnsw-wasm (11.8KB), ruvector-nervous-system (WTA under 1us for 1000 neurons, DVS at 10K+ events/ms)
**Key metrics**: 11.8KB vector search; WTA under 1 microsecond; DVS lock-free ring buffers with backpressure.

## Learning from Operation
**What it does**: Robots improve with experience. Instant adaptation under 1ms; EWC++ prevents forgetting prior skills when learning new ones.
**Technologies**: SONA (MicroLoRA instant <1ms, hourly LoRA, weekly EWC++), ruvector-domain-expansion (cross-domain transfer, Meta Thompson Sampling), ruvector-learning-wasm (<100us edge adaptation)
**Use cases**: Grip pressure adapted in <1ms after failed grasp; simulation-to-hardware transfer via domain expansion; fleet federated learning shares policies without sharing data.
