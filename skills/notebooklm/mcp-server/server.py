#!/usr/bin/env python3
"""
NotebookLM MCP Server - FastMCP Implementation

Provides programmatic access to Google NotebookLM via the notebooklm-py SDK.
Supports notebook management, source ingestion, AI chat, and content generation.

SDK: https://github.com/teng-lin/notebooklm-py
"""

import os
import json
import asyncio
import logging
from typing import Optional, List, Dict, Any
from pathlib import Path

from mcp.server.fastmcp import FastMCP
from pydantic import BaseModel, Field, field_validator

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger("notebooklm-mcp")

# Environment configuration
STORAGE_DIR = os.environ.get("NOTEBOOKLM_STORAGE_DIR", os.path.expanduser("~/.notebooklm"))
TIMEOUT = int(os.environ.get("NOTEBOOKLM_TIMEOUT", "300"))

# Initialize FastMCP server
mcp = FastMCP(
    "notebooklm",
    version="1.0.0",
    description="Programmatic access to Google NotebookLM for notebooks, sources, chat, and content generation",
)


# =============================================================================
# Client Helper
# =============================================================================

async def get_client():
    """Get an authenticated NotebookLM client."""
    try:
        from notebooklm import NotebookLMClient
        return await NotebookLMClient.from_storage()
    except ImportError:
        return None
    except Exception as e:
        logger.error(f"Failed to create client: {e}")
        return None


def error_response(msg: str) -> dict:
    return {"success": False, "error": msg}


# =============================================================================
# Pydantic Models
# =============================================================================

class CreateNotebookParams(BaseModel):
    """Parameters for creating a notebook."""
    name: str = Field(..., description="Name for the new notebook")


class NotebookIdParams(BaseModel):
    """Parameters requiring a notebook ID."""
    notebook_id: str = Field(..., description="Notebook ID")


class AddSourceParams(BaseModel):
    """Parameters for adding a source to a notebook."""
    notebook_id: str = Field(..., description="Target notebook ID")
    source_type: str = Field(
        ...,
        description="Source type: url, file, youtube, drive, text",
    )
    source: str = Field(
        ...,
        description="Source value: URL, file path, YouTube URL, Drive ID, or text content",
    )
    title: str = Field(default="", description="Title for text sources (required for type=text)")
    wait: bool = Field(default=True, description="Wait for source processing to complete")

    @field_validator("source_type")
    @classmethod
    def validate_source_type(cls, v: str) -> str:
        valid = {"url", "file", "youtube", "drive", "text"}
        if v not in valid:
            raise ValueError(f"source_type must be one of: {', '.join(sorted(valid))}")
        return v


class ChatParams(BaseModel):
    """Parameters for chatting with notebook sources."""
    notebook_id: str = Field(..., description="Notebook ID")
    question: str = Field(..., description="Question to ask about the sources")
    persona: Optional[str] = Field(default=None, description="Custom persona for the response")


class GenerateAudioParams(BaseModel):
    """Parameters for audio overview generation."""
    notebook_id: str = Field(..., description="Notebook ID")
    format: str = Field(default="deep-dive", description="Audio format: deep-dive, brief, critique, debate")
    length: str = Field(default="medium", description="Length: short, medium, long")
    language: str = Field(default="en", description="Language code (50+ supported)")
    instructions: str = Field(default="", description="Custom instructions for generation")

    @field_validator("format")
    @classmethod
    def validate_format(cls, v: str) -> str:
        valid = {"deep-dive", "brief", "critique", "debate"}
        if v not in valid:
            raise ValueError(f"format must be one of: {', '.join(sorted(valid))}")
        return v


class GenerateVideoParams(BaseModel):
    """Parameters for video overview generation."""
    notebook_id: str = Field(..., description="Notebook ID")
    format: str = Field(default="explainer", description="Video format: explainer, brief, cinematic")
    style: str = Field(default="whiteboard", description="Visual style")
    instructions: str = Field(default="", description="Custom instructions")

    @field_validator("format")
    @classmethod
    def validate_format(cls, v: str) -> str:
        valid = {"explainer", "brief", "cinematic"}
        if v not in valid:
            raise ValueError(f"format must be one of: {', '.join(sorted(valid))}")
        return v


class GenerateSlidesParams(BaseModel):
    """Parameters for slide deck generation."""
    notebook_id: str = Field(..., description="Notebook ID")
    format: str = Field(default="detailed", description="Slide format: detailed, presenter")
    length: str = Field(default="medium", description="Length: short, medium, long")


