#!/usr/bin/env python3
"""
Demonstration: Wardley Mapping a Complex AI-Powered Business
This shows how the skill can transform any business description into a strategic map
"""

import sys
import os
sys.path.append('/mnt/user-data/outputs/wardley-mapper-skill/scripts')
from generate_wardley_map import WardleyMapGenerator

# Complex business description
business_description = """
We're building an AI-powered knowledge management platform called VisionFlow. 
Our users are enterprise R&D teams who need to manage massive amounts of unstructured data.

The platform features:
- A cutting-edge graph-based knowledge representation using our proprietary ontology system
- Multi-agent AI orchestration for autonomous research and analysis
- Integration with existing tools like Logseq and Obsidian through custom plugins
- A vector database for semantic search powered by embeddings
- Real-time collaboration features for distributed teams
- Advanced visualization using immersive XR technologies (still experimental)

We leverage:
- Open-source LLMs fine-tuned on domain-specific data
- Kubernetes for container orchestration
- GraphRAG for enhanced retrieval
- Cloud infrastructure (primarily AWS)
- Standard authentication via OAuth2
- PostgreSQL for structured data
- Redis for caching

Our competitive advantages:
- Proprietary knowledge graph algorithms
- Custom multi-agent orchestration framework
- Industry-specific ontologies we've developed
- Integration with specialized R&D tools

The market is moving toward AI-assisted knowledge work, but most solutions are still
generic. We're focusing on the R&D vertical with deep domain expertise.
"""

# Parse and create components
components = [
    # User-facing components (high visibility)
    {"name": "VisionFlow Platform", "visibility": 0.95, "evolution": 0.4, "type": "user"},
    {"name": "User Interface", "visibility": 0.90, "evolution": 0.6},
    {"name": "XR Visualization", "visibility": 0.85, "evolution": 0.15, "type": "custom"},
    {"name": "Real-time Collaboration", "visibility": 0.85, "evolution": 0.65},
    {"name": "Plugin Ecosystem", "visibility": 0.80, "evolution": 0.5},
    
    # Core differentiators (medium-high visibility)
    {"name": "Knowledge Graph", "visibility": 0.70, "evolution": 0.35, "type": "custom"},
    {"name": "Multi-Agent Orchestration", "visibility": 0.65, "evolution": 0.25, "type": "custom"},
    {"name": "Domain Ontologies", "visibility": 0.60, "evolution": 0.3, "type": "custom"},
    {"name": "GraphRAG System", "visibility": 0.55, "evolution": 0.4},
    
    # AI/ML Components (medium visibility)
    {"name": "Fine-tuned LLMs", "visibility": 0.50, "evolution": 0.45},
    {"name": "Vector Database", "visibility": 0.45, "evolution": 0.6, "type": "product"},
    {"name": "Semantic Search", "visibility": 0.55, "evolution": 0.55},
    
    # Integration layer (medium visibility)
    {"name": "Tool Integrations", "visibility": 0.60, "evolution": 0.5},
    {"name": "API Layer", "visibility": 0.50, "evolution": 0.7},
    
    # Data layer (lower visibility)
    {"name": "PostgreSQL", "visibility": 0.30, "evolution": 0.9, "type": "commodity"},
    {"name": "Redis Cache", "visibility": 0.25, "evolution": 0.85, "type": "commodity"},
    
    # Infrastructure (low visibility)
    {"name": "Kubernetes", "visibility": 0.20, "evolution": 0.75, "type": "commodity"},
    {"name": "OAuth2", "visibility": 0.35, "evolution": 0.85, "type": "commodity"},
    {"name": "AWS Cloud", "visibility": 0.10, "evolution": 0.9, "type": "commodity"}
]

