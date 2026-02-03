#!/usr/bin/env python3
"""
Gemini URL Context MCP Server - FastMCP Implementation

Expands and analyzes URLs using Google Gemini 2.5 Flash URL Context API.
Supports single URL expansion, batch processing, comparison, and data extraction.

API Docs: https://ai.google.dev/gemini-api/docs/url-context
"""

import os
import json
import logging
from typing import Optional, List, Dict, Any

import httpx
from mcp.server.fastmcp import FastMCP
from pydantic import BaseModel, Field, field_validator

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger("gemini-url-context")

# Environment configuration
GEMINI_API_KEY = os.environ.get("GOOGLE_GEMINI_API_KEY", "")
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")
GEMINI_TIMEOUT = int(os.environ.get("GEMINI_TIMEOUT", "60"))
GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta"

# Initialize FastMCP server
mcp = FastMCP(
    "gemini-url-context",
    version="1.0.0",
    description="Expand and analyze URLs using Google Gemini 2.5 Flash URL Context API"
)

# =============================================================================
# Pydantic Models
# =============================================================================

class ExpandUrlParams(BaseModel):
    """Parameters for single URL expansion."""
    url: str = Field(..., description="URL to expand and analyze")
    prompt: str = Field(
        default="Summarize the main content and key points from this URL",
        description="What to extract or analyze from the URL"
    )
    include_metadata: bool = Field(default=True, description="Include grounding metadata in response")

    @field_validator('url')
    @classmethod
    def validate_url(cls, v: str) -> str:
        if not v.startswith(('http://', 'https://')):
            v = 'https://' + v
        return v


class ExpandUrlsParams(BaseModel):
    """Parameters for batch URL expansion."""
    urls: List[str] = Field(..., description="List of URLs to expand (max 20)")
    prompt: str = Field(
        default="Summarize the content from each URL",
        description="What to extract or analyze from the URLs"
    )
    include_metadata: bool = Field(default=True, description="Include grounding metadata")

    @field_validator('urls')
    @classmethod
    def validate_urls(cls, v: List[str]) -> List[str]:
        if len(v) > 20:
            raise ValueError("Maximum 20 URLs per request")
        return [url if url.startswith(('http://', 'https://')) else f'https://{url}' for url in v]


class CompareUrlsParams(BaseModel):
    """Parameters for URL comparison."""
    urls: List[str] = Field(..., description="URLs to compare (2-20)")
    aspects: List[str] = Field(
        default=["features", "content", "differences"],
        description="Aspects to compare"
    )
    format: str = Field(default="markdown", description="Output format: markdown, json, plain")

    @field_validator('urls')
    @classmethod
    def validate_urls(cls, v: List[str]) -> List[str]:
        if len(v) < 2:
            raise ValueError("Need at least 2 URLs to compare")
        if len(v) > 20:
            raise ValueError("Maximum 20 URLs per request")
        return [url if url.startswith(('http://', 'https://')) else f'https://{url}' for url in v]


class ExtractFromUrlParams(BaseModel):
    """Parameters for structured data extraction."""
    url: str = Field(..., description="URL to extract data from")
    schema: Dict[str, str] = Field(
        ...,
        description="Schema defining what to extract: {field_name: description}"
    )
    format: str = Field(default="json", description="Output format: json, yaml, markdown")

    @field_validator('url')
    @classmethod
    def validate_url(cls, v: str) -> str:
        if not v.startswith(('http://', 'https://')):
            v = 'https://' + v
        return v


# =============================================================================
# Helper Functions
# =============================================================================

async def call_gemini(prompt: str, urls: List[str] = None) -> dict:
    """Call Gemini API with URL context tool."""
    if not GEMINI_API_KEY:
        return {
            "success": False,
            "error": "GOOGLE_GEMINI_API_KEY not set. Export it or add to .env"
        }

    # Build the prompt with URLs embedded
    if urls:
        url_text = "\n".join(urls)
        full_prompt = f"{prompt}\n\nURLs to analyze:\n{url_text}"
    else:
        full_prompt = prompt

    payload = {
        "contents": [{
            "parts": [{
                "text": full_prompt
            }]
        }],
        "tools": [{"url_context": {}}]
    }

    endpoint = f"{GEMINI_API_BASE}/models/{GEMINI_MODEL}:generateContent?key={GEMINI_API_KEY}"

    async with httpx.AsyncClient(timeout=GEMINI_TIMEOUT) as client:
        try:
            response = await client.post(
                endpoint,
                json=payload,
                headers={"Content-Type": "application/json"}
            )

            if response.status_code == 200:
                data = response.json()

                # Extract response content
                candidate = data.get("candidates", [{}])[0]
                content = candidate.get("content", {})
                parts = content.get("parts", [{}])
                text = parts[0].get("text", "") if parts else ""

                # Extract metadata
                grounding = candidate.get("groundingMetadata", {})
                url_metadata = candidate.get("urlContextMetadata", {})
                usage = data.get("usageMetadata", {})

                return {
                    "success": True,
                    "content": text,
                    "grounding": grounding,
                    "url_metadata": url_metadata,
                    "usage": {
                        "prompt_tokens": usage.get("promptTokenCount", 0),
                        "completion_tokens": usage.get("candidatesTokenCount", 0),
                        "url_content_tokens": usage.get("toolUsePromptTokenCount", 0),
                        "total_tokens": usage.get("totalTokenCount", 0)
                    },
                    "model": data.get("modelVersion", GEMINI_MODEL)
                }
            else:
                error_data = response.json()
                return {
                    "success": False,
                    "error": error_data.get("error", {}).get("message", f"HTTP {response.status_code}")
                }

        except httpx.ConnectError:
            return {"success": False, "error": "Cannot connect to Gemini API"}
        except httpx.TimeoutException:
            return {"success": False, "error": f"Request timed out after {GEMINI_TIMEOUT}s"}
        except Exception as e:
            return {"success": False, "error": str(e)}