class GenerateQuizParams(BaseModel):
    """Parameters for quiz generation."""
    notebook_id: str = Field(..., description="Notebook ID")
    quantity: str = Field(default="medium", description="Quantity: light, medium, more")
    difficulty: str = Field(default="medium", description="Difficulty: easy, medium, hard")


class GenerateReportParams(BaseModel):
    """Parameters for report generation."""
    notebook_id: str = Field(..., description="Notebook ID")
    format: str = Field(default="briefing", description="Report format: briefing, study-guide, blog-post")
    instructions: str = Field(default="", description="Extra instructions")

    @field_validator("format")
    @classmethod
    def validate_format(cls, v: str) -> str:
        valid = {"briefing", "study-guide", "blog-post"}
        if v not in valid:
            raise ValueError(f"format must be one of: {', '.join(sorted(valid))}")
        return v


class DownloadArtifactParams(BaseModel):
    """Parameters for downloading a generated artifact."""
    notebook_id: str = Field(..., description="Notebook ID")
    artifact_type: str = Field(
        ...,
        description="Type: audio, video, quiz, flashcards, slides, infographic, mind_map, data_table, report",
    )
    output_path: str = Field(..., description="Local file path for download")
    output_format: Optional[str] = Field(
        default=None,
        description="Output format override (e.g., json/markdown/html for quiz, pdf/pptx for slides, mp3/mp4 for audio)",
    )


class ShareParams(BaseModel):
    """Parameters for sharing management."""
    notebook_id: str = Field(..., description="Notebook ID")
    action: str = Field(..., description="Action: public_link, private_link, add_user, remove_user, status")
    email: Optional[str] = Field(default=None, description="User email (for add_user/remove_user)")
    role: str = Field(default="viewer", description="Role: viewer, editor (for add_user)")


# =============================================================================
# MCP Tools
# =============================================================================

@mcp.tool()
async def notebooklm_health_check() -> dict:
    """
    Check NotebookLM authentication status and connectivity.

    Verifies that credentials exist and the SDK can connect.
    """
    storage_path = Path(STORAGE_DIR)
    has_storage = storage_path.exists() and any(storage_path.iterdir()) if storage_path.exists() else False

    if not has_storage:
        return {
            "success": False,
            "status": "not_configured",
            "error": f"No credentials found in {STORAGE_DIR}. Run: notebooklm login",
            "storage_dir": STORAGE_DIR,
        }

    try:
        from notebooklm import NotebookLMClient
    except ImportError:
        return {
            "success": False,
            "status": "not_installed",
            "error": "notebooklm-py not installed. Run: pip install 'notebooklm-py[browser]'",
        }

    client = await get_client()
    if client is None:
        return {
            "success": False,
            "status": "auth_error",
            "error": "Failed to create authenticated client. Run: notebooklm login",
        }

    try:
        async with client:
            notebooks = await client.notebooks.list()
            return {
                "success": True,
                "status": "connected",
                "storage_dir": STORAGE_DIR,
                "notebook_count": len(notebooks),
            }
    except Exception as e:
        return {
            "success": False,
            "status": "connection_error",
            "error": str(e),
        }


@mcp.tool()
async def notebooklm_create_notebook(params: CreateNotebookParams) -> dict:
    """
    Create a new Google NotebookLM notebook.

    Returns the notebook ID for use with other tools.
    """
    client = await get_client()
    if client is None:
        return error_response("Not authenticated. Run: notebooklm login")

    try:
        async with client:
            notebook = await client.notebooks.create(params.name)
            return {
                "success": True,
                "notebook_id": notebook.id,
                "title": notebook.title,
            }
    except Exception as e:
        return error_response(str(e))


@mcp.tool()
async def notebooklm_list_notebooks() -> dict:
    """
    List all NotebookLM notebooks.

    Returns notebook IDs, names, and metadata.
    """
    client = await get_client()
    if client is None:
        return error_response("Not authenticated. Run: notebooklm login")

    try:
        async with client:
            notebooks = await client.notebooks.list()
            return {
                "success": True,
                "count": len(notebooks),
                "notebooks": [
                    {"id": nb.id, "title": nb.title, "sources_count": nb.sources_count}
                    for nb in notebooks
                ],
            }
    except Exception as e:
        return error_response(str(e))


