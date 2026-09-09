# Cost Model: COCOMO-Hybrid Valuation

Full reference for DreamLab AI infrastructure valuation, pricing methodology, and research backing.

## COCOMO II Baseline

The ecosystem replacement value uses COCOMO II (Constructive Cost Model) calibrated with agentic-era productivity multipliers.

### SLOC Metrics

| Metric | Value |
|--------|-------|
| Total SLOC | 697,289 |
| File count | 4,662 |
| Primary languages | Rust, TypeScript, WASM |
| Measurement date | 2025-Q4 |

### COCOMO II Parameters

```
Effort (person-months) = A * (KSLOC)^E * Product(EM_i)

Where:
  A     = 2.94  (COCOMO II calibration constant)
  KSLOC = 697.3
  E     = 1.0997 (scale factors for high complexity, multi-platform)
  EM_i  = effort multipliers for reliability, complexity, reuse, team capability
```

### Agentic Productivity Adjustment

METR 2025-2026 developer productivity studies (arXiv:2507.09089) measured AI-assisted developer throughput at 1.8x-3.2x for greenfield Rust/TS projects. We apply a conservative **2.0x** deflator to raw COCOMO II estimates to account for the AI-assisted development environment used to build the ecosystem, yielding:

```
Adjusted effort = COCOMO_II_effort / 2.0
```

This deflator is intentionally conservative. The METR studies show higher multipliers for scaffolding tasks (3.2x) but lower for novel algorithm design (1.2x). A blended 2.0x reflects the ecosystem's mix.

### Replacement Value

| Estimate | Value |
|----------|-------|
| COCOMO II raw median | $144M |
| AI-adjusted median | $72M |
| Defensible range (P25-P75) | $62M - $82M |
| Lower bound (aggressive AI deflator 3.0x) | $48M |

The **$72M median** is the headline figure. The $62M-$82M range accounts for parameter uncertainty in effort multipliers and regional salary differences.

## Infrastructure-as-Capability Valuation

Traditional SaaS valuations use ARR multiples (5x-15x). DreamLab's infrastructure is not a SaaS product -- it is a capability platform where the infrastructure itself is the moat. The correct comparable is **infrastructure-as-capability**, valued at:

```
Enterprise value = Usage revenue * capability_multiple

Where capability_multiple = 8x to 20x
```

This range is informed by:

- Hyperscaler GPU-as-a-service valuations (CoreWeave IPO: ~18x forward revenue)
- AI infrastructure M&A precedents (2024-2025 median: 12x)
- DID-anchored identity infrastructure premium (see market data below)

### Why Not SaaS Multiples?

SaaS multiples price *recurring subscription revenue*. DreamLab prices *compute capability* -- the value of having the infrastructure exist, not just the revenue it generates today. A nuclear plant's value is not 10x its electricity sales; it is the replacement cost of the capability. Same logic applies here.

## Inference Economics

Per Erdil, "Inference Economics of Language Models" (arXiv:2506.04645):

- Marginal cost of inference follows a power law: `cost ~ tokens^0.7`
- Batch efficiency gains plateau at ~32 concurrent requests per GPU
- The 10x/100x/5x tier multipliers reflect the empirical compute-intensity ratio between text inference, image diffusion, and embedding/analytics workloads on A100/H100 hardware

### Cost-Per-Token Benchmarks (H100, 2025 pricing)

| Workload | Tokens/sec | Cost/1M tokens | Relative to text |
|----------|-----------|----------------|-----------------|
| Text inference (LLaMA-70B) | ~2,000 | $0.50 | 1.0x |
| Image generation (SDXL) | ~0.8 img/s | $5.00/img (~$50/M equiv) | ~100x |
| Embeddings (ada-002 class) | ~10,000 | $0.10 | ~0.2x (rounded to 5x for margin) |

The analytics tier is set at 5x (not 0.2x) because analytics jobs include post-processing, aggregation, and storage writes that dominate the embedding cost.

## Agentic Economy Context

### Rothschild et al., "The Agentic Economy" (arXiv:2505.15799)

Key findings relevant to our pricing:
- Agent-to-agent transactions will exceed human-to-agent by 2027
- Micropayment rails (Lightning, L2s) are prerequisite infrastructure
- Cost transparency is a competitive advantage: agents preferentially route to platforms that expose pre-flight cost estimates

### Hadfield & Koh, "An Economy of AI Agents" (arXiv:2509.01063)

- Proposes formal framework for agent economic participation
- Argues for escrow-and-settle pattern (our hold/settle lifecycle mirrors this)
- Highlights need for verifiable cost commitments (our NIP-98 signed estimates)

### Gundlach et al., "The Price of Progress" (arXiv:2511.23455)

- Documents total cost of ownership for AI infrastructure at scale
- GPU depreciation: 3-year cycle, 40% residual
- Electricity + cooling: 30-45% of total operating cost
- Our base cost must absorb amortised hardware + opex

### x402 Protocol

- Machine-to-machine payment protocol
- $600M annualised volume (2025)
- Validates micropayment viability at scale
- DreamLab's Lightning integration is architecturally compatible with x402 settlement

## DID Market Context

Decentralised Identity (DID) infrastructure underpins DreamLab's NIP-based auth:

| Metric | Value |
|--------|-------|
| 2024 market size | $760M |
| 2031 projected | $24.85B |
| CAGR | 65.5% |

DID-anchored identity is not just auth -- it is the trust layer for agent-to-agent commerce. Every cost estimate is signed by a DID-bearing keypair, making pricing auditable and non-repudiable.

## Rate Configuration

### Default Rate Table

| Parameter | Default | Environment Variable |
|-----------|---------|---------------------|
| Base cost (sats) | 10 | `BASE_COST_SATS` |
| Inference multiplier | 10 | `INFERENCE_MULTIPLIER` |
| Image-gen multiplier | 100 | `IMAGE_GEN_MULTIPLIER` |
| Analytics multiplier | 5 | `ANALYTICS_MULTIPLIER` |
| DREAM/sat rate | 10 | `DREAM_PER_SAT` |
| Hold buffer | 1.2 (20%) | `HOLD_BUFFER_RATIO` |

All parameters are hot-reloadable via wrangler.toml `[vars]` without redeployment.

## Summary

The cost model serves three audiences:

1. **Operators** -- set pricing that covers GPU amortisation + opex + margin
2. **Agent developers** -- get predictable pre-flight cost estimates for job planning
3. **Investors/analysts** -- understand ecosystem replacement value ($72M) and infrastructure-as-capability valuation framework (8x-20x on usage revenue)