# Define dependencies
dependencies = [
    # Platform dependencies
    ("VisionFlow Platform", "User Interface"),
    ("User Interface", "XR Visualization"),
    ("User Interface", "Real-time Collaboration"),
    ("VisionFlow Platform", "Plugin Ecosystem"),
    
    # Core system dependencies
    ("VisionFlow Platform", "Knowledge Graph"),
    ("Knowledge Graph", "Multi-Agent Orchestration"),
    ("Knowledge Graph", "Domain Ontologies"),
    ("Knowledge Graph", "GraphRAG System"),
    
    # AI dependencies
    ("Multi-Agent Orchestration", "Fine-tuned LLMs"),
    ("GraphRAG System", "Vector Database"),
    ("GraphRAG System", "Semantic Search"),
    ("Semantic Search", "Vector Database"),
    
    # Integration dependencies
    ("Plugin Ecosystem", "Tool Integrations"),
    ("Tool Integrations", "API Layer"),
    
    # Data dependencies
    ("Knowledge Graph", "PostgreSQL"),
    ("Real-time Collaboration", "Redis Cache"),
    ("Vector Database", "PostgreSQL"),
    
    # Infrastructure dependencies
    ("API Layer", "OAuth2"),
    ("PostgreSQL", "AWS Cloud"),
    ("Redis Cache", "AWS Cloud"),
    ("Fine-tuned LLMs", "Kubernetes"),
    ("Kubernetes", "AWS Cloud")
]

# Generate the map
generator = WardleyMapGenerator(width=1000, height=700)
html_map = generator.create_map(components, dependencies)

# Save the map
output_file = '/mnt/user-data/outputs/visionflow_wardley_map.html'
with open(output_file, 'w') as f:
    f.write(html_map)

# Also create a strategic analysis
analysis = """
# Strategic Analysis: VisionFlow Platform

## Current Position
- **Genesis Components (0.0-0.2)**: XR Visualization
- **Custom Components (0.2-0.5)**: Multi-Agent Orchestration, Domain Ontologies, Knowledge Graph, GraphRAG
- **Product Components (0.5-0.8)**: UI, Collaboration, LLMs, Vector DB, API Layer
- **Commodity Components (0.8-1.0)**: PostgreSQL, Redis, OAuth2, AWS

## Strategic Insights

### Strengths
1. **Innovation Focus**: Strong position in genesis/custom (XR, Multi-Agent AI)
2. **Domain Expertise**: Proprietary ontologies create competitive moat
3. **Platform Strategy**: Plugin ecosystem enables growth

### Vulnerabilities
1. **XR Dependency**: Very early stage (0.15) - high risk
2. **Custom Heavy**: Many custom components increase maintenance burden
3. **Commodity Foundation**: Dependent on standard infrastructure (good for scale)

### Opportunities
1. **GraphRAG Evolution**: As it matures (0.4→0.6), could become industry standard
2. **Platform Network Effects**: Plugin ecosystem could drive adoption
3. **XR First-Mover**: If XR succeeds, significant competitive advantage

### Threats
1. **Big Tech Entry**: Major players could commoditize knowledge graphs
2. **Open Source Risk**: Custom components could be replicated in open source
3. **Evolution Speed**: Fast-moving AI landscape could obsolete advantages

## Recommended Strategic Moves

### Short Term (6 months)
1. **Accelerate GraphRAG**: Push toward product stage (0.4→0.6)
2. **Expand Plugin Ecosystem**: Build partner network
3. **Stabilize Core**: Move Multi-Agent from 0.25→0.35

### Medium Term (12 months)
1. **Platform Play**: Position as industry standard for R&D
2. **Open Source Strategy**: Consider opening some components
3. **Acquisition Targets**: Look for complementary XR capabilities

### Long Term (24 months)
1. **Ecosystem Dominance**: Become the "AWS of Knowledge Management"
2. **Vertical Expansion**: Apply platform to adjacent industries
3. **AI Commoditization**: Prepare for LLMs becoming utilities

## Key Metrics to Track
- Component evolution velocity
- Ecosystem partner growth
- User adoption of custom features
- Competitive movements in knowledge graph space
- XR technology maturation rate
"""

# Save the analysis
with open('/mnt/user-data/outputs/visionflow_analysis.md', 'w') as f:
    f.write(analysis)

print("✅ Wardley Map Demonstration Complete!")
print(f"📊 Visual Map: visionflow_wardley_map.html")
print(f"📝 Strategic Analysis: visionflow_analysis.md")
print("\nThis demonstrates how the Wardley Mapper skill can:")
print("1. Parse complex business descriptions")
print("2. Identify and position components on evolution axis")
print("3. Map dependencies and relationships")
print("4. Generate visual strategic maps")
print("5. Provide strategic analysis and recommendations")