def format_url_metadata(metadata: dict) -> List[dict]:
    """Format URL retrieval metadata."""
    url_data = metadata.get("urlMetadata", [])
    return [
        {
            "url": item.get("retrievedUrl", ""),
            "status": item.get("urlRetrievalStatus", "UNKNOWN").replace("URL_RETRIEVAL_STATUS_", "")
        }
        for item in url_data
    ]


# =============================================================================
# MCP Tools
# =============================================================================

@mcp.tool()
async def expand_url(params: ExpandUrlParams) -> dict:
    """
    Expand and summarize content from a single URL.

    Uses Gemini 2.5 Flash to fetch URL content and generate a summary
    or analysis based on your prompt. Returns grounded response with
    source citations.
    """
    result = await call_gemini(
        f"{params.prompt}\n\nURL: {params.url}",
        [params.url]
    )

    if not result["success"]:
        return result

    response = {
        "success": True,
        "url": params.url,
        "content": result["content"],
        "tokens_used": result["usage"]["total_tokens"]
    }

    if params.include_metadata:
        response["url_status"] = format_url_metadata(result.get("url_metadata", {}))
        response["sources"] = [
            chunk.get("web", {}).get("uri", "")
            for chunk in result.get("grounding", {}).get("groundingChunks", [])
        ]

    return response


@mcp.tool()
async def expand_urls(params: ExpandUrlsParams) -> dict:
    """
    Batch expand and analyze multiple URLs (up to 20).

    Efficiently processes multiple URLs in a single API call.
    Gemini fetches all URLs and synthesizes information based on your prompt.
    """
    result = await call_gemini(params.prompt, params.urls)

    if not result["success"]:
        return result

    response = {
        "success": True,
        "urls_requested": len(params.urls),
        "content": result["content"],
        "tokens_used": result["usage"]["total_tokens"],
        "url_content_tokens": result["usage"]["url_content_tokens"]
    }

    if params.include_metadata:
        response["url_statuses"] = format_url_metadata(result.get("url_metadata", {}))

    return response


@mcp.tool()
async def compare_urls(params: CompareUrlsParams) -> dict:
    """
    Compare content from multiple URLs.

    Analyzes 2-20 URLs and provides a structured comparison based on
    specified aspects. Useful for competitive analysis, documentation
    comparison, or content synthesis.
    """
    aspects_str = ", ".join(params.aspects)
    prompt = f"""Compare the following URLs across these aspects: {aspects_str}

Provide a structured comparison in {params.format} format.
For each aspect, highlight similarities and differences."""

    result = await call_gemini(prompt, params.urls)

    if not result["success"]:
        return result

    return {
        "success": True,
        "urls_compared": len(params.urls),
        "aspects": params.aspects,
        "comparison": result["content"],
        "url_statuses": format_url_metadata(result.get("url_metadata", {})),
        "tokens_used": result["usage"]["total_tokens"]
    }


@mcp.tool()
async def extract_from_url(params: ExtractFromUrlParams) -> dict:
    """
    Extract structured data from URL content.

    Fetches URL and extracts specific fields based on your schema.
    Returns data in the requested format (json, yaml, markdown).
    """
    schema_desc = "\n".join([f"- {k}: {v}" for k, v in params.schema.items()])
    prompt = f"""Extract the following information from the URL content:

{schema_desc}

Return the extracted data in {params.format} format.
If a field cannot be found, indicate "not found" for that field.

URL: {params.url}"""

    result = await call_gemini(prompt, [params.url])

    if not result["success"]:
        return result

    response = {
        "success": True,
        "url": params.url,
        "extracted_data": result["content"],
        "schema_fields": list(params.schema.keys()),
        "format": params.format
    }

    url_statuses = format_url_metadata(result.get("url_metadata", {}))
    if url_statuses:
        response["url_status"] = url_statuses[0].get("status", "UNKNOWN")

    return response


@mcp.tool()
async def health_check() -> dict:
    """
    Check Gemini URL Context service health.

    Verifies API key validity and tests URL context capability.
    """
    if not GEMINI_API_KEY:
        return {
            "success": False,
            "status": "not_configured",
            "error": "GOOGLE_GEMINI_API_KEY not set"
        }

    # Test with a simple URL
    result = await call_gemini(
        "Respond with 'OK' if you can read this URL: https://example.com",
        ["https://example.com"]
    )

    return {
        "success": result["success"],
        "status": "connected" if result["success"] else "error",
        "model": GEMINI_MODEL,
        "api_base": GEMINI_API_BASE,
        "error": result.get("error")
    }


# =============================================================================
# MCP Resources
# =============================================================================

@mcp.resource("gemini-url-context://capabilities")
def get_capabilities() -> str:
    """Return capabilities for discovery."""
    capabilities = {
        "name": "gemini-url-context",
        "version": "1.0.0",
        "protocol": "fastmcp",
        "tools": ["expand_url", "expand_urls", "compare_urls", "extract_from_url", "health_check"],
        "model": GEMINI_MODEL,
        "limits": {
            "max_urls_per_request": 20,
            "max_content_size_mb": 34,
            "supported_content": ["text", "html", "pdf", "images"]
        },
        "api_configured": bool(GEMINI_API_KEY)
    }
    return json.dumps(capabilities, indent=2)


# =============================================================================
# Entry Point
# =============================================================================

if __name__ == "__main__":
    mcp.run()
