"""
Perplexity API client for content enrichment with UK English focus.

Handles API requests, citation extraction, and structured content generation.
"""

import logging
import os
from typing import Optional, List, Dict, Any
from dataclasses import dataclass
import requests
import time

logger = logging.getLogger(__name__)


@dataclass
class Citation:
    """Structured citation from Perplexity API."""
    source: str
    url: Optional[str]
    relevance: float
    snippet: Optional[str] = None


@dataclass
class EnrichedContent:
    """Enriched content with citations and metadata."""
    definition: str
    citations: List[Dict[str, Any]]
    related_concepts: List[str]
    confidence: float


class PerplexityAPIError(Exception):
    """Perplexity API request error."""
    pass


class PerplexityClient:
    """
    Client for Perplexity API with UK English focus and citation extraction.

    Uses llama-3.1-sonar-large-128k-online model for current information.
    """

    API_BASE = "https://api.perplexity.ai"
    DEFAULT_MODEL = "llama-3.1-sonar-large-128k-online"

    def __init__(
        self,
        api_key: str,
        model: str = DEFAULT_MODEL,
        temperature: float = 0.2,
        max_tokens: int = 2000
    ):
        """
        Initialize Perplexity API client.

        Args:
            api_key: Perplexity API key
            model: Model to use for requests
            temperature: Sampling temperature (0.0-1.0)
            max_tokens: Maximum tokens in response
        """
        self.api_key = api_key
        self.model = model
        self.temperature = temperature
        self.max_tokens = max_tokens

        self.session = requests.Session()
        self.session.headers.update({
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        })

        logger.info(f"PerplexityClient initialized with model: {model}")

    def enrich_definition(
        self,
        current_def: str,
        context: str,
        uk_english: bool = True
    ) -> EnrichedContent:
        """
        Enrich ontology definition with Perplexity API content.

        Args:
            current_def: Current definition text
            context: Concept context (usually the title)
            uk_english: Use UK English preferences

        Returns:
            EnrichedContent with enhanced definition and citations
        """
        logger.info(f"Enriching definition for context: {context}")

        # Construct UK English-focused prompt
        prompt = self._build_enrichment_prompt(
            current_def,
            context,
            uk_english
        )

        # Query API with retries
        response = self._query_with_retries(prompt)

        # Extract structured content
        enriched = self._parse_response(response)

        logger.info(f"✓ Enriched with {len(enriched.citations)} citations")
        return enriched

    def _build_enrichment_prompt(
        self,
        current_def: str,
        context: str,
        uk_english: bool
    ) -> str:
        """
        Build enrichment prompt with UK English focus.

        Args:
            current_def: Current definition
            context: Concept context
            uk_english: Use UK English preferences

        Returns:
            Formatted prompt string
        """
        uk_directive = ""
        if uk_english:
            uk_directive = """
LANGUAGE REQUIREMENTS:
- Use British English spelling (e.g., "behaviour", "optimise", "colour")
- Use British terminology and conventions
- Prefer UK-based examples and sources where available
"""

        prompt = f"""Context: UK-based technical documentation for AI systems ontology.

{uk_directive}

TASK: Enrich the following ontology definition for the concept "{context}".

CURRENT DEFINITION:
{current_def}

REQUIREMENTS:
1. Provide a clear, technical explanation suitable for an ontology
2. Include real-world examples from the UK tech sector where relevant
3. Cite authoritative sources (academic papers, standards, technical documentation)
4. Identify 2-3 related concepts that should be cross-referenced
5. Maintain technical accuracy while improving clarity

OUTPUT FORMAT:
Respond ONLY with valid JSON in this exact structure:
{{
    "definition": "Enhanced definition text here...",
    "citations": [
        {{
            "source": "Source name",
            "url": "https://...",
            "relevance": 0.95,
            "snippet": "Relevant quote"
        }}
    ],
    "related_concepts": ["Concept1", "Concept2"],
    "confidence": 0.9
}}

Do not include any text outside the JSON structure."""

        return prompt

    def _query_with_retries(
        self,
        prompt: str,
        max_retries: int = 3,
        backoff_factor: float = 2.0
    ) -> Dict[str, Any]:
        """
        Query Perplexity API with exponential backoff retries.

        Args:
            prompt: Prompt text
            max_retries: Maximum retry attempts
            backoff_factor: Exponential backoff multiplier

        Returns:
            API response JSON

        Raises:
            PerplexityAPIError: If all retries fail
        """
        for attempt in range(max_retries):
            try:
                response = self.session.post(
                    f"{self.API_BASE}/chat/completions",
                    json={
                        "model": self.model,
                        "messages": [
                            {
                                "role": "system",
                                "content": "You are a technical ontology expert specializing in AI systems documentation with UK English preferences."
                            },
                            {
                                "role": "user",
                                "content": prompt
                            }
                        ],
                        "temperature": self.temperature,
                        "max_tokens": self.max_tokens,
                        "return_citations": True,
                        "return_related_questions": True
                    },
                    timeout=30
                )

                response.raise_for_status()
                return response.json()

            except requests.exceptions.RequestException as e:
                logger.warning(f"API request failed (attempt {attempt + 1}/{max_retries}): {e}")

                if attempt < max_retries - 1:
                    sleep_time = backoff_factor ** attempt
                    logger.info(f"⏳ Retrying in {sleep_time:.1f}s...")
                    time.sleep(sleep_time)
                else:
                    raise PerplexityAPIError(f"API request failed after {max_retries} attempts: {e}")

    def _parse_response(self, response: Dict[str, Any]) -> EnrichedContent:
        """
        Parse API response into EnrichedContent.

        Args:
            response: API response JSON

        Returns:
            EnrichedContent with parsed data

        Raises:
            PerplexityAPIError: If response parsing fails
        """
        try:
            import json

            # Extract message content
            content = response['choices'][0]['message']['content']

            # Parse JSON response
            # Remove markdown code blocks if present
            if content.strip().startswith('```'):
                # Extract JSON from markdown code block
                lines = content.strip().split('\n')
                json_lines = []
                in_block = False
                for line in lines:
                    if line.strip().startswith('```'):
                        in_block = not in_block
                        continue
                    if in_block or (not line.strip().startswith('```')):
                        json_lines.append(line)
                content = '\n'.join(json_lines)

            data = json.loads(content)

            # Validate required fields
            required_fields = ['definition', 'citations', 'related_concepts']
            for field in required_fields:
                if field not in data:
                    raise ValueError(f"Missing required field: {field}")

            # Extract citations from API metadata if available
            api_citations = response.get('citations', [])

            # Merge structured citations with API citations
            citations = []
            for cite in data['citations']:
                citations.append({
                    'source': cite.get('source', ''),
                    'url': cite.get('url'),
                    'relevance': cite.get('relevance', 0.5),
                    'snippet': cite.get('snippet')
                })

            # Add API citations if not already included
            for api_cite in api_citations:
                if api_cite not in [c['url'] for c in citations if c['url']]:
                    citations.append({
                        'source': 'Perplexity Source',
                        'url': api_cite,
                        'relevance': 0.7,
                        'snippet': None
                    })

            return EnrichedContent(
                definition=data['definition'],
                citations=citations,
                related_concepts=data['related_concepts'],
                confidence=data.get('confidence', 0.8)
            )

        except (KeyError, json.JSONDecodeError, ValueError) as e:
            logger.error(f"Response parsing error: {e}")
            logger.debug(f"Response content: {response}")
            raise PerplexityAPIError(f"Failed to parse API response: {e}")

    def extract_citations(self, response: Dict[str, Any]) -> List[Citation]:
        """
        Extract structured citations from API response.

        Args:
            response: API response JSON

        Returns:
            List of Citation objects
        """
        citations = []

        # Extract from response metadata
        if 'citations' in response:
            for url in response['citations']:
                citations.append(Citation(
                    source="Perplexity Source",
                    url=url,
                    relevance=0.7
                ))

        return citations
