#!/usr/bin/env python3
"""
Web Summary MCP Server - FastMCP Implementation

Consolidated Python-only implementation (eliminates Node.js wrapper).
Uses Z.AI service (port 9600) for cost-effective summarization.

Features:
- URL content summarization
- YouTube transcript extraction
- Semantic topic generation for Logseq/Obsidian
- VisionFlow integration via MCP resources
"""

import os
import re
import json
import logging
from typing import Optional, List
from urllib.parse import urlparse, parse_qs

import httpx
from mcp.server.fastmcp import FastMCP
from pydantic import BaseModel, Field, field_validator

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger("web-summary-mcp")

# Environment configuration
ZAI_URL = os.environ.get("ZAI_URL", "http://localhost:9600/chat")
ZAI_TIMEOUT = int(os.environ.get("ZAI_TIMEOUT", "60"))
USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36"

# Initialize FastMCP server
mcp = FastMCP(
    "web-summary",
    version="2.0.0",
    description="Summarize web content including YouTube videos with semantic topic links for Logseq/Obsidian"
)

# =============================================================================
# Pydantic Models
# =============================================================================

class SummarizeUrlParams(BaseModel):
    """Parameters for URL summarization."""
    url: str = Field(..., description="URL to summarize (web page or YouTube video)")
    length: str = Field(default="medium", description="Summary length: short, medium, long")
    include_topics: bool = Field(default=True, description="Include semantic topic links")
    format: str = Field(default="markdown", description="Output format: markdown, plain, logseq")

    @field_validator('url')
    @classmethod
    def validate_url(cls, v: str) -> str:
        parsed = urlparse(v)
        if not parsed.scheme:
            v = 'https://' + v
        return v

    @field_validator('length')
    @classmethod
    def validate_length(cls, v: str) -> str:
        if v not in ['short', 'medium', 'long']:
            raise ValueError("length must be 'short', 'medium', or 'long'")
        return v


class YouTubeTranscriptParams(BaseModel):
    """Parameters for YouTube transcript extraction."""
    video_id: str = Field(..., description="YouTube video ID or full URL")
    language: str = Field(default="en", description="Transcript language code")

    @field_validator('video_id')
    @classmethod
    def extract_video_id(cls, v: str) -> str:
        # Handle full URLs
        if 'youtube.com' in v or 'youtu.be' in v:
            if 'youtu.be/' in v:
                return v.split('youtu.be/')[-1].split('?')[0]
            parsed = urlparse(v)
            if 'v' in parse_qs(parsed.query):
                return parse_qs(parsed.query)['v'][0]
        # Assume it's already a video ID
        return v


class TopicsParams(BaseModel):
    """Parameters for topic generation."""
    text: str = Field(..., description="Text to analyze for topics")
    max_topics: int = Field(default=10, ge=1, le=50, description="Maximum topics to extract")
    format: str = Field(default="logseq", description="Output format: logseq, obsidian, plain")


# =============================================================================
# Helper Functions
# =============================================================================

async def fetch_url_content(url: str) -> dict:
    """Fetch content from a URL."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            response = await client.get(
                url,
                headers={"User-Agent": USER_AGENT},
                follow_redirects=True
            )
            response.raise_for_status()

            content_type = response.headers.get('content-type', '')

            # Basic HTML text extraction
            if 'text/html' in content_type:
                html = response.text
                # Simple text extraction (remove tags)
                text = re.sub(r'<script[^>]*>.*?</script>', '', html, flags=re.DOTALL)
                text = re.sub(r'<style[^>]*>.*?</style>', '', text, flags=re.DOTALL)
                text = re.sub(r'<[^>]+>', ' ', text)
                text = re.sub(r'\s+', ' ', text).strip()
                return {
                    "success": True,
                    "content": text[:50000],  # Limit content size
                    "content_type": "html",
                    "url": str(response.url)
                }
            else:
                return {
                    "success": True,
                    "content": response.text[:50000],
                    "content_type": "text",
                    "url": str(response.url)
                }

        except httpx.HTTPStatusError as e:
            return {"success": False, "error": f"HTTP {e.response.status_code}"}
        except Exception as e:
            return {"success": False, "error": str(e)}


async def call_zai(prompt: str, max_tokens: int = 2000) -> dict:
    """Call Z.AI service for LLM processing."""
    async with httpx.AsyncClient(timeout=ZAI_TIMEOUT) as client:
        try:
            response = await client.post(
                ZAI_URL,
                json={
                    "prompt": prompt,
                    "max_tokens": max_tokens
                },
                headers={"Content-Type": "application/json"}
            )

            if response.status_code == 200:
                data = response.json()
                return {
                    "success": True,
                    "content": data.get("content", data.get("response", ""))
                }
            else:
                return {"success": False, "error": f"Z.AI returned {response.status_code}"}

        except httpx.ConnectError:
            return {
                "success": False,
                "error": "Cannot connect to Z.AI service on port 9600. Check: supervisorctl status claude-zai"
            }
        except Exception as e:
            return {"success": False, "error": str(e)}


def is_youtube_url(url: str) -> bool:
    """Check if URL is a YouTube video."""
    return 'youtube.com' in url or 'youtu.be' in url


async def fetch_youtube_transcript(video_id: str, language: str = "en") -> dict:
    """Fetch YouTube transcript using youtube-transcript-api."""
    try:
        from youtube_transcript_api import YouTubeTranscriptApi

        transcript_list = YouTubeTranscriptApi.get_transcript(video_id, languages=[language])

        # Combine transcript segments
        full_text = " ".join([entry['text'] for entry in transcript_list])

        return {
            "success": True,
            "video_id": video_id,
            "language": language,
            "segments": len(transcript_list),
            "transcript": full_text
        }

    except ImportError:
        return {
            "success": False,
            "error": "youtube-transcript-api not installed. Run: pip install youtube-transcript-api"
        }
    except Exception as e:
        return {"success": False, "error": str(e)}


def format_topics(topics: List[str], format_type: str) -> str:
    """Format topics for different note-taking systems."""
    if format_type == "logseq":
        return "\n".join([f"- [[{topic}]]" for topic in topics])
    elif format_type == "obsidian":
        return "\n".join([f"- [[{topic}]]" for topic in topics])
    else:
        return "\n".join([f"- {topic}" for topic in topics])


# =============================================================================
# MCP Tools
# =============================================================================

@mcp.tool()
async def summarize_url(params: SummarizeUrlParams) -> dict:
    """
    Summarize content from any URL including YouTube videos.

    Use for creating summaries of web articles, blog posts, documentation,
    or YouTube video transcripts. Optionally generates semantic topics for
    note-taking systems like Logseq or Obsidian.
    """
    url = params.url

    # Handle YouTube URLs
    if is_youtube_url(url):
        # Extract video ID
        transcript_params = YouTubeTranscriptParams(video_id=url)
        transcript_result = await fetch_youtube_transcript(
            transcript_params.video_id,
            "en"
        )

        if not transcript_result["success"]:
            return transcript_result

        content = transcript_result["transcript"]
        source_type = "youtube"
    else:
        # Fetch web content
        fetch_result = await fetch_url_content(url)
        if not fetch_result["success"]:
            return fetch_result

        content = fetch_result["content"]
        source_type = "webpage"

    # Determine summary length instruction
    length_instruction = {
        "short": "in 2-3 sentences",
        "medium": "in 1-2 paragraphs",
        "long": "in a comprehensive summary with key points"
    }.get(params.length, "in 1-2 paragraphs")

    # Build summarization prompt
    prompt = f"""Summarize the following {source_type} content {length_instruction}.
