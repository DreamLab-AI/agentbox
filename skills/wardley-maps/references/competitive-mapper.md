# Competitive Analysis Mapper

Transform competitive landscapes and market analyses into strategic Wardley maps.

## Competitive Positioning

### Market Leader Indicators → Evolution Position
- "Market leader" → Product-Commodity (0.7-0.8)
- "Challenger" → Product (0.6-0.7)
- "Disruptor" → Custom (0.3-0.5)
- "New entrant" → Genesis-Custom (0.1-0.4)
- "Incumbent" → Product-Commodity (0.7-0.9)

### Competitive Advantage Types

| Advantage Type | Component Position | Evolution Stage |
|----------------|-------------------|-----------------|
| Cost Leadership | Low visibility (0.2-0.4) | Commodity (0.8-1.0) |
| Differentiation | High visibility (0.7-0.9) | Custom-Product (0.3-0.6) |
| Focus/Niche | Variable visibility | Custom (0.2-0.5) |
| Platform | Middle visibility (0.5-0.7) | Product (0.6-0.8) |
| Network Effects | High visibility (0.8-0.9) | Product (0.6-0.7) |

## Industry Analysis Framework

### Porter's Five Forces → Map Components

```python
def porters_to_wardley(analysis):
    components = []
    
    # Buyer Power → User needs (top)
    if analysis['buyer_power'] == 'high':
        components.append({
            'name': 'Customer Requirements',
            'visibility': 0.95,
            'evolution': 0.8  # Well-defined
        })
    
    # Supplier Power → Dependencies (bottom)
    for supplier in analysis['key_suppliers']:
        components.append({
            'name': supplier,
            'visibility': 0.2,
            'evolution': assess_supplier_power(supplier)
        })
    
    # Competitive Rivalry → Current offerings
    for competitor in analysis['competitors']:
        components.append({
            'name': f"{competitor} Solution",
            'visibility': 0.7,
            'evolution': assess_competitor_maturity(competitor)
        })
```

## Market Dynamics Patterns

### Disruption Indicators
- Legacy solution at high evolution (0.8+) + High cost
- New solution at low evolution (0.2-0.4) + Growing adoption
- Shift in user needs toward new solution

### Commoditization Signals
- Multiple providers (5+)
- Price-based competition
- Standardized features
- Low switching costs
→ Evolution position: 0.8-0.95

### Innovation Zones
- Unmet user needs
- Technical breakthroughs
- Regulatory changes
- Business model innovation
→ Evolution position: 0.0-0.3

## Competitive Strategy Patterns

### Red Ocean (Competitive)
```
Existing Market Need (0.9, 0.8)
    ↓
Competitor A Solution (0.7, 0.7)
Competitor B Solution (0.7, 0.7)
Our Solution (0.7, 0.7)
    ↓
Shared Infrastructure (0.2, 0.9)
```

### Blue Ocean (Uncontested)
```
New Market Need (0.9, 0.2)
    ↓
Our Innovation (0.7, 0.3)
    ↓
Unique Capabilities (0.4, 0.3)
    ↓
Commodity Infrastructure (0.1, 0.9)
```

## Strategic Moves Analysis

### Offensive Strategies
- **Leapfrog**: Jump to next evolution stage
- **Envelopment**: Expand scope to subsume competitors
- **Disruption**: Create new low-end or new-market foothold

### Defensive Strategies
- **Blocking**: Patent, exclusive deals
- **Raising Barriers**: Increase complexity/cost
- **Ecosystem Lock-in**: Network effects

## Market Maturity Assessment

### Emerging Markets (Genesis 0.0-0.2)
- No dominant design
- High uncertainty
- Few competitors
- Rapid innovation

### Growing Markets (Custom 0.2-0.5)
- Standards emerging
- Competition increasing
- Customer education needed
- Feature race

### Mature Markets (Product 0.5-0.8)
- Established players
- Feature parity
- Brand competition
- Consolidation

### Declining Markets (Commodity 0.8-1.0)
- Price competition
- Commodity providers
- Low margins
- Disruption vulnerable