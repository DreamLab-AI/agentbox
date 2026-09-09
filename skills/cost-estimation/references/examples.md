# Cost Estimation: Worked Examples

Concrete calculations using the DreamLab cost model. All examples use default parameters unless stated otherwise.

**Defaults**: base_cost = 10 sats, DREAM/sat rate = 10, hold buffer = 1.2

---

## Example 1: Single Inference Request

A text LLM inference call processing ~500 tokens.

```
Tier:       inference (10x multiplier)
Units:      1 request
Base cost:  10 sats

Cost = base_cost * multiplier * units
     = 10 * 10 * 1
     = 100 sats

In DREAM (buy, ceil):
  ceil(100 * 10) = 1,000 DREAM
```

**Result**: 100 sats / 1,000 DREAM per inference request.

---

## Example 2: Image Generation Batch (20 images)

A batch job generating 20 SDXL images.

```
Tier:       image-gen (100x multiplier)
Units:      20 images
Base cost:  10 sats

Estimated cost = 10 * 100 * 20 = 20,000 sats
Hold amount    = 20,000 * 1.2  = 24,000 sats
In DREAM (buy): ceil(24,000 * 10) = 240,000 DREAM (hold)

# After job completes -- actual: 18 images succeeded, 2 failed and were not billed
Settled cost   = 10 * 100 * 18 = 18,000 sats
Refund         = 24,000 - 18,000 = 6,000 sats (= 60,000 DREAM)
```

**Result**: User holds 240,000 DREAM, settles at 180,000 DREAM, gets 60,000 DREAM refunded.

---

## Example 3: Analytics Embedding Job

Generating embeddings for 10,000 documents.

```
Tier:       analytics (5x multiplier)
Units:      10,000 documents
Base cost:  10 sats

Estimated cost = 10 * 5 * 10,000 = 500,000 sats
Hold amount    = 500,000 * 1.2   = 600,000 sats

In DREAM (buy): ceil(600,000 * 10) = 6,000,000 DREAM (hold)
```

**Result**: 600,000 sats hold / 6,000,000 DREAM.

---

## Example 4: Token Buy Calculation

User wants to buy DREAM tokens with 5,000 sats.

```
Rate:  10 DREAM per sat
Rounding: ceil (buy favours platform)

dream_received = ceil(5,000 * 10)
               = ceil(50,000)
               = 50,000 DREAM
```

With a non-integer rate (e.g., 10.3 DREAM/sat):

```
dream_received = ceil(5,000 * 10.3)
               = ceil(51,500)
               = 51,500 DREAM
```

With an amount that produces a fractional result (e.g., 333 sats at rate 10.1):

```
dream_received = ceil(333 * 10.1)
               = ceil(3,363.3)
               = 3,364 DREAM
```

**Key**: `ceil` ensures the platform never gives away fractional tokens for free. The user always receives at least the DREAM equivalent of what they paid.

---

## Example 5: Token Withdraw Calculation

User wants to withdraw 75,000 DREAM to sats.

```
Rate:  10 DREAM per sat
Rounding: floor (withdraw favours platform)

sats_received = floor(75,000 / 10)
              = floor(7,500)
              = 7,500 sats
```

With a non-integer amount (e.g., 75,003 DREAM at rate 10):

```
sats_received = floor(75,003 / 10)
              = floor(7,500.3)
              = 7,500 sats
```

**Key**: `floor` ensures the platform never overpays. The 3 leftover DREAM remain in the user's balance.

---

## Example 6: Agent Job Full Lifecycle

An agent job that runs inference, generates images, and produces analytics.

### Step 1: Estimate

```
Inference:  200 requests * 10 * 10  =  20,000 sats
Image-gen:    5 images   * 10 * 100 =   5,000 sats
Analytics:   50 docs     * 10 * 5   =   2,500 sats
                                     ---------
Subtotal:                             27,500 sats
Hold (1.2x):                          33,000 sats

POST /pay/.estimate response:
{
  "estimated_sats": 27500,
  "hold_sats": 33000,
  "dream_tokens": 330000,
  "rate": 10,
  "breakdown": {
    "inference": 20000,
    "image_gen": 5000,
    "analytics": 2500
  }
}
```

### Step 2: Hold

33,000 sats (330,000 DREAM) locked in escrow. User cannot spend these tokens until the job settles or is cancelled.

### Step 3: Running

Job executes. Actual usage:
- Inference: 187 requests (13 cached, not billed)
- Image-gen: 5 images (all succeeded)
- Analytics: 48 docs (2 deduped)

### Step 4: Settle

```
Inference:  187 * 10 * 10  = 18,700 sats
Image-gen:    5 * 10 * 100 =  5,000 sats
Analytics:   48 * 10 * 5   =  2,400 sats
                            ---------
Settled total:               26,100 sats

Refund: 33,000 - 26,100 = 6,900 sats (69,000 DREAM)
```

**Result**: User pays 261,000 DREAM, gets 69,000 DREAM refunded from the hold.

---

## Example 7: Pre-flight Cost Check via curl

```bash
curl -X POST https://pod.dreamlab.ai/pay/.estimate \
  -H "Content-Type: application/json" \
  -H "Authorization: Nostr $(nostr-sign-nip98 POST /pay/.estimate)" \
  -d '{
    "endpoint": "inference",
    "units": 1000,
    "base_cost_sats": 10
  }'

# Response:
# {
#   "estimated_sats": 100000,
#   "hold_sats": 120000,
#   "dream_tokens": 1200000,
#   "rate": 10
# }
```

---

## Example 8: Custom Rate Override

Pod operator sets a premium rate for a high-demand GPU cluster:

```toml
# wrangler.toml
[vars]
BASE_COST_SATS = 25
INFERENCE_MULTIPLIER = 10
IMAGE_GEN_MULTIPLIER = 150   # premium diffusion model
ANALYTICS_MULTIPLIER = 5
DREAM_PER_SAT = 10
HOLD_BUFFER_RATIO = 1.3      # 30% buffer for volatile workloads
```

Single image-gen request at these rates:

```
Cost = 25 * 150 * 1 = 3,750 sats
Hold = 3,750 * 1.3  = 4,875 sats
DREAM (buy): ceil(4,875 * 10) = 48,750 DREAM
```
