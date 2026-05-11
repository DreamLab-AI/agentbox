---
name: "Cost Estimation"
description: >
  Estimate GPU endpoint costs, agent job costs, and MRC20 token operations for the DreamLab AI
  ecosystem. Use when pricing inference/image-gen/analytics endpoints, calculating agent job
  holds and settlements, converting between DREAM tokens and sats, or valuing infrastructure
  replacement cost. Integrates with pod-worker /pay/.estimate route and khive tagged recall.
---

# Cost Estimation

Pricing engine for DreamLab AI compute, agent jobs, and token economics.

## When To Use

- Estimating per-request cost for GPU endpoints (inference, image generation, analytics)
- Calculating agent job cost through the estimate-hold-run-settle lifecycle
- Converting between DREAM tokens and satoshis (buy/withdraw)
- Quoting infrastructure replacement value using COCOMO-hybrid methodology
- Building cost projections for capacity planning or investor materials

**When NOT to use:**
- Billing reconciliation or payment processing -- that is pod-worker's domain
- Token smart-contract deployment -- use the MRC20 contract tools directly
- General financial modelling unrelated to DreamLab compute

## Quick Start

```
# Estimate a single inference request
base_cost_sats = 10
inference_cost = base_cost_sats * 10  # = 100 sats

# Convert to DREAM tokens (buy rate: ceil)
import math
dream_rate = 10  # DREAM per sat (configurable)
dream_cost = math.ceil(inference_cost * dream_rate)  # = 1000 DREAM
```

## GPU Endpoint Cost Tiers

All costs derive from a configurable **base cost** (in satoshis). The tier multiplier depends on endpoint type:

| Endpoint | Multiplier | Example (base=10 sats) |
|----------|-----------|------------------------|
| Inference (text LLM) | 10x | 100 sats |
| Image generation | 100x | 1,000 sats |
| Analytics / embeddings | 5x | 50 sats |

The base cost is set per-pod in `wrangler.toml` under `[vars]` as `BASE_COST_SATS`. Override per-endpoint by setting `INFERENCE_MULTIPLIER`, `IMAGE_GEN_MULTIPLIER`, or `ANALYTICS_MULTIPLIER`.

## Agent Job Cost Lifecycle

Every agent job passes through four states with associated cost events:

```
estimated --> hold --> running --> settled
    |                     |           |
    v                     v           v
  quote only        funds locked   actual deducted,
  (no charge)       (escrow)       overpay refunded
```

### Estimation Formula

```
estimated_cost = base_cost * tier_multiplier * estimated_units
hold_amount    = estimated_cost * 1.2          # 20% buffer
settled_cost   = base_cost * tier_multiplier * actual_units
refund         = hold_amount - settled_cost    # >= 0, always
```

The 20% hold buffer absorbs variance in token counts, retry loops, and GPU scheduling jitter. If `settled_cost > hold_amount` (should be rare), the delta is charged as a post-settlement adjustment.

### Integration: pod-worker /pay/.estimate

The pod-worker exposes a pre-flight cost estimate:

```
POST /pay/.estimate
Content-Type: application/json
Authorization: Nostr <nip98-token>

{
  "endpoint": "inference",
  "units": 500,
  "base_cost_sats": 10
}

Response:
{
  "estimated_sats": 50000,
  "hold_sats": 60000,
  "dream_tokens": 500000,
  "rate": 10
}
```

## MRC20 Token Operations

DREAM tokens trade against satoshis at a configurable rate (default: 10 DREAM per sat).

### Buy (sats to DREAM)

User pays sats, receives DREAM. Use **ceiling** to ensure the platform never undersells:

```
dream_received = ceil(sats_paid * rate)
```

### Withdraw (DREAM to sats)

User burns DREAM, receives sats. Use **floor** to ensure the platform never overpays:

```
sats_received = floor(dream_spent / rate)
```

### Why ceil/floor?

The rounding asymmetry guarantees the treasury never runs a deficit on token conversions. At scale this produces a micro-margin that funds the reserve pool.

## Using khive for Pricing Decisions

Tag all pricing decisions for future recall:

```bash
# Store a pricing decision
khive remember "Set image-gen multiplier to 100x based on A100 cost-per-token benchmarks" \
  --tags cost,image-gen,pricing,gpu

# Recall pricing rationale later
khive recall --tags cost,pricing --query "why is image gen 100x"
```

## Reference

- Full COCOMO-hybrid valuation model and research citations: [cost-model.md](cost-model.md)
- Worked examples (single job, batch, token conversion, lifecycle): [examples.md](examples.md)