Focus on the main ideas and key takeaways.

Content:
{content[:15000]}

Provide the summary in {params.format} format."""

    # Call Z.AI for summarization
    summary_result = await call_zai(prompt)
    if not summary_result["success"]:
        return summary_result

    result = {
        "success": True,
        "url": url,
        "source_type": source_type,
        "summary": summary_result["content"]
    }

    # Generate topics if requested
    if params.include_topics:
        topic_prompt = f"""Extract 5-10 key topics/concepts from this summary as single words or short phrases.
Return them as a comma-separated list.

Summary:
{summary_result['content']}"""

        topic_result = await call_zai(topic_prompt, max_tokens=500)
        if topic_result["success"]:
            topics = [t.strip() for t in topic_result["content"].split(",")]
            result["topics"] = topics
            result["topics_formatted"] = format_topics(topics, params.format)

    return result


@mcp.tool()
async def youtube_transcript(params: YouTubeTranscriptParams) -> dict:
    """
    Extract transcript from a YouTube video.

    Use when you need the full text content of a YouTube video for analysis,
    note-taking, or further processing. Supports multiple languages.
    """
    return await fetch_youtube_transcript(params.video_id, params.language)


@mcp.tool()
async def generate_topics(params: TopicsParams) -> dict:
    """
    Generate semantic topic links from text.

    Use for extracting key concepts and creating linked notes in Logseq,
    Obsidian, or other knowledge management systems.
    """
    prompt = f"""Extract the top {params.max_topics} key topics/concepts from this text.
Return them as a comma-separated list of single words or short phrases (2-3 words max).
Focus on specific, meaningful concepts rather than generic terms.

Text:
{params.text[:10000]}"""

    result = await call_zai(prompt, max_tokens=500)
    if not result["success"]:
        return result

    topics = [t.strip() for t in result["content"].split(",")][:params.max_topics]

    return {
        "success": True,
        "count": len(topics),
        "topics": topics,
        "formatted": format_topics(topics, params.format)
    }


@mcp.tool()
async def health_check() -> dict:
    """
    Check web-summary service health.

    Verifies Z.AI service connectivity and reports configuration.
    """
    zai_result = await call_zai("Say 'OK' if you can hear me.", max_tokens=10)

    return {
        "success": zai_result["success"],
        "zai_url": ZAI_URL,
        "zai_status": "connected" if zai_result["success"] else "disconnected",
        "error": zai_result.get("error")
    }


# =============================================================================
# MCP Resources (for VisionFlow integration)
# =============================================================================

@mcp.resource("web-summary://capabilities")
def get_capabilities() -> str:
    """Return web-summary capabilities for VisionFlow discovery."""
    capabilities = {
        "name": "web-summary",
        "version": "2.0.0",
        "protocol": "fastmcp",
        "tools": ["summarize_url", "youtube_transcript", "generate_topics", "health_check"],
        "zai_integration": True,
        "supported_formats": ["markdown", "plain", "logseq", "obsidian"],
        "visionflow_compatible": True
    }
    return json.dumps(capabilities, indent=2)


# =============================================================================
# Entry Point
# =============================================================================

if __name__ == "__main__":
    mcp.run()
