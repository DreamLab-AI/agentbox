"""
Ontology Enrich Skill

In-place validation, enrichment, and maintenance of ontology files.
Layer 1 skill that imports ontology-core for all parsing/modification.
"""

from .enrichment_workflow import (
    EnrichmentWorkflow,
    EnrichmentResult,
    EnrichmentConfig
)
from .perplexity_client import (
    PerplexityClient,
    EnrichedContent,
    Citation,
    PerplexityAPIError
)
from .link_validator import (
    LinkValidator,
    LinkReport
)

__all__ = [
    'EnrichmentWorkflow',
    'EnrichmentResult',
    'EnrichmentConfig',
    'PerplexityClient',
    'EnrichedContent',
    'Citation',
    'PerplexityAPIError',
    'LinkValidator',
    'LinkReport'
]

__version__ = '1.0.0'
