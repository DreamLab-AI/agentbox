# Technical Architecture Mapper

Transforms technical systems, architectures, and infrastructure into Wardley maps.

## Architecture Patterns to Maps

### Microservices Architecture

```python
def microservices_to_wardley(services):
    components = []
    
    # API Gateway → User-facing
    components.append({
        'name': 'API Gateway',
        'visibility': 0.9,
        'evolution': 0.7  # Product
    })
    
    # Business Services → Middle tier
    for service in services['business']:
        components.append({
            'name': service['name'],
            'visibility': 0.6,
            'evolution': assess_service_maturity(service)
        })
    
    # Data Services → Lower tier
    for service in services['data']:
        components.append({
            'name': service['name'],
            'visibility': 0.3,
            'evolution': 0.6  # Usually product
        })
    
    # Infrastructure → Bottom
    components.append({
        'name': 'Container Orchestration',
        'visibility': 0.1,
        'evolution': 0.8  # Kubernetes = commodity
    })
```

### Cloud Architecture

| Component | Visibility | Evolution | Rationale |
|-----------|-----------|-----------|-----------|
| CDN | 0.8 | 0.9 | User-facing commodity |
| Load Balancer | 0.6 | 0.9 | Standard utility |
| Application Servers | 0.5 | 0.7 | Product stage |
| Databases | 0.3 | 0.6-0.9 | Depends on type |
| Object Storage | 0.2 | 0.9 | Commodity (S3) |
| Compute | 0.1 | 0.9 | Commodity (EC2) |

## Technology Stack Analysis

### Frontend Technologies
- React/Vue/Angular → Product (0.7)
- Custom UI Framework → Custom (0.4)
- HTML/CSS → Commodity (0.95)
- WebAssembly → Genesis-Custom (0.2)

### Backend Technologies
- REST APIs → Commodity (0.85)
- GraphQL → Product (0.6)
- gRPC → Product (0.65)
- Custom Protocol → Custom (0.3)

### Data Technologies
- PostgreSQL/MySQL → Commodity (0.9)
- MongoDB → Product (0.7)
- Graph Databases → Product (0.6)
- Custom Data Store → Custom (0.3)

### AI/ML Stack
- TensorFlow/PyTorch → Product (0.7)
- Custom Models → Custom (0.3)
- OpenAI API → Product-Commodity (0.75)
- Novel Architectures → Genesis (0.1)

## Code Analysis to Map

### Import Statements → Dependencies
```python
import boto3  # AWS → Commodity (0.9)
import tensorflow  # ML Framework → Product (0.7)
import custom_lib  # Internal → Custom (0.3)
```

### Architecture Patterns → Evolution
- Monolith → Custom-Product (0.4-0.6)
- SOA → Product (0.6-0.7)
- Microservices → Product (0.7)
- Serverless → Product-Commodity (0.7-0.8)
- Edge Computing → Custom-Product (0.4-0.6)

## Infrastructure Mapping

### On-Premise
```
User Applications (0.9, varies)
    ↓
Application Servers (0.5, 0.6)
    ↓
Virtualization (0.3, 0.8)
    ↓
Physical Servers (0.1, 0.7)
```

### Cloud-Native
```
User Interface (0.9, 0.7)
    ↓
API Layer (0.7, 0.8)
    ↓
Microservices (0.5, 0.7)
    ↓
Managed Services (0.3, 0.9)
    ↓
Cloud Platform (0.1, 0.9)
```

## DevOps & Toolchain

| Tool Category | Evolution | Examples |
|---------------|-----------|----------|
| Version Control | 0.95 | Git |
| CI/CD | 0.8 | Jenkins, GitHub Actions |
| Containers | 0.8 | Docker |
| Orchestration | 0.75 | Kubernetes |
| IaC | 0.7 | Terraform |
| Monitoring | 0.7 | Prometheus |
| Custom Tools | 0.3 | Internal scripts |

## Common Technical Patterns

### API-First Architecture
- External API (0.9, 0.7)
- API Gateway (0.7, 0.8)
- Business Logic (0.5, 0.5)
- Data Layer (0.3, 0.7)
- Infrastructure (0.1, 0.9)

### Event-Driven Architecture
- Event Sources (0.8, varies)
- Event Bus (0.6, 0.7)
- Event Handlers (0.4, 0.6)
- Event Store (0.2, 0.7)
- Message Queue (0.1, 0.8)