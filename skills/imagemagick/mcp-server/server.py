#!/usr/bin/env python3
"""
ImageMagick MCP Server - FastMCP Implementation

Modernized from Era 1 stdin/stdout to FastMCP SDK with Pydantic models,
structured error handling, and environment configuration.

Provides comprehensive image processing capabilities via MCP protocol.
"""

import os
import subprocess
import shutil
from typing import Optional, List
from pathlib import Path

from mcp.server.fastmcp import FastMCP
from pydantic import BaseModel, Field, field_validator

# Initialize FastMCP server
mcp = FastMCP(
    "imagemagick",
    version="2.0.0",
    description="Process and manipulate images with format conversion, resizing, filtering, and batch operations"
)

# =============================================================================
# Pydantic Models for Tool Parameters
# =============================================================================

class CreateImageParams(BaseModel):
    """Parameters for creating a new image."""
    output: str = Field(..., description="Output file path")
    width: int = Field(default=100, ge=1, le=10000, description="Image width in pixels")
    height: int = Field(default=100, ge=1, le=10000, description="Image height in pixels")
    color: str = Field(default="white", description="Background color (name, hex, or rgb)")

    @field_validator('output')
    @classmethod
    def validate_output_path(cls, v: str) -> str:
        path = Path(v)
        if not path.parent.exists():
            path.parent.mkdir(parents=True, exist_ok=True)
        return v


class ConvertParams(BaseModel):
    """Parameters for image conversion/transformation."""
    args: List[str] = Field(..., description="ImageMagick convert command arguments")

    @field_validator('args')
    @classmethod
    def validate_args(cls, v: List[str]) -> List[str]:
        if not v:
            raise ValueError("args cannot be empty")
        # Security: prevent shell injection via command chaining
        dangerous = [';', '&&', '||', '|', '`', '$', '>', '<']
        for arg in v:
            for char in dangerous:
                if char in arg:
                    raise ValueError(f"Invalid character '{char}' in arguments")
        return v


class ResizeParams(BaseModel):
    """Parameters for resizing an image."""
    input_path: str = Field(..., description="Input image file path")
    output_path: str = Field(..., description="Output image file path")
    width: int = Field(..., ge=1, le=10000, description="Target width in pixels")
    height: int = Field(..., ge=1, le=10000, description="Target height in pixels")
    maintain_aspect: bool = Field(default=True, description="Maintain aspect ratio")
    quality: int = Field(default=90, ge=1, le=100, description="Output quality (1-100)")


class CropParams(BaseModel):
    """Parameters for cropping an image."""
    input_path: str = Field(..., description="Input image file path")
    output_path: str = Field(..., description="Output image file path")
    width: int = Field(..., ge=1, description="Crop width in pixels")
    height: int = Field(..., ge=1, description="Crop height in pixels")
    x_offset: int = Field(default=0, ge=0, description="X offset from left")
    y_offset: int = Field(default=0, ge=0, description="Y offset from top")


class CompositeParams(BaseModel):
    """Parameters for compositing images."""
    background: str = Field(..., description="Background image path")
    overlay: str = Field(..., description="Overlay image path")
    output_path: str = Field(..., description="Output image file path")
    gravity: str = Field(default="center", description="Position (center, northwest, etc.)")
    blend: Optional[int] = Field(default=None, ge=0, le=100, description="Blend percentage")


class IdentifyParams(BaseModel):
    """Parameters for identifying image metadata."""
    input_path: str = Field(..., description="Image file path to analyze")
    verbose: bool = Field(default=False, description="Include detailed metadata")


class BatchParams(BaseModel):
    """Parameters for batch processing."""
    input_pattern: str = Field(..., description="Input file glob pattern (e.g., '*.png')")
    output_dir: str = Field(..., description="Output directory for processed files")
    operation: str = Field(..., description="Operation: resize, convert, thumbnail")
    format: Optional[str] = Field(default=None, description="Output format (jpg, png, webp)")
    width: Optional[int] = Field(default=None, ge=1, description="Target width for resize")
    height: Optional[int] = Field(default=None, ge=1, description="Target height for resize")


# =============================================================================
# Helper Functions
# =============================================================================

