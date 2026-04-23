# Strategic Patterns & Gameplay

Advanced patterns for strategic analysis and decision-making with Wardley maps.

## Core Strategic Movements

### 1. Commoditization Play
**Pattern**: Accelerate evolution of competitor's differentiator
```
Before:
Competitor Advantage (0.7, 0.4) - Custom
    ↓
Your Action: Open source equivalent

After:
Market Solution (0.7, 0.7) - Product/Commodity
```

### 2. Innovation Play
**Pattern**: Create new value at genesis while competitors fight in commodity```
Current Market:
Price War Zone (0.5, 0.9) - Commodity

Your Move:
New Capability (0.8, 0.1) - Genesis
    ↓
Unique Value Prop (0.9, 0.3) - Custom
```

### 3. Ecosystem Play
**Pattern**: Build platform at product stage to capture value
```
Platform Strategy:
Developer Ecosystem (0.9, 0.6)
    ↓
Your Platform (0.6, 0.6) - Product
    ↓         ↓
3rd Party   Core Services
(0.5, 0.5)  (0.4, 0.7)
```

## Doctrine Patterns

### Phase I - Stop the Bleeding
1. **Know your users** - Map their needs
2. **Focus on situational awareness** - Create first maps
3. **Remove duplication** - Identify redundant components
4. **Challenge assumptions** - Question everything

### Phase II - Becoming Competent
1. **Use appropriate methods** - Match method to evolution
2. **Think small teams** - Organize around components
3. **Distribute power** - Decentralize decisions
4. **Be transparent** - Share maps openly

### Phase III - Better for Less
1. **Manage inertia** - Identify resistance to change
2. **Exploit ecosystem** - Leverage external evolution
3. **Design for constant evolution** - Build adaptability

## Climatic Patterns (Forces of Change)

### Everything Evolves
```python
def predict_evolution(component, time_horizon_years):
    """Predict component evolution over time"""
    
    current = component['evolution']
    
    # Evolution speed factors
    if component['competition'] == 'high':
        speed = 0.1 * time_horizon_years
    elif component['competition'] == 'medium':
        speed = 0.05 * time_horizon_years
    else:
        speed = 0.02 * time_horizon_years
    
    # Evolution accelerates in middle stages
    if 0.3 < current < 0.7:
        speed *= 1.5
    
    future = min(1.0, current + speed)
    return future
```

### Past Success Breeds Inertia
**Indicators**:
- Component at 0.7+ evolution
- High investment/sunk cost
- Cultural attachment
- "Not invented here" syndrome

**Counter-strategies**:
- Create separate innovation units
- Acquire disruptors
- Cannibalize before competitors do

## Gameplay Patterns

### Fool's Mate
**Setup**: Competitor assumes component is commodity
**Move**: Differentiate "commodity" component
```
Expected: Database (0.3, 0.9)
Actual: Specialized DB (0.3, 0.5) with unique capabilities
Result: Competitive advantage
```

### Tower and Moat
**Setup**: Control scarce resource + build ecosystem
```
Scarce Resource (0.4, 0.3)
    ↑
Ecosystem Barrier (0.6, 0.5)
    ↑
User Lock-in (0.8, 0.6)
```

### Pincer Movement
**Setup**: Attack from both evolution extremes
```
Genesis Innovation (0.7, 0.1)
         ↓
    Target Market
         ↑
Commodity Platform (0.3, 0.9)
```

## Market Patterns

### Punctuated Equilibrium
Long periods of stability, then rapid change
```
Stable Period (Years 1-5):
- Component at 0.6, moving slowly

Disruption (Year 6):
- New player enters at 0.2
- Rapid evolution to 0.5 in 1 year
- Incumbents scramble
```

### Co-evolution
Components evolve together
```
If Mobile Apps (0.8, 0.7) evolve
Then Mobile Frameworks (0.5, 0.6) must evolve
And Development Tools (0.3, 0.5) follow
```

## Weak Signal Detection

### Genesis Signals
- Academic papers increasing
- VC investment in space
- Patent filings rising
- Talent migration
- Conference talks emerging

### Commodity Signals
- Price as main differentiator
- Standards bodies forming
- Consolidation/M&A
- Utility pricing models
- "Good enough" becoming acceptable

## Anti-Patterns (What Not to Do)

### 1. One-Size-Fits-All
❌ Using same approach for all evolution stages
✓ Match methods to evolution:
- Genesis: Agile/Lean
- Custom: Lean/Six Sigma
- Product: Six Sigma/Lean
- Commodity: Six Sigma/Outsource

### 2. Ignoring Ecosystem
❌ Building everything yourself
✓ Map the ecosystem

### 3. Fighting Evolution
❌ Trying to maintain custom advantage in commoditizing market
✓ Accept evolution and move up the stack

## Strategic Options by Position

### If You're Behind
1. **Leapfrog**: Skip evolutionary stages
2. **Disrupt**: Change the game
3. **Partner**: Leverage leader's investment
4. **Focus**: Dominate a niche

### If You're Ahead
1. **Accelerate**: Push market forward
2. **Patent/Lock**: Create barriers
3. **Ecosystem**: Build network effects
4. **Harvest**: Maximize current advantage

## Key Questions for Strategy

Before Acting:
1. Where will this component evolve to?
2. What will enable/constrain evolution?
3. Who else is making this move?
4. What becomes possible when this commoditizes?
5. Where is the next value creation?

After Mapping:
1. Where are we vulnerable?
2. Where can we attack?
3. What should we not do?
4. What assumptions are we making?
5. How will the map change?