#!/usr/bin/env python3
"""
Mermaid Diagram Validator

Validates mermaid diagram syntax and checks GitHub rendering compatibility.

Usage:
    python check_mermaid.py --root /path/to/docs --output report.json
"""

import argparse
import json
import re
import subprocess
import sys
import tempfile
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Dict, List, Optional, Tuple


@dataclass
class MermaidDiagram:
    """Information about a mermaid diagram."""
    file: str
    start_line: int
    end_line: int
    diagram_type: str
    content: str
    is_valid: bool
    error_message: Optional[str] = None
    warnings: Optional[List[str]] = None


class MermaidValidator:
    """Validates mermaid diagrams in markdown files."""

    # Regex to find mermaid code blocks
    MERMAID_BLOCK_PATTERN = re.compile(
        r'```mermaid\s*\n(.*?)\n```',
        re.DOTALL | re.IGNORECASE
    )

    # Known mermaid diagram types
    DIAGRAM_TYPES = {
        'flowchart': r'^(flowchart|graph)\s+(TB|TD|BT|RL|LR)',
        'sequenceDiagram': r'^sequenceDiagram',
        'classDiagram': r'^classDiagram',
        'stateDiagram': r'^stateDiagram(-v2)?',
        'erDiagram': r'^erDiagram',
        'gantt': r'^gantt',
        'pie': r'^pie',
        'journey': r'^journey',
        'gitGraph': r'^gitGraph',
        'mindmap': r'^mindmap',
        'timeline': r'^timeline',
        'quadrantChart': r'^quadrantChart',
        'xychart-beta': r'^xychart-beta',
        'block-beta': r'^block-beta',
        'sankey-beta': r'^sankey-beta',
        'requirement': r'^requirementDiagram',
        'c4': r'^C4(Context|Container|Component|Deployment)',
    }

    # Common syntax errors and their suggestions
    COMMON_ERRORS = {
        r'-->>\s': ('-->>| |', 'Arrow with text needs label in pipes'),
        r'-->\s+\|': ('-->|text|', 'Label should follow arrow directly'),
        r'\bclass\s+\w+\s*{': (None, 'Use classDiagram syntax for class definitions'),
        r'Note\s+over': (None, 'Note syntax: "Note over Actor: Text"'),
    }

    # GitHub-specific compatibility issues
    GITHUB_ISSUES = {
        r'%%{init:': 'GitHub may not support all init directives',
        r'callback\s': 'Callbacks not supported in GitHub rendering',
        r'click\s': 'Click events not rendered in GitHub',
        r'linkStyle\s+default': 'Default linkStyle may render differently',
    }

    def __init__(self, root: Path, strict: bool = False):
        self.root = Path(root).resolve()
        self.strict = strict
        self.diagrams: List[MermaidDiagram] = []
        self.has_mmdc = self._check_mmdc()

    def _check_mmdc(self) -> bool:
        """Check if mermaid-cli (mmdc) is available."""
        try:
            result = subprocess.run(
                ['mmdc', '--version'],
                capture_output=True,
                text=True,
                timeout=5
            )
            return result.returncode == 0
        except (subprocess.SubprocessError, FileNotFoundError):
            return False

    def _detect_diagram_type(self, content: str) -> str:
        """Detect the type of mermaid diagram."""
        content_stripped = content.strip()
        for dtype, pattern in self.DIAGRAM_TYPES.items():
            if re.match(pattern, content_stripped, re.IGNORECASE | re.MULTILINE):
                return dtype
        return 'unknown'

    def _find_line_number(self, file_content: str, block_start: int) -> int:
        """Find the line number of a character position."""
        return file_content[:block_start].count('\n') + 1

    def _validate_syntax(self, content: str) -> Tuple[bool, Optional[str], List[str]]:
        """Validate mermaid syntax."""
        warnings = []

        # Check for common syntax errors
        for pattern, (fix, message) in self.COMMON_ERRORS.items():
            if re.search(pattern, content):
                return False, message, warnings

        # Check for GitHub compatibility issues
        for pattern, warning in self.GITHUB_ISSUES.items():
            if re.search(pattern, content):
                warnings.append(warning)

        # Basic syntax validation
        # Check balanced brackets
        brackets = {'(': ')', '[': ']', '{': '}'}
        stack = []
        in_string = False
        string_char = None

        for i, char in enumerate(content):
            if char in '"\'`' and (i == 0 or content[i-1] != '\\'):
                if not in_string:
                    in_string = True
                    string_char = char
                elif char == string_char:
                    in_string = False
                    string_char = None
            elif not in_string:
                if char in brackets:
                    stack.append(brackets[char])
                elif char in brackets.values():
                    if not stack or stack.pop() != char:
                        return False, f"Unbalanced bracket '{char}'", warnings

        if stack:
            return False, f"Unclosed bracket(s): {stack}", warnings

        # Use mmdc for full validation if available
        if self.has_mmdc:
            try:
                with tempfile.NamedTemporaryFile(
                    mode='w',
                    suffix='.mmd',
                    delete=False
                ) as f:
                    f.write(content)
                    f.flush()

                    result = subprocess.run(
                        ['mmdc', '-i', f.name, '-o', '/dev/null', '--quiet'],
                        capture_output=True,
                        text=True,
                        timeout=10
                    )

                    if result.returncode != 0:
                        error_msg = result.stderr.strip() or 'Mermaid syntax error'
                        # Clean up the error message
                        error_msg = re.sub(r'\x1b\[[0-9;]*m', '', error_msg)
                        return False, error_msg[:200], warnings

            except subprocess.TimeoutExpired:
                warnings.append('Validation timeout - diagram may be too complex')
            except Exception as e:
                warnings.append(f'Could not run mmdc: {e}')
            finally:
                try:
                    Path(f.name).unlink()
                except:
                    pass

        return True, None, warnings

    def scan_file(self, file_path: Path) -> List[MermaidDiagram]:
        """Scan a file for mermaid diagrams."""
        diagrams = []

        try:
            content = file_path.read_text(encoding='utf-8', errors='replace')
        except Exception as e:
            print(f"Warning: Could not read {file_path}: {e}")
            return diagrams

        for match in self.MERMAID_BLOCK_PATTERN.finditer(content):
            diagram_content = match.group(1)
            start_pos = match.start()
            end_pos = match.end()

            start_line = self._find_line_number(content, start_pos)
            end_line = self._find_line_number(content, end_pos)

            diagram_type = self._detect_diagram_type(diagram_content)
            is_valid, error_msg, warnings = self._validate_syntax(diagram_content)

            # In strict mode, warnings become errors
            if self.strict and warnings:
                is_valid = False
                error_msg = error_msg or f"Warnings: {'; '.join(warnings)}"

            diagrams.append(MermaidDiagram(
                file=str(file_path.relative_to(self.root)),
                start_line=start_line,
                end_line=end_line,
                diagram_type=diagram_type,
                content=diagram_content[:500] + ('...' if len(diagram_content) > 500 else ''),
                is_valid=is_valid,
                error_message=error_msg,
                warnings=warnings if warnings else None
            ))

        return diagrams

    def run(self) -> Dict:
        """Run validation on all markdown files."""
        print(f"Scanning {self.root} for mermaid diagrams...")
        print(f"Mermaid CLI (mmdc) available: {self.has_mmdc}")

        md_files = list(self.root.rglob('*.md'))
        print(f"Found {len(md_files)} markdown files")

        for md_file in md_files:
            # Skip common excludes
            if any(part in str(md_file) for part in ['node_modules', '.git', 'target']):
                continue

            file_diagrams = self.scan_file(md_file)
            self.diagrams.extend(file_diagrams)

        valid_diagrams = [d for d in self.diagrams if d.is_valid]
        invalid_diagrams = [d for d in self.diagrams if not d.is_valid]

        # Group by type
        by_type: Dict[str, int] = {}
        for d in self.diagrams:
            by_type[d.diagram_type] = by_type.get(d.diagram_type, 0) + 1

        return {
            'total_diagrams': len(self.diagrams),
            'valid_diagrams': len(valid_diagrams),
            'invalid_diagrams': len(invalid_diagrams),
            'by_type': by_type,
            'mmdc_available': self.has_mmdc,
            'valid_diagram_list': [asdict(d) for d in valid_diagrams],
            'invalid_diagram_list': [asdict(d) for d in invalid_diagrams],
            'suggestions': self._generate_suggestions()
        }

    def _generate_suggestions(self) -> List[str]:
        """Generate suggestions for improving diagrams."""
        suggestions = []

        if not self.has_mmdc:
            suggestions.append(
                "Install mermaid-cli for full syntax validation: "
                "npm install -g @mermaid-js/mermaid-cli"
            )

        unknown_types = sum(1 for d in self.diagrams if d.diagram_type == 'unknown')
        if unknown_types:
            suggestions.append(
                f"{unknown_types} diagram(s) have unknown types. "
                "Consider adding explicit type declarations (e.g., 'flowchart TB')"
            )

        warnings_count = sum(
            len(d.warnings or []) for d in self.diagrams
        )
        if warnings_count:
            suggestions.append(
                f"{warnings_count} warning(s) about GitHub compatibility. "
                "Review diagrams for features that may not render on GitHub."
            )

        return suggestions


def main():
    parser = argparse.ArgumentParser(description='Validate mermaid diagrams')
    parser.add_argument('--root', type=str, default='.', help='Directory to scan')
    parser.add_argument('--output', type=str, help='Output JSON file')
    parser.add_argument('--strict', action='store_true', help='Treat warnings as errors')

    args = parser.parse_args()

    validator = MermaidValidator(root=args.root, strict=args.strict)
    report = validator.run()

    json_output = json.dumps(report, indent=2)

    if args.output:
        Path(args.output).write_text(json_output)
        print(f"Report written to {args.output}")
        print(f"\nSummary: {report['valid_diagrams']}/{report['total_diagrams']} valid diagrams")
    else:
        print(json_output)

    # Exit with error if invalid diagrams found
    if report['invalid_diagrams'] > 0:
        sys.exit(1)


if __name__ == '__main__':
    main()
