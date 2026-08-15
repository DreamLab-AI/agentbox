"""Route a file or byte stream to the text, image or container pipeline.

The routers (inspect_file, clean_file) and the audits (audit_lib) all need the
same answer: given a path or bytes, which pipeline owns it? That decision used
to live in three copies with subtly different extension tables and sniffing.
This module is the single interface for it.
"""

from __future__ import annotations

from pathlib import Path
from typing import Literal

from container_meta import detect_container_format
from image_meta import detect_format as detect_image_format

Kind = Literal["text", "image", "container"]

IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp"}
CONTAINER_EXTS = {
    ".svg",
    ".pdf",
    ".docx",
    ".odt",
    ".html",
    ".htm",
    ".md",
    ".markdown",
    ".mdx",
}
TEXT_EXTS = {
    ".txt",
    ".text",
    ".css",
    ".js",
    ".py",
    ".rs",
    ".go",
    ".json",
    ".yaml",
    ".yml",
    ".toml",
    ".csv",
}


def classify_bytes(data: bytes, suffix: str | None = None) -> Kind:
    """Classify *data* by extension first, then by magic bytes.

    The extension wins when it names a known format; otherwise the bytes are
    sniffed for image/container signatures. Unrecognized bytes fall back to
    "text" — callers that must not mangle unknown binaries guard themselves.

    *data* must cover the whole file: zip-based containers (docx/odt) are
    detected from their central directory, which sits at the end of the bytes.
    """
    ext = (suffix or "").lower()
    if ext in IMAGE_EXTS:
        return "image"
    if ext in CONTAINER_EXTS:
        return "container"
    if ext in TEXT_EXTS:
        return "text"
    if detect_image_format(data) in ("png", "jpeg", "webp"):
        return "image"
    if data:
        sniff_path = Path("input") if not ext else Path(f"input{ext}")
        if detect_container_format(sniff_path, data) != "unknown":
            return "container"
    return "text"


def classify(path: Path) -> Kind:
    """Classify a file on disk by extension, then by its bytes."""
    data = path.read_bytes()
    return classify_bytes(data, path.suffix)