def get_convert_command() -> str:
    """Get the ImageMagick convert command (handles v7 'magick' wrapper)."""
    # Check for ImageMagick 7 (uses 'magick' command)
    if shutil.which("magick"):
        return "magick"
    # Fall back to ImageMagick 6 (uses 'convert' directly)
    if shutil.which("convert"):
        return "convert"
    raise RuntimeError("ImageMagick not found. Install with: pacman -S imagemagick")


def run_imagemagick(args: List[str]) -> dict:
    """Execute an ImageMagick command and return structured response."""
    try:
        cmd = get_convert_command()
        # For ImageMagick 7, prepend 'convert' subcommand if using 'magick'
        if cmd == "magick" and args[0] != "identify":
            full_args = [cmd, "convert"] + args
        elif cmd == "magick" and args[0] == "identify":
            full_args = [cmd] + args
        else:
            full_args = [cmd] + args

        result = subprocess.run(
            full_args,
            capture_output=True,
            text=True,
            timeout=300,  # 5 minute timeout
            check=True
        )

        return {
            "success": True,
            "stdout": result.stdout,
            "stderr": result.stderr,
            "command": " ".join(full_args)
        }
    except subprocess.CalledProcessError as e:
        return {
            "success": False,
            "error": "Command failed",
            "stdout": e.stdout,
            "stderr": e.stderr,
            "returncode": e.returncode,
            "command": " ".join(full_args) if 'full_args' in locals() else str(args)
        }
    except subprocess.TimeoutExpired:
        return {
            "success": False,
            "error": "Command timed out after 300 seconds"
        }
    except FileNotFoundError:
        return {
            "success": False,
            "error": "ImageMagick not found. Install with: pacman -S imagemagick"
        }
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }


# =============================================================================
# MCP Tools
# =============================================================================

@mcp.tool()
def create_image(params: CreateImageParams) -> dict:
    """
    Create a new image with specified dimensions and color.

    Use for generating blank canvases, solid color backgrounds, or placeholder images.
    """
    args = [
        "-size", f"{params.width}x{params.height}",
        f"xc:{params.color}",
        params.output
    ]
    result = run_imagemagick(args)
    if result["success"]:
        result["message"] = f"Created {params.width}x{params.height} {params.color} image at {params.output}"
    return result


@mcp.tool()
def convert_image(params: ConvertParams) -> dict:
    """
    Execute an ImageMagick convert command with custom arguments.

    Use for advanced transformations: format conversion, filters, effects, annotations.
    Example args: ["input.png", "-resize", "50%", "output.jpg"]
    """
    return run_imagemagick(params.args)


@mcp.tool()
def resize_image(params: ResizeParams) -> dict:
    """
    Resize an image to specified dimensions.

    Use when you need to change image size for thumbnails, web optimization, or scaling.
    Maintains aspect ratio by default (fits within bounding box).
    """
    if not Path(params.input_path).exists():
        return {"success": False, "error": f"Input file not found: {params.input_path}"}

    # Use '!' to force exact dimensions, or no modifier to maintain aspect
    geometry = f"{params.width}x{params.height}"
    if not params.maintain_aspect:
        geometry += "!"

    args = [
        params.input_path,
        "-resize", geometry,
        "-quality", str(params.quality),
        params.output_path
    ]

    result = run_imagemagick(args)
    if result["success"]:
        result["message"] = f"Resized to {geometry} with quality {params.quality}"
    return result


@mcp.tool()
def crop_image(params: CropParams) -> dict:
    """
    Crop an image to specified region.

    Use when you need to extract a portion of an image or remove edges.
    """
    if not Path(params.input_path).exists():
        return {"success": False, "error": f"Input file not found: {params.input_path}"}

    geometry = f"{params.width}x{params.height}+{params.x_offset}+{params.y_offset}"

    args = [
        params.input_path,
        "-crop", geometry,
        "+repage",
        params.output_path
    ]

    result = run_imagemagick(args)
    if result["success"]:
        result["message"] = f"Cropped region: {geometry}"
    return result