@mcp.tool()
async def notebooklm_delete_notebook(params: NotebookIdParams) -> dict:
    """
    Delete a NotebookLM notebook.

    This permanently removes the notebook and all its sources.
    """
    client = await get_client()
    if client is None:
        return error_response("Not authenticated. Run: notebooklm login")

    try:
        async with client:
            await client.notebooks.delete(params.notebook_id)
            return {"success": True, "deleted": params.notebook_id}
    except Exception as e:
        return error_response(str(e))


@mcp.tool()
async def notebooklm_add_source(params: AddSourceParams) -> dict:
    """
    Add a source to a NotebookLM notebook.

    Supports: url, file (PDF), youtube, drive (Google Drive ID), text (pasted content).
    Sources are processed asynchronously; set wait=true to block until ready.
    """
    client = await get_client()
    if client is None:
        return error_response("Not authenticated. Run: notebooklm login")

    try:
        async with client:
            add_methods = {
                "url": lambda: client.sources.add_url(params.notebook_id, params.source, wait=params.wait),
                "file": lambda: client.sources.add_file(params.notebook_id, params.source, wait=params.wait),
                "youtube": lambda: client.sources.add_url(params.notebook_id, params.source, wait=params.wait),
                "drive": lambda: client.sources.add_drive(params.notebook_id, params.source, wait=params.wait),
                "text": lambda: client.sources.add_text(
                    params.notebook_id,
                    title=params.title or "Untitled",
                    content=params.source,
                    wait=params.wait,
                ),
            }

            method = add_methods.get(params.source_type)
            if method is None:
                return error_response(f"Unknown source_type: {params.source_type}")

            source = await method()
            return {
                "success": True,
                "source_id": source.id,
                "title": getattr(source, "title", getattr(source, "name", "")),
                "type": params.source_type,
                "status": getattr(source, "status", "added"),
            }
    except Exception as e:
        return error_response(str(e))


@mcp.tool()
async def notebooklm_list_sources(params: NotebookIdParams) -> dict:
    """
    List all sources in a NotebookLM notebook.
    """
    client = await get_client()
    if client is None:
        return error_response("Not authenticated. Run: notebooklm login")

    try:
        async with client:
            sources = await client.sources.list(params.notebook_id)
            return {
                "success": True,
                "count": len(sources),
                "sources": [
                    {"id": s.id, "title": getattr(s, "title", getattr(s, "name", "")), "type": getattr(s, "type", "unknown")}
                    for s in sources
                ],
            }
    except Exception as e:
        return error_response(str(e))


@mcp.tool()
async def notebooklm_chat(params: ChatParams) -> dict:
    """
    Ask a question about notebook sources.

    Uses NotebookLM's AI to answer based on ingested sources.
    Optionally set a custom persona for the response style.
    """
    client = await get_client()
    if client is None:
        return error_response("Not authenticated. Run: notebooklm login")

    try:
        async with client:
            response = await client.chat.ask(
                params.notebook_id,
                params.question,
            )
            return {
                "success": True,
                "answer": getattr(response, "answer", getattr(response, "text", str(response))),
                "sources_cited": len(getattr(response, "sources", [])),
            }
    except Exception as e:
        return error_response(str(e))


@mcp.tool()
async def notebooklm_generate_audio(params: GenerateAudioParams) -> dict:
    """
    Generate an audio overview (podcast) from notebook sources.

    Formats: deep-dive (comprehensive), brief (summary), critique (analysis), debate (two perspectives).
    Lengths: short (~5min), medium (~10min), long (~20min).
    Supports 50+ languages.
    """
    client = await get_client()
    if client is None:
        return error_response("Not authenticated. Run: notebooklm login")

    try:
        async with client:
            status = await client.artifacts.generate_audio(
                params.notebook_id,
                format=params.format,
                length=params.length,
                language=params.language,
                instructions=params.instructions,
            )
            result = await client.artifacts.wait_for_completion(
                params.notebook_id, status.task_id, timeout=TIMEOUT
            )
            return {
                "success": True,
                "task_id": status.task_id,
                "status": "completed",
                "format": params.format,
                "length": params.length,
                "message": "Audio ready. Use notebooklm_download_artifact to download.",
            }
    except Exception as e:
        return error_response(str(e))


