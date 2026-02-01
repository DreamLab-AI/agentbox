#!/usr/bin/env python3
"""
ASCII Diagram Detector

Detects ASCII-based diagrams in documentation that should be converted to mermaid.

Usage:
    python detect_ascii.py --root /path/to/docs --output report.json
"""

import argparse
import json
import re
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple


@dataclass
class AsciiDiagram:
    """Information about a detected ASCII diagram."""
    file: str
    start_line: int
    end_line: int
    diagram_type: str
    preview: str
    confidence: float  # 0.0 to 1.0
    suggestion: Optional[str] = None


class AsciiDiagramDetector:
    """Detects ASCII diagrams in markdown files."""

    # Box-drawing characters (Unicode)
    BOX_CHARS = set('─│┌┐└┘├┤┬┴┼╔╗╚╝║═╠╣╦╩╬┏┓┗┛┃━┣┫┳┻╋')

    # ASCII box characters
    ASCII_BOX = set('+-|')

    # Arrow patterns
    ARROW_PATTERNS = [
        r'-->',           # Standard arrow
        r'<--',           # Reverse arrow
        r'<-->',          # Bidirectional
        r'==>',           # Double arrow
        r'<==',           # Reverse double
        r'\|->',          # Pipe arrow
        r'<-\|',          # Reverse pipe
        r'->',            # Simple arrow
        r'<-',            # Simple reverse
        r'\.\.>',         # Dotted arrow
        r'<\.\.>',        # Dotted bidirectional
    ]

    # Flow/process indicators
    FLOW_INDICATORS = [
        r'\[\s*\w+\s*\]',       # [box]
        r'\(\s*\w+\s*\)',       # (circle)
        r'\{\s*\w+\s*\}',       # {diamond}
        r'<\s*\w+\s*>',         # <angle>
    ]

    # Tree patterns
    TREE_PATTERNS = [
        r'^\s*[\|│]\s*$',           # Vertical line
        r'^\s*[\|│][-─]+',          # Branch start
        r'^\s*[├└┣┗]\s*[-─]*\s*',   # Tree branch
        r'^\s*\+[-─]+',             # ASCII tree branch
    ]

    def __init__(self, root: Path, min_lines: int = 3):
        self.root = Path(root).resolve()
        self.min_lines = min_lines
        self.diagrams: List[AsciiDiagram] = []

    def _has_box_chars(self, line: str) -> bool:
        """Check if line contains box-drawing characters."""
        return bool(self.BOX_CHARS.intersection(line))

    def _has_ascii_box(self, line: str) -> bool:
        """Check if line has ASCII box patterns."""
        # Look for patterns like +---+ or |   |
        if re.search(r'\+[-+]+\+', line):
            return True
        if re.search(r'\|[^|]+\|', line):
            return True
        return False

    def _has_arrows(self, line: str) -> bool:
        """Check if line contains arrow patterns."""
        for pattern in self.ARROW_PATTERNS:
            if re.search(pattern, line):
                return True
        return False

    def _has_flow_shapes(self, line: str) -> bool:
        """Check if line has flow diagram shapes."""
        shapes_found = 0
        for pattern in self.FLOW_INDICATORS:
            if re.search(pattern, line):
                shapes_found += 1
        return shapes_found >= 2

    def _is_tree_line(self, line: str) -> bool:
        """Check if line is part of a tree diagram."""
        for pattern in self.TREE_PATTERNS:
            if re.match(pattern, line):
                return True
        return False

    def _classify_diagram(
        self,
        lines: List[str]
    ) -> Tuple[str, float, Optional[str]]:
        """Classify the type of ASCII diagram and suggest mermaid equivalent."""
        content = '\n'.join(lines)

        # Count indicators
        box_lines = sum(1 for l in lines if self._has_box_chars(l) or self._has_ascii_box(l))
        arrow_lines = sum(1 for l in lines if self._has_arrows(l))
        tree_lines = sum(1 for l in lines if self._is_tree_line(l))
        flow_lines = sum(1 for l in lines if self._has_flow_shapes(l))

        total_lines = len(lines)

        # Determine type based on indicators
        if tree_lines / total_lines > 0.5:
            return 'tree', 0.8, 'Consider: graph TD or mindmap'

        if box_lines / total_lines > 0.6 and arrow_lines / total_lines > 0.2:
            if re.search(r'(start|begin|end|if|else|then)', content, re.I):
                return 'flowchart', 0.9, 'Consider: flowchart TB'
            if re.search(r'(request|response|send|receive)', content, re.I):
                return 'sequence', 0.85, 'Consider: sequenceDiagram'
            return 'flowchart', 0.7, 'Consider: flowchart LR or TB'

        if flow_lines / total_lines > 0.3:
            return 'process', 0.75, 'Consider: flowchart LR'

        if box_lines / total_lines > 0.4:
            # Check for table-like structure
            if all(line.count('|') >= 2 for line in lines if line.strip()):
                return 'table', 0.5, 'This may be a markdown table, not a diagram'
            return 'box', 0.6, 'Consider: flowchart or block-beta'

        if arrow_lines / total_lines > 0.3:
            return 'flow', 0.65, 'Consider: flowchart or sequenceDiagram'

        return 'unknown', 0.4, 'Review manually for conversion potential'

    def _extract_preview(self, lines: List[str], max_lines: int = 5) -> str:
        """Extract a preview of the diagram."""
        preview_lines = lines[:max_lines]
        if len(lines) > max_lines:
            preview_lines.append('...')
        return '\n'.join(preview_lines)

    def _is_in_code_block(
        self,
        file_lines: List[str],
        start_idx: int,
        end_idx: int
    ) -> bool:
        """Check if region is within a code block."""
        in_block = False
        for i, line in enumerate(file_lines):
            if i > end_idx:
                break
            if line.strip().startswith('```'):
                in_block = not in_block
            if i >= start_idx and in_block:
                return True
        return False

    def scan_file(self, file_path: Path) -> List[AsciiDiagram]:
        """Scan a file for ASCII diagrams."""
        diagrams = []

        try:
            content = file_path.read_text(encoding='utf-8', errors='replace')
        except Exception as e:
            print(f"Warning: Could not read {file_path}: {e}")
            return diagrams

        lines = content.split('\n')

        # Find potential diagram regions
        potential_start = None
        potential_lines: List[Tuple[int, str]] = []

        for i, line in enumerate(lines):
            is_diagram_line = (
                self._has_box_chars(line) or
                self._has_ascii_box(line) or
                self._has_arrows(line) or
                self._is_tree_line(line) or
                self._has_flow_shapes(line)
            )

            if is_diagram_line:
                if potential_start is None:
                    potential_start = i
                potential_lines.append((i, line))
            else:
                # Check if we have a potential diagram
                if len(potential_lines) >= self.min_lines:
                    # Verify it's not in a code block already
                    end_idx = potential_lines[-1][0]
                    if not self._is_in_code_block(lines, potential_start, end_idx):
                        diagram_lines = [l for _, l in potential_lines]
                        dtype, confidence, suggestion = self._classify_diagram(diagram_lines)

                        # Filter out likely tables
                        if dtype != 'table' or confidence > 0.6:
                            diagrams.append(AsciiDiagram(
                                file=str(file_path.relative_to(self.root)),
                                start_line=potential_start + 1,
                                end_line=end_idx + 1,
                                diagram_type=dtype,
                                preview=self._extract_preview(diagram_lines),
                                confidence=confidence,
                                suggestion=suggestion
                            ))

                potential_start = None
                potential_lines = []

        # Check remaining potential diagram
        if len(potential_lines) >= self.min_lines:
            end_idx = potential_lines[-1][0]
            if not self._is_in_code_block(lines, potential_start, end_idx):
                diagram_lines = [l for _, l in potential_lines]
                dtype, confidence, suggestion = self._classify_diagram(diagram_lines)
                if dtype != 'table' or confidence > 0.6:
                    diagrams.append(AsciiDiagram(
                        file=str(file_path.relative_to(self.root)),
                        start_line=potential_start + 1,
                        end_line=end_idx + 1,
                        diagram_type=dtype,
                        preview=self._extract_preview(diagram_lines),
                        confidence=confidence,
                        suggestion=suggestion
                    ))

        return diagrams

    def run(self) -> Dict:
        """Run detection on all markdown files."""
        print(f"Scanning {self.root} for ASCII diagrams...")

        md_files = list(self.root.rglob('*.md'))
        print(f"Found {len(md_files)} markdown files")

        for md_file in md_files:
            # Skip common excludes
            if any(part in str(md_file) for part in ['node_modules', '.git', 'target']):
                continue

            file_diagrams = self.scan_file(md_file)
            self.diagrams.extend(file_diagrams)

        # Group by type
        by_type: Dict[str, int] = {}
        for d in self.diagrams:
            by_type[d.diagram_type] = by_type.get(d.diagram_type, 0) + 1

        # High confidence diagrams (likely need conversion)
        high_confidence = [d for d in self.diagrams if d.confidence >= 0.7]

        return {
            'total_detected': len(self.diagrams),
            'high_confidence': len(high_confidence),
            'by_type': by_type,
            'ascii_diagrams': [asdict(d) for d in self.diagrams],
            'priority_conversions': [
                asdict(d) for d in sorted(
                    high_confidence,
                    key=lambda x: -x.confidence
                )[:10]
            ]
        }


def main():
    parser = argparse.ArgumentParser(description='Detect ASCII diagrams')
    parser.add_argument('--root', type=str, default='.', help='Directory to scan')
    parser.add_argument('--output', type=str, help='Output JSON file')
    parser.add_argument('--min-lines', type=int, default=3, help='Minimum lines for diagram')

    args = parser.parse_args()

    detector = AsciiDiagramDetector(root=args.root, min_lines=args.min_lines)
    report = detector.run()

    json_output = json.dumps(report, indent=2)

    if args.output:
        Path(args.output).write_text(json_output)
        print(f"Report written to {args.output}")
        print(f"\nSummary: {report['total_detected']} ASCII diagrams detected")
        print(f"High confidence (needs conversion): {report['high_confidence']}")
    else:
        print(json_output)


if __name__ == '__main__':
    main()