@mcp.tool()
def composite_images(params: CompositeParams) -> dict:
    """
    Composite (overlay) one image onto another.

    Use for watermarks, image overlays, or combining multiple images.
    """
    if not Path(params.background).exists():
        return {"success": False, "error": f"Background file not found: {params.background}"}
    if not Path(params.overlay).exists():
        return {"success": False, "error": f"Overlay file not found: {params.overlay}"}

    args = [
        params.background,
        params.overlay,
        "-gravity", params.gravity,
        "-composite",
        params.output_path
    ]

    if params.blend is not None:
        args.insert(4, "-blend")
        args.insert(5, f"{params.blend}%")

    result = run_imagemagick(args)
    if result["success"]:
        result["message"] = f"Composited images with gravity={params.gravity}"
    return result


@mcp.tool()
def identify_image(params: IdentifyParams) -> dict:
    """
    Get image metadata and properties.

    Use to inspect image format, dimensions, color depth, and other properties.
    """
    if not Path(params.input_path).exists():
        return {"success": False, "error": f"File not found: {params.input_path}"}

    try:
        cmd = get_convert_command()
        if cmd == "magick":
            full_args = ["magick", "identify"]
        else:
            full_args = ["identify"]

        if params.verbose:
            full_args.append("-verbose")
        full_args.append(params.input_path)

        result = subprocess.run(
            full_args,
            capture_output=True,
            text=True,
            timeout=30,
            check=True
        )

        # Parse basic info from identify output
        output = result.stdout.strip()

        return {
            "success": True,
            "info": output,
            "file": params.input_path
        }
    except subprocess.CalledProcessError as e:
        return {
            "success": False,
            "error": e.stderr or "Failed to identify image"
        }
    except Exception as e:
        return {"success": False, "error": str(e)}


@mcp.tool()
def batch_process(params: BatchParams) -> dict:
    """
    Batch process multiple images matching a pattern.

    Use for bulk operations like converting all PNGs to JPG, generating thumbnails,
    or resizing an entire directory of images.
    """
    import glob

    # Create output directory
    output_dir = Path(params.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    # Find matching files
    files = glob.glob(params.input_pattern)
    if not files:
        return {"success": False, "error": f"No files match pattern: {params.input_pattern}"}

    results = []
    success_count = 0

    for input_file in files:
        input_path = Path(input_file)

        # Determine output filename
        if params.format:
            output_name = input_path.stem + "." + params.format
        else:
            output_name = input_path.name
        output_path = output_dir / output_name

        # Build operation args
        if params.operation == "resize" and params.width and params.height:
            args = [
                str(input_path),
                "-resize", f"{params.width}x{params.height}",
                str(output_path)
            ]
        elif params.operation == "thumbnail" and params.width:
            args = [
                str(input_path),
                "-thumbnail", f"{params.width}x{params.width}",
                str(output_path)
            ]
        elif params.operation == "convert":
            args = [str(input_path), str(output_path)]
        else:
            results.append({"file": input_file, "error": "Invalid operation parameters"})
            continue

        result = run_imagemagick(args)
        if result["success"]:
            success_count += 1
            results.append({"file": input_file, "output": str(output_path), "success": True})
        else:
            results.append({"file": input_file, "error": result.get("error"), "success": False})

    return {
        "success": success_count == len(files),
        "processed": success_count,
        "total": len(files),
        "results": results
    }


# =============================================================================
# MCP Resources (for VisionFlow integration)
# =============================================================================

@mcp.resource("imagemagick://capabilities")
def get_capabilities() -> str:
    """Return ImageMagick capabilities for VisionFlow discovery."""
    import json
    capabilities = {
        "name": "imagemagick",
        "version": "2.0.0",
        "protocol": "fastmcp",
        "tools": [
            "create_image", "convert_image", "resize_image",
            "crop_image", "composite_images", "identify_image", "batch_process"
        ],
        "formats_supported": ["png", "jpg", "jpeg", "gif", "webp", "bmp", "tiff", "svg", "pdf"],
        "visionflow_compatible": True
    }
    return json.dumps(capabilities, indent=2)


# =============================================================================
# Entry Point
# =============================================================================

if __name__ == "__main__":
    mcp.run()
