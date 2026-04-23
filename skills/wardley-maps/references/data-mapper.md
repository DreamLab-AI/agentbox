# Data & Metrics Mapper

Transform structured data, KPIs, and metrics into strategic Wardley maps.

## Data Types to Map Components

### Financial Metrics

| Metric Type | Component Inference | Evolution Signal |
|-------------|-------------------|------------------|
| High Margin % | Differentiated offering | Custom (0.3-0.5) |
| Low Margin % | Commodity service | Commodity (0.8-0.95) |
| R&D Spend % | Innovation focus | Genesis-Custom (0.1-0.4) |
| OpEx Heavy | Operational focus | Product-Commodity (0.6-0.9) |
| CapEx Heavy | Infrastructure build | Custom-Product (0.4-0.7) |

### Operational Metrics

```python
def metrics_to_evolution(metrics):
    """Convert operational metrics to evolution positions"""
    
    evolution_scores = {}
    
    # Automation level indicates evolution
    if metrics['automation_percentage'] > 80:
        evolution_scores['operations'] = 0.8  # Highly evolved
    elif metrics['automation_percentage'] > 50:
        evolution_scores['operations'] = 0.6  # Product stage
    else:
        evolution_scores['operations'] = 0.4  # Custom stage
    
    # Error rates indicate maturity
    if metrics['error_rate'] < 0.1:
        evolution_scores['reliability'] = 0.8
    elif metrics['error_rate'] < 1:
        evolution_scores['reliability'] = 0.6
    else:
        evolution_scores['reliability'] = 0.3
    
    return evolution_scores
```

## Database Schema Analysis

### Table Relationships → Component Dependencies

```python
def schema_to_wardley(schema):
    components = []
    dependencies = []
    
    for table in schema['tables']:
        # Core business entities are more visible
        if table['name'] in ['users', 'customers', 'orders']:
            visibility = 0.8
        # System tables are invisible
        elif table['name'].startswith('sys_'):
            visibility = 0.1
        else:
            visibility = 0.5
        
        # Assess evolution by standardization
        if table['structure'] == 'standard':
            evolution = 0.8
        elif table['custom_fields'] > 5:
            evolution = 0.4
        else:
            evolution = 0.6
        
        components.append({
            'name': table['name'],
            'visibility': visibility,
            'evolution': evolution
        })
```

## API Analytics

### Endpoint Usage → Component Importance

| Usage Pattern | Visibility | Evolution |
|---------------|-----------|-----------|
| High volume, stable | 0.9 | 0.8 |
| Growing rapidly | 0.7 | 0.5 |
| Experimental | 0.4 | 0.2 |
| Deprecated | 0.2 | 0.9 |

## Performance Metrics

### System Performance → Evolution

```python
def performance_to_evolution(perf_data):
    """Map performance characteristics to evolution"""
    
    evolution_indicators = {
        'uptime': {
            99.999: 0.9,  # Five nines = commodity
            99.99: 0.8,   # Four nines = product
            99.9: 0.6,    # Three nines = custom
            99.0: 0.4     # Two nines = early
        },
        'scalability': {
            'infinite': 0.9,  # Cloud-native
            'horizontal': 0.7,  # Distributed
            'vertical': 0.5,   # Monolithic
            'limited': 0.3     # Prototype
        }
    }
    
    return map_to_evolution(perf_data, evolution_indicators)
```

## User Analytics

### User Journey → Value Chain

```python
def journey_to_value_chain(journey_data):
    components = []
    
    for step_index, step in enumerate(journey_data['steps']):
        # Earlier steps are more visible
        visibility = 1.0 - (step_index * 0.1)
        visibility = max(0.3, visibility)
        
        # Assess evolution by completion rate
        if step['completion_rate'] > 0.95:
            evolution = 0.8  # Smooth/commodity
        elif step['completion_rate'] > 0.8:
            evolution = 0.6  # Working product
        else:
            evolution = 0.4  # Needs improvement
        
        components.append({
            'name': step['name'],
            'visibility': visibility,
            'evolution': evolution
        })
    
    return components```

## Key Data Patterns

### Signals of Evolution

**Genesis (0.0-0.2)**
- High variance in metrics
- Frequent failures
- Manual processes
- No standards

**Custom (0.2-0.5)**
- Improving metrics
- Some automation
- Emerging patterns
- Local optimization

**Product (0.5-0.8)**
- Stable metrics
- Automated processes
- Industry standards
- Global optimization

**Commodity (0.8-1.0)**
- Predictable metrics
- Full automation
- Universal standards
- Utility pricing