@mcp.tool()
async def notebooklm_generate_video(params: GenerateVideoParams) -> dict:
    """
    Generate a video overview from notebook sources.

    Formats: explainer, brief, cinematic.
    Multiple visual styles available.
    """
    client = await get_client()
    if client is None:
        return error_response("Not authenticated. Run: notebooklm login")

    try:
        async with client:
            if params.format == "cinematic":
                status = await client.artifacts.generate_cinematic_video(
                    params.notebook_id, instructions=params.instructions
                )
            else:
                status = await client.artifacts.generate_video(
                    params.notebook_id,
                    format=params.format,
                    style=params.style,
                    instructions=params.instructions,
                )
            result = await client.artifacts.wait_for_completion(
                params.notebook_id, status.task_id, timeout=TIMEOUT
            )
            return {
                "success": True,
                "task_id": status.task_id,
                "status": "completed",
                "format": params.format,
                "message": "Video ready. Use notebooklm_download_artifact to download.",
            }
    except Exception as e:
        return error_response(str(e))


@mcp.tool()
async def notebooklm_generate_slides(params: GenerateSlidesParams) -> dict:
    """
    Generate a slide deck from notebook sources.

    Formats: detailed (full content), presenter (speaker notes).
    Download as PDF or PPTX.
    """
    client = await get_client()
    if client is None:
        return error_response("Not authenticated. Run: notebooklm login")

    try:
        async with client:
            status = await client.artifacts.generate_slide_deck(
                params.notebook_id,
                format=params.format,
                length=params.length,
            )
            result = await client.artifacts.wait_for_completion(
                params.notebook_id, status.task_id, timeout=TIMEOUT
            )
            return {
                "success": True,
                "task_id": status.task_id,
                "status": "completed",
                "message": "Slides ready. Use notebooklm_download_artifact to download as PDF or PPTX.",
            }
    except Exception as e:
        return error_response(str(e))


@mcp.tool()
async def notebooklm_generate_quiz(params: GenerateQuizParams) -> dict:
    """
    Generate a quiz from notebook sources.

    Quantity: light, medium, more.
    Difficulty: easy, medium, hard.
    Download as JSON, Markdown, or HTML.
    """
    client = await get_client()
    if client is None:
        return error_response("Not authenticated. Run: notebooklm login")

    try:
        async with client:
            status = await client.artifacts.generate_quiz(
                params.notebook_id,
                quantity=params.quantity,
                difficulty=params.difficulty,
            )
            result = await client.artifacts.wait_for_completion(
                params.notebook_id, status.task_id, timeout=TIMEOUT
            )
            return {
                "success": True,
                "task_id": status.task_id,
                "status": "completed",
                "message": "Quiz ready. Use notebooklm_download_artifact to download.",
            }
    except Exception as e:
        return error_response(str(e))


@mcp.tool()
async def notebooklm_generate_mind_map(params: NotebookIdParams) -> dict:
    """
    Generate a mind map from notebook sources.

    Returns a hierarchical visualisation of topics and relationships.
    Download as JSON.
    """
    client = await get_client()
    if client is None:
        return error_response("Not authenticated. Run: notebooklm login")

    try:
        async with client:
            status = await client.artifacts.generate_mind_map(params.notebook_id)
            result = await client.artifacts.wait_for_completion(
                params.notebook_id, status.task_id, timeout=TIMEOUT
            )
            return {
                "success": True,
                "task_id": status.task_id,
                "status": "completed",
                "message": "Mind map ready. Use notebooklm_download_artifact to download.",
            }
    except Exception as e:
        return error_response(str(e))


@mcp.tool()
async def notebooklm_generate_report(params: GenerateReportParams) -> dict:
    """
    Generate a report from notebook sources.

    Formats: briefing (executive summary), study-guide (learning material), blog-post (publishable article).
    """
    client = await get_client()
    if client is None:
        return error_response("Not authenticated. Run: notebooklm login")

    try:
        async with client:
            status = await client.artifacts.generate_report(
                params.notebook_id,
                format=params.format,
                extra_instructions=params.instructions,
            )
            result = await client.artifacts.wait_for_completion(
                params.notebook_id, status.task_id, timeout=TIMEOUT
            )
            return {
                "success": True,
                "task_id": status.task_id,
                "status": "completed",
                "format": params.format,
                "message": "Report ready. Use notebooklm_download_artifact to download.",
            }
    except Exception as e:
        return error_response(str(e))


