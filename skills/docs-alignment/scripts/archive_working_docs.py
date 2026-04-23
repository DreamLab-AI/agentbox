#!/usr/bin/env python3
"""
Working Document Archiver

Identifies working documents that should be archived.

Usage:
    python archive_working_docs.py --root /path/to/project --output report.json
"""

import argparse
import json
import re
import shutil
from dataclasses import dataclass, asdict
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Set


@dataclass
class WorkingDocument:
    """Information about a working document."""
    file: str
    reason: str
    last_modified: str
    size_bytes: int
    suggested_archive_path: str
    content_preview: Optional[str] = None


class WorkingDocArchiver:
    """Identifies and archives working documents."""

    # Filename patterns indicating working documents
    WORKING_PREFIXES = [
        'WORKING_', 'WIP_', 'DRAFT_', 'TEMP_', 'TMP_',
        'OLD_', 'BACKUP_', 'COPY_', '_DEV_', 'TEST_'
    ]

    WORKING_SUFFIXES = [
        '_NOTES', '_WIP', '_DRAFT', '_TEMP', '_TMP',
        '_OLD', '_BACKUP', '_COPY', '_DEV', '_TEST',
        '.bak', '.backup', '.old', '.tmp', '.temp'
    ]

    # Directory patterns
    WORKING_DIRS = [
        'tmp', 'temp', 'scratch', 'working', 'wip',
        'draft', 'drafts', 'backup', 'backups', 'old'
    ]

    # Content patterns indicating working status
    CONTENT_MARKERS = [
        r'^\s*#\s*WIP',
        r'^\s*#\s*DRAFT',
        r'^\s*#\s*TODO:?\s*DELETE',
        r'^\s*#\s*WORKING',
        r'^\s*\[WIP\]',
        r'^\s*\[DRAFT\]',
        r'DO NOT COMMIT',
        r'FOR INTERNAL USE ONLY',
        r'WORK IN PROGRESS',
    ]

    def __init__(
        self,
        root: Path,
        archive_dir: str = 'docs/archive',
        dry_run: bool = True
    ):
        self.root = Path(root).resolve()
        self.archive_dir = archive_dir
        self.dry_run = dry_run
        self.working_docs: List[WorkingDocument] = []

    def _is_working_filename(self, path: Path) -> Optional[str]:
        """Check if filename indicates working document."""
        name = path.name.upper()
        stem = path.stem.upper()

        for prefix in self.WORKING_PREFIXES:
            if name.startswith(prefix):
                return f"Filename starts with '{prefix}'"

        for suffix in self.WORKING_SUFFIXES:
            if stem.endswith(suffix.upper()) or name.endswith(suffix.upper()):
                return f"Filename ends with '{suffix}'"

        return None

    def _is_working_directory(self, path: Path) -> Optional[str]:
        """Check if file is in a working directory."""
        parts = [p.lower() for p in path.parts]

        for working_dir in self.WORKING_DIRS:
            if working_dir in parts:
                return f"Located in '{working_dir}' directory"

        return None

    def _has_working_content(self, path: Path) -> Optional[str]:
        """Check if file content indicates working document."""
        try:
            content = path.read_text(encoding='utf-8', errors='replace')
            # Check first 50 lines
            lines = content.split('\n')[:50]
            first_content = '\n'.join(lines)

            for pattern in self.CONTENT_MARKERS:
                if re.search(pattern, first_content, re.IGNORECASE | re.MULTILINE):
                    return f"Content contains working marker"

        except Exception:
            pass

        return None

    def _is_implementation_note(self, path: Path) -> Optional[str]:
        """Check if file is an implementation note outside docs structure."""
        name_lower = path.name.lower()

        # Common implementation note patterns
        impl_patterns = [
            'implementation', 'impl-', 'design-notes',
            'technical-notes', 'dev-notes', 'todo-list',
            'action-plan', 'migration-plan', 'refactor'
        ]

        for pattern in impl_patterns:
            if pattern in name_lower:
                # Check if it's in docs folder
                try:
                    path.relative_to(self.root / 'docs')
                    return None  # It's in docs, OK
                except ValueError:
                    return f"Implementation note outside docs directory"

        return None

    def _get_content_preview(self, path: Path, lines: int = 5) -> Optional[str]:
        """Get a preview of file content."""
        try:
            content = path.read_text(encoding='utf-8', errors='replace')
            preview_lines = content.split('\n')[:lines]
            preview = '\n'.join(preview_lines)
            if len(preview) > 200:
                preview = preview[:200] + '...'
            return preview
        except Exception:
            return None

    def _suggest_archive_path(self, path: Path) -> str:
        """Suggest archive location for a file."""
        try:
            rel_path = path.relative_to(self.root)
        except ValueError:
            rel_path = Path(path.name)

        # Create archive path preserving some structure
        archive_path = Path(self.archive_dir) / rel_path
        return str(archive_path)

    def scan_file(self, file_path: Path) -> Optional[WorkingDocument]:
        """Check if a file is a working document."""
        # Check various indicators
        reasons = []

        filename_reason = self._is_working_filename(file_path)
        if filename_reason:
            reasons.append(filename_reason)

        dir_reason = self._is_working_directory(file_path)
        if dir_reason:
            reasons.append(dir_reason)

        content_reason = self._has_working_content(file_path)
        if content_reason:
            reasons.append(content_reason)

        impl_reason = self._is_implementation_note(file_path)
        if impl_reason:
            reasons.append(impl_reason)

        if not reasons:
            return None

        # Get file metadata
        stat = file_path.stat()
        last_modified = datetime.fromtimestamp(stat.st_mtime).isoformat()

        return WorkingDocument(
            file=str(file_path.relative_to(self.root)),
            reason='; '.join(reasons),
            last_modified=last_modified,
            size_bytes=stat.st_size,
            suggested_archive_path=self._suggest_archive_path(file_path),
            content_preview=self._get_content_preview(file_path)
        )

    def run(self) -> Dict:
        """Scan for working documents."""
        print(f"Scanning {self.root} for working documents...")

        # Scan markdown and text files
        patterns = ['**/*.md', '**/*.txt', '**/*.rst']
        files_scanned = 0

        for pattern in patterns:
            for file_path in self.root.glob(pattern):
                # Skip common excludes
                if any(part in str(file_path) for part in [
                    'node_modules', '.git', 'target', '__pycache__',
                    '.venv', 'dist', 'archive'
                ]):
                    continue

                files_scanned += 1
                result = self.scan_file(file_path)
                if result:
                    self.working_docs.append(result)

        print(f"Scanned {files_scanned} files, found {len(self.working_docs)} working documents")

        # Generate move commands
        move_commands = []
        for doc in self.working_docs:
            source = doc.file
            dest = doc.suggested_archive_path
            move_commands.append({
                'source': source,
                'destination': dest,
                'command': f'mkdir -p "$(dirname {dest})" && mv "{source}" "{dest}"'
            })

        # Group by reason
        by_reason: Dict[str, int] = {}
        for doc in self.working_docs:
            for reason in doc.reason.split('; '):
                by_reason[reason] = by_reason.get(reason, 0) + 1

        return {
            'total_found': len(self.working_docs),
            'total_size_bytes': sum(d.size_bytes for d in self.working_docs),
            'by_reason': by_reason,
            'working_docs': [asdict(d) for d in self.working_docs],
            'suggested_moves': move_commands,
            'dry_run': self.dry_run,
            'archive_directory': self.archive_dir
        }

    def execute_archive(self) -> Dict:
        """Actually move files to archive (if not dry_run)."""
        if self.dry_run:
            return {'error': 'Dry run mode - no files moved'}

        results = []
        archive_base = self.root / self.archive_dir

        for doc in self.working_docs:
            source = self.root / doc.file
            dest = self.root / doc.suggested_archive_path

            try:
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(source), str(dest))
                results.append({
                    'file': doc.file,
                    'status': 'moved',
                    'destination': str(dest.relative_to(self.root))
                })
            except Exception as e:
                results.append({
                    'file': doc.file,
                    'status': 'error',
                    'error': str(e)
                })

        return {
            'archived': len([r for r in results if r['status'] == 'moved']),
            'errors': len([r for r in results if r['status'] == 'error']),
            'results': results
        }


def main():
    parser = argparse.ArgumentParser(description='Archive working documents')
    parser.add_argument('--root', type=str, default='.', help='Project root')
    parser.add_argument('--output', type=str, help='Output JSON file')
    parser.add_argument('--archive-dir', type=str, default='docs/archive',
                       help='Archive destination')
    parser.add_argument('--execute', action='store_true',
                       help='Actually move files (default: dry run)')

    args = parser.parse_args()

    archiver = WorkingDocArchiver(
        root=args.root,
        archive_dir=args.archive_dir,
        dry_run=not args.execute
    )

    report = archiver.run()

    if args.execute and report['total_found'] > 0:
        print("\nExecuting archive operations...")
        archive_results = archiver.execute_archive()
        report['archive_results'] = archive_results

    json_output = json.dumps(report, indent=2)

    if args.output:
        Path(args.output).write_text(json_output)
        print(f"Report written to {args.output}")
    else:
        print(json_output)


if __name__ == '__main__':
    main()
