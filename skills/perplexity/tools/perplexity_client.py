#!/usr/bin/env python3
"""
Perplexity AI Client - Optimized for UK-centric research
Supports real-time web search, source citations, and prompt optimization
"""

import os
import sys
import json
import requests
from typing import List, Dict, Optional, Literal
from dataclasses import dataclass, asdict
import time

@dataclass
class PerplexityConfig:
    """Configuration for Perplexity API"""
    api_key: str
    base_url: str = "https://api.perplexity.ai"
    model: str = "sonar"  # sonar, sonar-pro, sonar-reasoning
    temperature: float = 0.2
    max_tokens: int = 4096
    timeout: int = 60

class PerplexityClient:
    """Client for Perplexity AI API with prompt optimization"""

    MODELS = {
        "sonar": "sonar",  # Fast, balanced
        "sonar-pro": "sonar-pro",  # Deep research
        "sonar-reasoning": "sonar-reasoning",  # Complex analysis
    }

    def __init__(self, config: Optional[PerplexityConfig] = None):
        if config is None:
            api_key = os.getenv("PERPLEXITY_API_KEY")
            if not api_key:
                raise ValueError("PERPLEXITY_API_KEY environment variable not set")
            config = PerplexityConfig(api_key=api_key)

        self.config = config
        self.session = requests.Session()
        self.session.headers.update({
            "Authorization": f"Bearer {self.config.api_key}",
            "Content-Type": "application/json"
        })

    def search(
        self,
        query: str,
        model: Optional[str] = None,
        return_images: bool = False,
        return_related_questions: bool = False,
        search_recency_filter: Optional[Literal["day", "week", "month", "year"]] = None,
        top_k: int = 5,
        temperature: Optional[float] = None,
    ) -> Dict:
        """
        Quick search with citations

        Args:
            query: Search query
            model: Model to use (sonar, sonar-pro, sonar-reasoning)
            return_images: Include image results
            return_related_questions: Include related questions
            search_recency_filter: Time filter (day, week, month, year)
            top_k: Number of sources to return
            temperature: Response creativity (0.0-1.0)

        Returns:
            Dictionary with content, citations, and metadata
        """
        endpoint = f"{self.config.base_url}/chat/completions"

        payload = {
            "model": model or self.config.model,
            "messages": [
                {
                    "role": "system",
                    "content": "You are a research assistant providing accurate, cited information with UK/European context where relevant."
                },
                {
                    "role": "user",
                    "content": query
                }
            ],
            "temperature": temperature or self.config.temperature,
            "max_tokens": self.config.max_tokens,
            "return_citations": True,
            "return_images": return_images,
            "return_related_questions": return_related_questions,
            "top_k": top_k,
        }

        if search_recency_filter:
            payload["search_recency_filter"] = search_recency_filter

        try:
            response = self.session.post(
                endpoint,
                json=payload,
                timeout=self.config.timeout
            )
            response.raise_for_status()
            return response.json()
        except requests.exceptions.RequestException as e:
            return {
                "error": str(e),
                "status_code": getattr(e.response, "status_code", None)
            }

    def research(
        self,
        topic: str,
        context: Optional[str] = None,
        output_format: Literal["prose", "table", "bullet", "executive", "report"] = "prose",
        uk_focus: bool = True,
        timeframe: Optional[str] = None,
        num_sources: int = 10,
    ) -> Dict:
        """
        Deep research with structured output

        Args:
            topic: Research topic
            context: Additional context
            output_format: How to format results
            uk_focus: Prioritize UK/EU sources
            timeframe: Recency filter
            num_sources: Number of sources to cite

        Returns:
            Research results with citations
        """
        # Build optimized prompt
        prompt_parts = []

        if context:
            prompt_parts.append(f"Context: {context}")

        prompt_parts.append(f"Research topic: {topic}")

        if uk_focus:
            prompt_parts.append("Geographic focus: United Kingdom and European Union")
            prompt_parts.append("Use British English spelling and terminology")
            prompt_parts.append("Prioritize .gov.uk, .ac.uk, and UK/EU sources")

        if timeframe:
            prompt_parts.append(f"Time constraint: Focus on sources from the last {timeframe}")

        # Output format instructions
        format_instructions = {
            "prose": "Provide a comprehensive narrative summary",
            "table": "Format as a markdown table with columns for key attributes",
            "bullet": "Provide concise bullet points organized by theme",
            "executive": "Create an executive summary with TL;DR, key findings, and recommendations",
            "report": "Generate a full research report with introduction, findings, analysis, and conclusion"
        }

        prompt_parts.append(f"Output format: {format_instructions[output_format]}")
        prompt_parts.append(f"Include at least {num_sources} diverse, credible sources")
        prompt_parts.append("Cite all sources with URLs")

        query = "\n\n".join(prompt_parts)

        return self.search(
            query=query,
            model="sonar-pro",  # Use deep research model
            return_related_questions=True,
            search_recency_filter=timeframe,
            top_k=num_sources,
        )

    def generate_prompt(
        self,
        goal: str,
        context: Optional[str] = None,
        constraints: Optional[List[str]] = None,
        uk_focus: bool = True,
    ) -> str:
        """
        Generate optimized Perplexity prompt using five-element framework

        Args:
            goal: What you want to achieve
            context: Background information
            constraints: Specific requirements
            uk_focus: Add UK/EU context

        Returns:
            Optimized prompt string
        """
        prompt_elements = []

        # 1. Instruction
        prompt_elements.append(f"Task: {goal}")

        # 2. Context
        if context:
            prompt_elements.append(f"\nContext: {context}")

        # 3. Input (constraints)
        if constraints:
            prompt_elements.append("\nConstraints:")
            for constraint in constraints:
                prompt_elements.append(f"- {constraint}")

        # 4. Keywords & Focus
        if uk_focus:
            prompt_elements.append("\nGeographic focus: United Kingdom and European Union")
            prompt_elements.append("Use British English (organisation, colour, programme, etc.)")
            prompt_elements.append("Prioritise UK regulations, laws, and market conditions")

        # 5. Output format
        prompt_elements.append("\nDeliverable: Comprehensive response with:")
        prompt_elements.append("- Key findings supported by evidence")
        prompt_elements.append("- Source citations with URLs")
        prompt_elements.append("- Actionable recommendations where applicable")
        prompt_elements.append("- UK/European context where relevant")

        return "\n".join(prompt_elements)

    def validate_sources(self, response: Dict) -> List[Dict]:
        """
        Extract and validate source citations

        Args:
            response: Perplexity API response

        Returns:
            List of validated sources
        """
        sources = []

        if "citations" in response:
            for i, url in enumerate(response.get("citations", [])):
                source = {
                    "index": i + 1,
                    "url": url,
                    "credible": self._assess_credibility(url),
                    "uk_source": self._is_uk_source(url)
                }
                sources.append(source)

        return sources

    def _assess_credibility(self, url: str) -> str:
        """Assess source credibility based on domain"""
        high_credibility_domains = [
            ".gov.uk", ".gov", ".ac.uk", ".edu",
            "bbc.co.uk", "ft.com", "economist.com",
            "nature.com", "science.org", "arxiv.org"
        ]

        medium_credibility_domains = [
            ".org", "reuters.com", "bloomberg.com",
            "theguardian.com", "telegraph.co.uk"
        ]

        url_lower = url.lower()

        for domain in high_credibility_domains:
            if domain in url_lower:
                return "high"

        for domain in medium_credibility_domains:
            if domain in url_lower:
                return "medium"

        return "check"

    def _is_uk_source(self, url: str) -> bool:
        """Check if source is UK-based"""
        uk_tlds = [".uk", ".gov.uk", ".ac.uk", ".co.uk", ".org.uk"]
        return any(tld in url.lower() for tld in uk_tlds)