@mcp.tool()
async def notebooklm_download_artifact(params: DownloadArtifactParams) -> dict:
    """
    Download a generated artifact to a local file.

    Artifact types: audio, video, quiz, flashcards, slides, infographic, mind_map, data_table, report.
    Format overrides: audio (mp3/mp4), slides (pdf/pptx), quiz/flashcards (json/markdown/html).
    """
    client = await get_client()
    if client is None:
        return error_response("Not authenticated. Run: notebooklm login")

    # Ensure output directory exists
    output_path = Path(params.output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    try:
        async with client:
            download_map = {
                "audio": lambda: client.artifacts.download_audio(
                    params.notebook_id, str(output_path),
                    format=params.output_format or "mp3",
                ),
                "video": lambda: client.artifacts.download_video(
                    params.notebook_id, str(output_path),
                ),
                "quiz": lambda: client.artifacts.download_quiz(
                    params.notebook_id, str(output_path),
                    output_format=params.output_format or "json",
                ),
                "flashcards": lambda: client.artifacts.download_flashcards(
                    params.notebook_id, str(output_path),
                    output_format=params.output_format or "json",
                ),
                "slides": lambda: client.artifacts.download_slide_deck(
                    params.notebook_id, str(output_path),
                    format=params.output_format or "pdf",
                ),
                "infographic": lambda: client.artifacts.download_infographic(
                    params.notebook_id, str(output_path),
                ),
                "mind_map": lambda: client.artifacts.download_mind_map(
                    params.notebook_id, str(output_path),
                ),
                "data_table": lambda: client.artifacts.download_data_table(
                    params.notebook_id, str(output_path),
                ),
                "report": lambda: client.artifacts.download_report(
                    params.notebook_id, str(output_path),
                ),
            }

            method = download_map.get(params.artifact_type)
            if method is None:
                return error_response(
                    f"Unknown artifact_type: {params.artifact_type}. "
                    f"Valid: {', '.join(sorted(download_map.keys()))}"
                )

            await method()
            file_size = output_path.stat().st_size if output_path.exists() else 0

            return {
                "success": True,
                "artifact_type": params.artifact_type,
                "output_path": str(output_path),
                "file_size_bytes": file_size,
            }
    except Exception as e:
        return error_response(str(e))


@mcp.tool()
async def notebooklm_share(params: ShareParams) -> dict:
    """
    Manage notebook sharing and permissions.

    Actions: public_link, private_link, add_user, remove_user, status.
    """
    client = await get_client()
    if client is None:
        return error_response("Not authenticated. Run: notebooklm login")

    try:
        async with client:
            if params.action == "public_link":
                await client.sharing.set_public(params.notebook_id, True)
                url = await client.notebooks.get_share_url(params.notebook_id)
                return {"success": True, "link": url, "type": "public"}

            elif params.action == "private_link":
                await client.sharing.set_public(params.notebook_id, False)
                url = await client.notebooks.get_share_url(params.notebook_id)
                return {"success": True, "link": url, "type": "private"}

            elif params.action == "add_user":
                if not params.email:
                    return error_response("email is required for add_user")
                await client.sharing.add_user(params.notebook_id, params.email, params.role)
                return {"success": True, "email": params.email, "role": params.role}

            elif params.action == "remove_user":
                if not params.email:
                    return error_response("email is required for remove_user")
                await client.sharing.remove_user(params.notebook_id, params.email)
                return {"success": True, "removed": params.email}

            elif params.action == "status":
                info = await client.sharing.get_status(params.notebook_id)
                return {
                    "success": True,
                    "info": str(info),
                }

            else:
                return error_response(f"Unknown action: {params.action}")
    except Exception as e:
        return error_response(str(e))


# =============================================================================
# MCP Resources
# =============================================================================

@mcp.resource("notebooklm://capabilities")
def get_capabilities() -> str:
    """Return capabilities for discovery."""
    capabilities = {
        "name": "notebooklm",
        "version": "1.0.0",
        "protocol": "fastmcp",
        "tools": [
            "notebooklm_health_check",
            "notebooklm_create_notebook",
            "notebooklm_list_notebooks",
            "notebooklm_delete_notebook",
            "notebooklm_add_source",
            "notebooklm_list_sources",
            "notebooklm_chat",
            "notebooklm_generate_audio",
            "notebooklm_generate_video",
            "notebooklm_generate_slides",
            "notebooklm_generate_quiz",
            "notebooklm_generate_mind_map",
            "notebooklm_generate_report",
            "notebooklm_download_artifact",
            "notebooklm_share",
        ],
        "source_types": ["url", "file", "youtube", "drive", "text"],
        "artifact_types": [
            "audio", "video", "slides", "quiz", "flashcards",
            "infographic", "mind_map", "data_table", "report",
        ],
        "auth_method": "browser_oauth2",
        "storage_dir": STORAGE_DIR,
    }
    return json.dumps(capabilities, indent=2)


# =============================================================================
# Entry Point
# =============================================================================

if __name__ == "__main__":
    mcp.run()
