#!/usr/bin/env python3
"""
Documentation Link Validator

Validates all internal and external links in markdown files.
Detects broken links, orphan documents, and validates anchor references.

Usage:
    python validate_links.py --root /path/to/project --docs-dir docs --output report.json
"""

import argparse
import json
import os
import re
import sys
from collections import defaultdict
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple
from dataclasses import dataclass, asdict
from urllib.parse import urlparse, unquote

try:
    import requests
    REQUESTS_AVAILABLE = True
except ImportError:
    REQUESTS_AVAILABLE = False


@dataclass
class LinkInfo:
    """Information about a link found in documentation."""
    source_file: str
    line_number: int
    link_text: str
    link_target: str
    link_type: str  # 'internal', 'external', 'anchor', 'code'
    is_valid: bool
    error_message: Optional[str] = None


@dataclass
class ValidationReport:
    """Complete validation report."""
    total_files: int
    total_links: int
    valid_links: int
    broken_links: List[Dict]
    orphan_docs: List[str]
    forward_links: Dict[str, List[str]]  # docs -> code
    backward_links: Dict[str, List[str]]  # docs -> docs
    anchor_errors: List[Dict]


class LinkValidator:
    """Validates links in markdown documentation."""

    # Regex patterns for link extraction
    MD_LINK_PATTERN = re.compile(r'\[([^\]]*)\]\(([^)]+)\)')
    MD_REF_LINK_PATTERN = re.compile(r'\[([^\]]*)\]\[([^\]]*)\]')
    MD_REF_DEF_PATTERN = re.compile(r'^\[([^\]]+)\]:\s*(.+)$', re.MULTILINE)
    HTML_LINK_PATTERN = re.compile(r'<a\s+[^>]*href=["\']([^"\']+)["\'][^>]*>')
    ANCHOR_PATTERN = re.compile(r'^#+\s+(.+)$', re.MULTILINE)

    # File extensions to consider as documentation
    DOC_EXTENSIONS = {'.md', '.markdown', '.mdx', '.rst', '.txt'}

    # Code file extensions (for forward link validation)
    CODE_EXTENSIONS = {'.rs', '.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.java'}

    def __init__(
        self,
        root: Path,
        docs_dir: str = 'docs',
        check_external: bool = False,
        ignore_patterns: Optional[List[str]] = None
    ):
        self.root = Path(root).resolve()
        self.docs_path = self.root / docs_dir
        self.check_external = check_external
        self.ignore_patterns = ignore_patterns or []

        self.all_files: Set[Path] = set()
        self.doc_files: Set[Path] = set()
        self.code_files: Set[Path] = set()
        self.links: List[LinkInfo] = []
        self.file_anchors: Dict[Path, Set[str]] = defaultdict(set)
        self.inbound_links: Dict[Path, Set[Path]] = defaultdict(set)

    def should_ignore(self, path: Path) -> bool:
        """Check if path matches any ignore pattern."""
        path_str = str(path)
        for pattern in self.ignore_patterns:
            if pattern in path_str:
                return True
        # Default ignores
        default_ignores = ['node_modules', '.git', 'target', '__pycache__', '.venv', 'dist']
        for ignore in default_ignores:
            if ignore in path_str:
                return True
        return False

    def discover_files(self) -> None:
        """Discover all files in the project."""
        for path in self.root.rglob('*'):
            if path.is_file() and not self.should_ignore(path):
                self.all_files.add(path)

                suffix = path.suffix.lower()
                if suffix in self.DOC_EXTENSIONS:
                    self.doc_files.add(path)
                elif suffix in self.CODE_EXTENSIONS:
                    self.code_files.add(path)

    def slugify_heading(self, heading: str) -> str:
        """Convert heading to GitHub-style anchor slug."""
        # Remove markdown formatting
        slug = re.sub(r'\*\*|__|\*|_|`', '', heading)
        # Convert to lowercase
        slug = slug.lower()
        # Replace spaces with hyphens
        slug = re.sub(r'\s+', '-', slug)
        # Remove non-alphanumeric except hyphens
        slug = re.sub(r'[^a-z0-9-]', '', slug)
        # Remove multiple consecutive hyphens
        slug = re.sub(r'-+', '-', slug)
        # Strip leading/trailing hyphens
        slug = slug.strip('-')
        return slug

    def extract_anchors(self, content: str) -> Set[str]:
        """Extract all heading anchors from markdown content."""
        anchors = set()
        for match in self.ANCHOR_PATTERN.finditer(content):
            heading = match.group(1).strip()
            anchor = self.slugify_heading(heading)
            if anchor:
                anchors.add(anchor)
        return anchors

    def extract_links(self, file_path: Path, content: str) -> List[LinkInfo]:
        """Extract all links from markdown content."""
        links = []
        lines = content.split('\n')

        # Build reference link definitions
        ref_defs = {}
        for match in self.MD_REF_DEF_PATTERN.finditer(content):
            ref_defs[match.group(1).lower()] = match.group(2).strip()

        for line_num, line in enumerate(lines, 1):
            # Standard markdown links [text](url)
            for match in self.MD_LINK_PATTERN.finditer(line):
                text, target = match.groups()
                link_type = self._classify_link(target)
                links.append(LinkInfo(
                    source_file=str(file_path.relative_to(self.root)),
                    line_number=line_num,
                    link_text=text,
                    link_target=target,
                    link_type=link_type,
                    is_valid=True  # Will be validated later
                ))

            # Reference links [text][ref]
            for match in self.MD_REF_LINK_PATTERN.finditer(line):
                text, ref = match.groups()
                ref_key = (ref or text).lower()
                if ref_key in ref_defs:
                    target = ref_defs[ref_key]
                    link_type = self._classify_link(target)
                    links.append(LinkInfo(
                        source_file=str(file_path.relative_to(self.root)),
                        line_number=line_num,
                        link_text=text,
                        link_target=target,
                        link_type=link_type,
                        is_valid=True
                    ))

            # HTML links
            for match in self.HTML_LINK_PATTERN.finditer(line):
                target = match.group(1)
                link_type = self._classify_link(target)
                links.append(LinkInfo(
                    source_file=str(file_path.relative_to(self.root)),
                    line_number=line_num,
                    link_text='<html link>',
                    link_target=target,
                    link_type=link_type,
                    is_valid=True
                ))

        return links

    def _classify_link(self, target: str) -> str:
        """Classify the type of link."""
        if target.startswith('#'):
            return 'anchor'
        if target.startswith(('http://', 'https://', 'mailto:', 'ftp://')):
            return 'external'
        # Check if it points to code
        parsed = urlparse(target)
        path_part = parsed.path
        if any(path_part.endswith(ext) for ext in self.CODE_EXTENSIONS):
            return 'code'
        return 'internal'

    def resolve_link(self, source: Path, target: str) -> Tuple[Optional[Path], Optional[str]]:
        """Resolve a link target to an absolute path and anchor."""
        # Parse the target
        if '#' in target:
            path_part, anchor = target.split('#', 1)
        else:
            path_part, anchor = target, None

        # Handle empty path (anchor-only links)
        if not path_part:
            return source, anchor

        # Decode URL encoding
        path_part = unquote(path_part)

        # Resolve relative to source file's directory
        source_dir = source.parent
        target_path = (source_dir / path_part).resolve()

        # Try to resolve within project
        try:
            target_path.relative_to(self.root)
        except ValueError:
            # Outside project root
            return None, anchor

        return target_path, anchor

    def validate_link(self, link: LinkInfo, source_path: Path) -> LinkInfo:
        """Validate a single link."""
        target = link.link_target

        if link.link_type == 'external':
            if self.check_external and REQUESTS_AVAILABLE:
                try:
                    resp = requests.head(target, timeout=5, allow_redirects=True)
                    if resp.status_code >= 400:
                        link.is_valid = False
                        link.error_message = f"HTTP {resp.status_code}"
                except Exception as e:
                    link.is_valid = False
                    link.error_message = str(e)
            return link

        if link.link_type == 'anchor':
            # Anchor within same file
            anchor = target[1:]  # Remove #
            if source_path in self.file_anchors:
                if anchor not in self.file_anchors[source_path]:
                    link.is_valid = False
                    link.error_message = f"Anchor '{anchor}' not found in file"
            return link

        # Internal or code link
        resolved_path, anchor = self.resolve_link(source_path, target)

        if resolved_path is None:
            link.is_valid = False
            link.error_message = "Path resolves outside project"
            return link

        if not resolved_path.exists():
            link.is_valid = False
            link.error_message = "File not found"
            return link

        # Track inbound links
        self.inbound_links[resolved_path].add(source_path)

        # Validate anchor if present
        if anchor and resolved_path in self.file_anchors:
            if anchor not in self.file_anchors[resolved_path]:
                link.is_valid = False
                link.error_message = f"Anchor '{anchor}' not found in target file"

        return link

    def find_orphan_docs(self) -> List[str]:
        """Find documentation files with no inbound links."""
        orphans = []
        for doc_file in self.doc_files:
            # Exclude index files and root README
            if doc_file.name.lower() in ('readme.md', 'index.md', 'toc.md'):
                continue
            if doc_file not in self.inbound_links or len(self.inbound_links[doc_file]) == 0:
                orphans.append(str(doc_file.relative_to(self.root)))
        return sorted(orphans)

    def run(self) -> ValidationReport:
        """Run full validation."""
        print("Discovering files...")
        self.discover_files()
        print(f"Found {len(self.doc_files)} documentation files, {len(self.code_files)} code files")

        # First pass: extract anchors from all doc files
        print("Extracting anchors...")
        for doc_file in self.doc_files:
            try:
                content = doc_file.read_text(encoding='utf-8', errors='replace')
                self.file_anchors[doc_file] = self.extract_anchors(content)
            except Exception as e:
                print(f"Warning: Could not read {doc_file}: {e}")

        # Second pass: extract and validate links
        print("Validating links...")
        for doc_file in self.doc_files:
            try:
                content = doc_file.read_text(encoding='utf-8', errors='replace')
                file_links = self.extract_links(doc_file, content)
                for link in file_links:
                    validated = self.validate_link(link, doc_file)
                    self.links.append(validated)
            except Exception as e:
                print(f"Warning: Could not process {doc_file}: {e}")

        # Compile results
        broken_links = [asdict(l) for l in self.links if not l.is_valid]
        valid_count = sum(1 for l in self.links if l.is_valid)
        orphans = self.find_orphan_docs()

        # Build forward and backward link maps
        forward_links = defaultdict(list)
        backward_links = defaultdict(list)

        for link in self.links:
            if link.is_valid:
                if link.link_type == 'code':
                    forward_links[link.source_file].append(link.link_target)
                elif link.link_type == 'internal':
                    backward_links[link.source_file].append(link.link_target)

        anchor_errors = [
            asdict(l) for l in self.links
            if not l.is_valid and 'Anchor' in (l.error_message or '')
        ]

        return ValidationReport(
            total_files=len(self.doc_files),
            total_links=len(self.links),
            valid_links=valid_count,
            broken_links=broken_links,
            orphan_docs=orphans,
            forward_links=dict(forward_links),
            backward_links=dict(backward_links),
            anchor_errors=anchor_errors
        )


