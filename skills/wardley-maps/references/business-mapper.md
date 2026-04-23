# Business Description Mapper

Transforms business descriptions, strategies, and models into Wardley maps.

## Pattern Recognition

### Key Phrases to Components

| Business Terms | Component Type | Evolution Hint |
|----------------|---------------|----------------|
| "competitive advantage" | Differentiator | Custom-Product |
| "core competency" | Capability | Product |
| "outsource" | Utility | Commodity |
| "innovate" | R&D Activity | Genesis-Custom |
| "platform" | Infrastructure | Product |
| "SaaS/API" | Service | Product-Commodity |
| "proprietary" | Asset | Custom |
| "industry standard" | Practice | Commodity |
| "emerging technology" | Technology | Genesis |
| "best practice" | Method | Product-Commodity |

## Extraction Process

### 1. Business Model Canvas → Wardley Map

```python
def canvas_to_wardley(canvas):
    components = []
    
    # Value Propositions → User needs (top)
    for vp in canvas['value_propositions']:
        components.append({
            'name': vp,
            'visibility': 0.95,
            'evolution': assess_market_maturity(vp)
        })
    
    # Key Resources → Components (middle)
    for resource in canvas['key_resources']:
        components.append({
            'name': resource,
            'visibility': 0.5,
            'evolution': assess_resource_commodity(resource)
        })
    
    # Key Partners → Dependencies (bottom)
    for partner in canvas['key_partners']:
        components.append({
            'name': partner,
            'visibility': 0.2,
            'evolution': 0.8  # Usually commodity
        })
```

### 2. Strategy Documents → Components

Look for:
- **Vision/Mission**: Defines user need
- **Goals**: High-visibility components
- **Initiatives**: Custom-Product activities
- **Operations**: Product-Commodity functions
- **Infrastructure**: Commodity components

### 3. Organizational Structure → Map

- C-Suite focus → Top of value chain
- Business units → Product components
- Shared services → Commodity components
- Innovation labs → Genesis components

## Industry-Specific Patterns

### Technology Companies
- User Experience → Top (0.9 visibility)
- Applications → Upper-middle (0.7)
- APIs/Services → Middle (0.5)
- Infrastructure → Bottom (0.2)

### Manufacturing
- Product Design → Top (0.9)
- Production → Middle (0.5)
- Supply Chain → Lower-middle (0.3)
- Logistics → Bottom (0.2)

### Financial Services
- Customer Products → Top (0.9)
- Risk Management → Middle (0.6)
- Compliance → Lower-middle (0.4)
- Core Banking → Bottom (0.2)

## Evolution Assessment Rules

### Genesis (0.0-0.2)
- "First of its kind"
- "Breakthrough"
- "Unprecedented"
- "Experimental"
- No competitors

### Custom (0.2-0.5)
- "Proprietary"
- "Differentiated"
- "Unique approach"
- "Competitive advantage"
- Few competitors

### Product (0.5-0.8)
- "Best-in-class"
- "Market leader"
- "Solution"
- "Platform"
- Many competitors

### Commodity (0.8-1.0)
- "Utility"
- "Standard"
- "Outsourced"
- "Cost center"
- Price competition

## Dependency Mapping

### Strong Dependencies (solid lines)
- "Depends on"
- "Requires"
- "Built on"
- "Powered by"

### Weak Dependencies (dashed lines)
- "Uses"
- "Leverages"
- "Integrates with"
- "Complements"

### Constraints (red lines)
- "Limited by"
- "Constrained by"
- "Blocked by"
- "Regulated by"

## Example: E-commerce Platform

Input: "We run an online marketplace connecting buyers and sellers. Our competitive advantage is our recommendation engine powered by proprietary AI. We use AWS for hosting and Stripe for payments."

Output Components:
- Online Marketplace (0.9 vis, 0.7 evo) - Product
- Recommendation Engine (0.8 vis, 0.4 evo) - Custom
- Proprietary AI (0.3 vis, 0.3 evo) - Custom
- AWS Hosting (0.1 vis, 0.9 evo) - Commodity
- Payment Processing (0.2 vis, 0.9 evo) - Commodity

## Validation Questions

1. Does every user-facing feature appear near the top?
2. Are commoditized services at the bottom?
3. Do custom components show clear differentiation?
4. Are all critical dependencies mapped?
5. Does evolution match market reality?