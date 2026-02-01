#!/usr/bin/env python3
"""
Web Summary Tool for Claude Code Skills
Provides web content and YouTube summarization with semantic topic extraction
"""

import sys
import json
import os
import requests
from typing import Dict, Any, List, Optional
from youtube_transcript_api import YouTubeTranscriptApi
from urllib.parse import urlparse, parse_qs
import re

class WebSummaryTool:
    def __init__(self):
        self.zai_url = os.environ.get("ZAI_CONTAINER_URL", "http://localhost:9600")
        self.google_api_key = os.environ.get("GOOGLE_API_KEY", "")

    def extract_youtube_id(self, url: str) -> Optional[str]:
        """Extract YouTube video ID from URL"""
        patterns = [
            r'(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#]+)',
            r'youtube\.com\/embed\/([^&\n?#]+)',
        ]

        for pattern in patterns:
            match = re.search(pattern, url)
            if match:
                return match.group(1)

        # If it's just an ID
        if len(url) == 11 and re.match(r'^[a-zA-Z0-9_-]+$', url):
            return url

        return None

    def get_youtube_transcript(self, video_id: str, language: str = "en") -> Dict[str, Any]:
        """Get transcript from YouTube video"""
        try:
            transcript_list = YouTubeTranscriptApi.list_transcripts(video_id)

            # Try to get the requested language
            try:
                transcript = transcript_list.find_transcript([language])
            except:
                # Fallback to any available transcript
                transcript = transcript_list.find_transcript(transcript_list._manually_created_transcripts.keys() or
                                                            transcript_list._generated_transcripts.keys())

            # Fetch the actual transcript
            transcript_data = transcript.fetch()

            # Combine all text segments
            full_text = " ".join([entry['text'] for entry in transcript_data])

            return {
                "success": True,
                "video_id": video_id,
                "language": transcript.language_code,
                "transcript": full_text,
                "segments": len(transcript_data)
            }

        except Exception as e:
            return {
                "success": False,
                "error": f"Failed to get transcript: {str(e)}",
                "video_id": video_id
            }

    def fetch_web_content(self, url: str) -> Dict[str, Any]:
        """Fetch content from a web URL"""
        try:
            headers = {
                'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36'
            }
            response = requests.get(url, headers=headers, timeout=30)
            response.raise_for_status()

            # Extract text content (basic implementation)
            # In production, use BeautifulSoup or similar for better extraction
            from bs4 import BeautifulSoup
            soup = BeautifulSoup(response.content, 'html.parser')

            # Remove script and style elements
            for script in soup(["script", "style"]):
                script.decompose()

            # Get text
            text = soup.get_text()

            # Clean up whitespace
            lines = (line.strip() for line in text.splitlines())
            chunks = (phrase.strip() for line in lines for phrase in line.split("  "))
            text = '\n'.join(chunk for chunk in chunks if chunk)

            # Extract metadata
            title = soup.find('title')
            title_text = title.string if title else "No title"

            return {
                "success": True,
                "url": url,
                "title": title_text,
                "content": text[:50000],  # Limit to 50k chars
                "length": len(text)
            }

        except Exception as e:
            return {
                "success": False,
                "error": f"Failed to fetch content: {str(e)}",
                "url": url
            }

    def summarize_with_zai(self, text: str, length: str = "medium") -> Dict[str, Any]:
        """Use Z.AI service for cost-effective summarization"""
        try:
            # Length mapping
            length_tokens = {
                "short": 150,
                "medium": 300,
                "long": 600
            }

            max_tokens = length_tokens.get(length, 300)

            # Call Z.AI service
            response = requests.post(
                f"{self.zai_url}/summarize",
                json={
                    "text": text[:30000],  # Limit input
                    "max_tokens": max_tokens
                },
                timeout=60
            )

            if response.status_code == 200:
                return {
                    "success": True,
                    "summary": response.json().get("summary", ""),
                    "method": "zai"
                }
            else:
                return {
                    "success": False,
                    "error": f"Z.AI returned status {response.status_code}"
                }

        except Exception as e:
            return {
                "success": False,
                "error": f"Z.AI summarization failed: {str(e)}"
            }

    def generate_topics(self, text: str, max_topics: int = 10, format: str = "logseq") -> Dict[str, Any]:
        """Generate semantic topic links from text - DEPRECATED: Migrating to new ontology system"""
        return {
            "success": False,
            "error": "Topic generation deprecated - migrating to new ontology system",
            "topics": [],
            "count": 0
        }

    def handle_request(self, request: Dict[str, Any]) -> Dict[str, Any]:
        """Main request handler"""
        tool = request.get("tool")
        params = request.get("params", {})

        if tool == "summarize_url":
            url = params.get("url")
            if not url:
                return {"error": "URL parameter required"}

            length = params.get("length", "medium")
            include_topics = params.get("include_topics", True)

            # Check if it's a YouTube URL
            video_id = self.extract_youtube_id(url)
            if video_id:
                # Handle as YouTube
                transcript_result = self.get_youtube_transcript(video_id)
                if not transcript_result.get("success"):
                    return transcript_result

                text = transcript_result["transcript"]
                source_type = "youtube"
            else:
                # Handle as web page
                fetch_result = self.fetch_web_content(url)
                if not fetch_result.get("success"):
                    return fetch_result

                text = fetch_result["content"]
                source_type = "web"

            # Summarize
            summary_result = self.summarize_with_zai(text, length)
            if not summary_result.get("success"):
                return summary_result

            # Topics feature removed - migrating to new ontology system
            return {
                "success": True,
                "url": url,
                "source_type": source_type,
                "summary": summary_result["summary"],
                "length": length
            }

        elif tool == "youtube_transcript":
            video_id = params.get("video_id")
            if not video_id:
                return {"error": "video_id parameter required"}

            # Extract ID if full URL provided
            extracted_id = self.extract_youtube_id(video_id)
            if not extracted_id:
                return {"error": "Invalid YouTube URL or ID"}

            language = params.get("language", "en")
            return self.get_youtube_transcript(extracted_id, language)

        elif tool == "generate_topics":
            # Deprecated: Migrating to new ontology system
            return {
                "error": "generate_topics tool deprecated - migrating to new ontology system"
            }

        else:
            return {"error": f"Unknown tool: {tool}"}

def main():
    """Main entry point for skill tool"""
    tool = WebSummaryTool()

    for line in sys.stdin:
        try:
            request = json.loads(line.strip())
            result = tool.handle_request(request)

            response = {"result": result}
            print(json.dumps(response))
            sys.stdout.flush()

        except json.JSONDecodeError as e:
            error_response = {"error": f"Invalid JSON: {str(e)}"}
            print(json.dumps(error_response))
            sys.stdout.flush()
        except Exception as e:
            error_response = {"error": f"Unexpected error: {str(e)}"}
            print(json.dumps(error_response))
            sys.stdout.flush()

if __name__ == "__main__":
    main()