def main():
    """CLI interface for testing"""
    import argparse

    parser = argparse.ArgumentParser(description="Perplexity AI Research Client")
    parser.add_argument("query", help="Search query or research topic")
    parser.add_argument("--mode", choices=["search", "research", "generate"], default="search")
    parser.add_argument("--model", choices=["sonar", "sonar-pro", "sonar-reasoning"], default="sonar")
    parser.add_argument("--format", choices=["prose", "table", "bullet", "executive", "report"], default="prose")
    parser.add_argument("--uk-focus", action="store_true", help="Enable UK/EU focus")
    parser.add_argument("--timeframe", choices=["day", "week", "month", "year"], help="Recency filter")
    parser.add_argument("--sources", type=int, default=10, help="Number of sources")
    parser.add_argument("--context", help="Additional context")

    args = parser.parse_args()

    try:
        client = PerplexityClient()

        if args.mode == "search":
            result = client.search(
                query=args.query,
                model=args.model,
                search_recency_filter=args.timeframe,
                top_k=args.sources
            )
        elif args.mode == "research":
            result = client.research(
                topic=args.query,
                context=args.context,
                output_format=args.format,
                uk_focus=args.uk_focus,
                timeframe=args.timeframe,
                num_sources=args.sources
            )
        else:  # generate
            prompt = client.generate_prompt(
                goal=args.query,
                context=args.context,
                uk_focus=args.uk_focus
            )
            result = {"optimized_prompt": prompt}

        print(json.dumps(result, indent=2))

    except Exception as e:
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