def main():
    parser = argparse.ArgumentParser(description='Validate documentation links')
    parser.add_argument('--root', type=str, default='.', help='Project root directory')
    parser.add_argument('--docs-dir', type=str, default='docs', help='Documentation directory')
    parser.add_argument('--output', type=str, help='Output JSON file (default: stdout)')
    parser.add_argument('--check-external', action='store_true', help='Validate external URLs')
    parser.add_argument('--ignore', type=str, nargs='*', default=[], help='Patterns to ignore')

    args = parser.parse_args()

    validator = LinkValidator(
        root=args.root,
        docs_dir=args.docs_dir,
        check_external=args.check_external,
        ignore_patterns=args.ignore
    )

    report = validator.run()

    # Convert to JSON-serializable format
    output = {
        'total_files': report.total_files,
        'total_links': report.total_links,
        'valid_links': report.valid_links,
        'broken_links': report.broken_links,
        'orphan_docs': report.orphan_docs,
        'forward_links': report.forward_links,
        'backward_links': report.backward_links,
        'anchor_errors': report.anchor_errors
    }

    json_output = json.dumps(output, indent=2)

    if args.output:
        Path(args.output).write_text(json_output)
        print(f"Report written to {args.output}")
    else:
        print(json_output)

    # Exit with error if broken links found
    if report.broken_links:
        sys.exit(1)


if __name__ == '__main__':
    main()
