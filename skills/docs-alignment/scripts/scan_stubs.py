#!/usr/bin/env python3
"""
Stub and TODO Scanner

Scans codebase for incomplete implementations, TODOs, FIXMEs, and stubs.

Usage:
    python scan_stubs.py --root /path/to/project --output report.json
"""

import argparse
import json
import re
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple


@dataclass
class CodeMarker:
    """Information about a code marker (TODO, FIXME, etc.)."""
    file: str
    line_number: int
    marker_type: str
    content: str
    context: Optional[str] = None
    severity: str = 'info'  # 'info', 'warning', 'error'


class StubScanner:
    """Scans codebase for incomplete implementations."""

    # Marker patterns with severity
    MARKERS = {
        # High severity
        'FIXME': ('error', re.compile(r'(?://|#|/\*)\s*FIXME:?\s*(.*)$', re.IGNORECASE)),
        'XXX': ('error', re.compile(r'(?://|#|/\*)\s*XXX:?\s*(.*)$', re.IGNORECASE)),
        'BUG': ('error', re.compile(r'(?://|#|/\*)\s*BUG:?\s*(.*)$', re.IGNORECASE)),

        # Medium severity
        'TODO': ('warning', re.compile(r'(?://|#|/\*)\s*TODO:?\s*(.*)$', re.IGNORECASE)),
        'HACK': ('warning', re.compile(r'(?://|#|/\*)\s*HACK:?\s*(.*)$', re.IGNORECASE)),
        'TEMP': ('warning', re.compile(r'(?://|#|/\*)\s*TEMP:?\s*(.*)$', re.IGNORECASE)),

        # Low severity
        'NOTE': ('info', re.compile(r'(?://|#|/\*)\s*NOTE:?\s*(.*)$', re.IGNORECASE)),
        'IDEA': ('info', re.compile(r'(?://|#|/\*)\s*IDEA:?\s*(.*)$', re.IGNORECASE)),
        'REVIEW': ('info', re.compile(r'(?://|#|/\*)\s*REVIEW:?\s*(.*)$', re.IGNORECASE)),
    }

    # Language-specific stub patterns
    STUB_PATTERNS = {
        'rust': [
            (re.compile(r'unimplemented!\s*\(\s*\)'), 'error', 'unimplemented!()'),
            (re.compile(r'todo!\s*\(\s*\)'), 'error', 'todo!()'),
            (re.compile(r'todo!\s*\(\s*"([^"]+)"\s*\)'), 'warning', 'todo!("...")'),
            (re.compile(r'panic!\s*\(\s*"not implemented"\s*\)'), 'error', 'panic!("not implemented")'),
        ],
        'python': [
            (re.compile(r'raise\s+NotImplementedError'), 'error', 'NotImplementedError'),
            (re.compile(r'pass\s*#.*stub'), 'warning', 'pass # stub'),
            (re.compile(r'\.{3}\s*#'), 'info', '... # ellipsis'),
        ],
        'typescript': [
            (re.compile(r'throw\s+new\s+Error\s*\(\s*[\'"]not implemented[\'"]\s*\)'), 'error',
             'throw new Error("not implemented")'),
            (re.compile(r'throw\s+new\s+Error\s*\(\s*[\'"]TODO[\'"]\s*\)'), 'warning',
             'throw new Error("TODO")'),
        ],
        'javascript': [
            (re.compile(r'throw\s+new\s+Error\s*\(\s*[\'"]not implemented[\'"]\s*\)'), 'error',
             'throw new Error("not implemented")'),
        ],
        'go': [
            (re.compile(r'panic\s*\(\s*"not implemented"\s*\)'), 'error', 'panic("not implemented")'),
            (re.compile(r'panic\s*\(\s*"TODO"\s*\)'), 'warning', 'panic("TODO")'),
        ],
    }

    # Placeholder comment patterns
    PLACEHOLDER_PATTERNS = [
        (re.compile(r'//\s*\.\.\.\s*$'), 'info', '// ... placeholder'),
        (re.compile(r'/\*\s*\.\.\.\s*\*/'), 'info', '/* ... */ placeholder'),
        (re.compile(r'#\s*\.\.\.\s*$'), 'info', '# ... placeholder'),
    ]

    # File extension to language mapping
    EXT_TO_LANG = {
        '.rs': 'rust',
        '.py': 'python',
        '.ts': 'typescript',
        '.tsx': 'typescript',
        '.js': 'javascript',
        '.jsx': 'javascript',
        '.go': 'go',
        '.java': 'java',
    }

    # Default file patterns
    DEFAULT_INCLUDE = ['*.rs', '*.ts', '*.tsx', '*.py', '*.js', '*.jsx', '*.go', '*.md']
    DEFAULT_EXCLUDE = ['node_modules', 'target', '.git', '__pycache__', '.venv', 'dist']

    def __init__(
        self,
        root: Path,
        include_patterns: Optional[List[str]] = None,
        exclude_patterns: Optional[List[str]] = None
    ):
        self.root = Path(root).resolve()
        self.include_patterns = include_patterns or self.DEFAULT_INCLUDE
        self.exclude_patterns = exclude_patterns or self.DEFAULT_EXCLUDE
        self.markers: List[CodeMarker] = []

    def _should_process(self, path: Path) -> bool:
        """Check if file should be processed."""
        # Check excludes
        for exclude in self.exclude_patterns:
            if exclude in str(path):
                return False

        # Check includes
        for include in self.include_patterns:
            if path.match(include):
                return True

        return False

    def _get_language(self, path: Path) -> Optional[str]:
        """Get language from file extension."""
        return self.EXT_TO_LANG.get(path.suffix.lower())

    def _get_context(self, lines: List[str], line_num: int, context_lines: int = 2) -> str:
        """Get surrounding context for a marker."""
        start = max(0, line_num - context_lines - 1)
        end = min(len(lines), line_num + context_lines)
        context_lines_list = lines[start:end]
        return '\n'.join(f'{i+start+1}: {l}' for i, l in enumerate(context_lines_list))

    def scan_file(self, file_path: Path) -> List[CodeMarker]:
        """Scan a file for markers and stubs."""
        markers = []

        try:
            content = file_path.read_text(encoding='utf-8', errors='replace')
        except Exception as e:
            print(f"Warning: Could not read {file_path}: {e}")
            return markers

        lines = content.split('\n')
        rel_path = str(file_path.relative_to(self.root))
        language = self._get_language(file_path)

        for line_num, line in enumerate(lines, 1):
            # Check standard markers (TODO, FIXME, etc.)
            for marker_type, (severity, pattern) in self.MARKERS.items():
                match = pattern.search(line)
                if match:
                    markers.append(CodeMarker(
                        file=rel_path,
                        line_number=line_num,
                        marker_type=marker_type,
                        content=match.group(1).strip() if match.groups() else line.strip(),
                        context=self._get_context(lines, line_num),
                        severity=severity
                    ))

            # Check language-specific stubs
            if language and language in self.STUB_PATTERNS:
                for pattern, severity, stub_type in self.STUB_PATTERNS[language]:
                    if pattern.search(line):
                        markers.append(CodeMarker(
                            file=rel_path,
                            line_number=line_num,
                            marker_type=f'STUB:{stub_type}',
                            content=line.strip(),
                            context=self._get_context(lines, line_num),
                            severity=severity
                        ))

            # Check placeholder patterns
            for pattern, severity, placeholder_type in self.PLACEHOLDER_PATTERNS:
                if pattern.search(line):
                    markers.append(CodeMarker(
                        file=rel_path,
                        line_number=line_num,
                        marker_type=f'PLACEHOLDER:{placeholder_type}',
                        content=line.strip(),
                        context=self._get_context(lines, line_num),
                        severity=severity
                    ))

        return markers

    def run(self) -> Dict:
        """Run scan on all matching files."""
        print(f"Scanning {self.root} for stubs and TODOs...")

        files_scanned = 0

        for pattern in self.include_patterns:
            for file_path in self.root.rglob(pattern):
                if not self._should_process(file_path):
                    continue

                if file_path.is_file():
                    files_scanned += 1
                    file_markers = self.scan_file(file_path)
                    self.markers.extend(file_markers)

        print(f"Scanned {files_scanned} files, found {len(self.markers)} markers")

        # Group by type
        by_type: Dict[str, int] = {}
        for m in self.markers:
            base_type = m.marker_type.split(':')[0]
            by_type[base_type] = by_type.get(base_type, 0) + 1

        # Group by severity
        by_severity: Dict[str, int] = {}
        for m in self.markers:
            by_severity[m.severity] = by_severity.get(m.severity, 0) + 1

        # Group by file
        by_file: Dict[str, int] = {}
        for m in self.markers:
            by_file[m.file] = by_file.get(m.file, 0) + 1

        # Get top files by marker count
        top_files = sorted(by_file.items(), key=lambda x: -x[1])[:10]

        # Separate by type for report
        todos = [asdict(m) for m in self.markers if 'TODO' in m.marker_type]
        fixmes = [asdict(m) for m in self.markers if 'FIXME' in m.marker_type or 'BUG' in m.marker_type]
        stubs = [asdict(m) for m in self.markers if 'STUB' in m.marker_type]
        placeholders = [asdict(m) for m in self.markers if 'PLACEHOLDER' in m.marker_type]
        other = [asdict(m) for m in self.markers if not any(
            t in m.marker_type for t in ['TODO', 'FIXME', 'BUG', 'STUB', 'PLACEHOLDER']
        )]

        return {
            'files_scanned': files_scanned,
            'total_markers': len(self.markers),
            'by_type': by_type,
            'by_severity': by_severity,
            'top_files': top_files,
            'todos': todos,
            'fixmes': fixmes,
            'stubs': stubs,
            'placeholders': placeholders,
            'other': other,
            'summary': {
                'error_count': by_severity.get('error', 0),
                'warning_count': by_severity.get('warning', 0),
                'info_count': by_severity.get('info', 0),
            }
        }


def main():
    parser = argparse.ArgumentParser(description='Scan for stubs and TODOs')
    parser.add_argument('--root', type=str, default='.', help='Project root')
    parser.add_argument('--output', type=str, help='Output JSON file')
    parser.add_argument('--include', type=str, nargs='*', help='File patterns to include')
    parser.add_argument('--exclude', type=str, nargs='*', help='Patterns to exclude')

    args = parser.parse_args()

    scanner = StubScanner(
        root=args.root,
        include_patterns=args.include,
        exclude_patterns=args.exclude
    )

    report = scanner.run()

    json_output = json.dumps(report, indent=2)

    if args.output:
        Path(args.output).write_text(json_output)
        print(f"Report written to {args.output}")
        print(f"\nSummary:")
        print(f"  Errors: {report['summary']['error_count']}")
        print(f"  Warnings: {report['summary']['warning_count']}")
        print(f"  Info: {report['summary']['info_count']}")
    else:
        print(json_output)


if __name__ == '__main__':
    main()
