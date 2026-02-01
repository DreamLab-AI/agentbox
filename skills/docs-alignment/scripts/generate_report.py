#!/usr/bin/env python3
"""
Documentation Issues Report Generator

Compiles findings from all validation scripts into a comprehensive report.

Usage:
    python generate_report.py \
        --link-report link-report.json \
        --mermaid-report mermaid-report.json \
        --ascii-report ascii-report.json \
        --archive-report archive-report.json \
        --stubs-report stubs-report.json \
        --output DOCUMENTATION_ISSUES.md
"""

import argparse
import json
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional


class ReportGenerator:
    """Generates comprehensive documentation issues report."""

    def __init__(self, project_name: str = 'Project'):
        self.project_name = project_name
        self.reports: Dict[str, Dict] = {}

    def load_report(self, name: str, path: Optional[str]) -> None:
        """Load a JSON report file."""
        if path and Path(path).exists():
            try:
                self.reports[name] = json.loads(Path(path).read_text())
            except Exception as e:
                print(f"Warning: Could not load {name} report: {e}")
                self.reports[name] = {}
        else:
            self.reports[name] = {}

    def _format_table(self, headers: List[str], rows: List[List[str]]) -> str:
        """Format data as markdown table."""
        if not rows:
            return '_No items found._\n'

        # Calculate column widths
        widths = [len(h) for h in headers]
        for row in rows:
            for i, cell in enumerate(row):
                if i < len(widths):
                    widths[i] = max(widths[i], len(str(cell)))

        # Build table
        lines = []

        # Header
        header_line = '| ' + ' | '.join(
            str(h).ljust(widths[i]) for i, h in enumerate(headers)
        ) + ' |'
        lines.append(header_line)

        # Separator
        sep_line = '|' + '|'.join('-' * (w + 2) for w in widths) + '|'
        lines.append(sep_line)

        # Rows
        for row in rows:
            row_line = '| ' + ' | '.join(
                str(cell).ljust(widths[i]) if i < len(widths) else str(cell)
                for i, cell in enumerate(row)
            ) + ' |'
            lines.append(row_line)

        return '\n'.join(lines) + '\n'

    def _generate_summary(self) -> str:
        """Generate summary section."""
        link_report = self.reports.get('links', {})
        mermaid_report = self.reports.get('mermaid', {})
        ascii_report = self.reports.get('ascii', {})
        archive_report = self.reports.get('archive', {})
        stubs_report = self.reports.get('stubs', {})

        rows = []

        broken_links = len(link_report.get('broken_links', []))
        if broken_links:
            rows.append(['Broken Links', str(broken_links), 'High'])

        orphan_docs = len(link_report.get('orphan_docs', []))
        if orphan_docs:
            rows.append(['Orphan Documents', str(orphan_docs), 'Medium'])

        invalid_mermaid = mermaid_report.get('invalid_diagrams', 0)
        if invalid_mermaid:
            rows.append(['Invalid Mermaid Diagrams', str(invalid_mermaid), 'Medium'])

        ascii_diagrams = ascii_report.get('high_confidence', 0)
        if ascii_diagrams:
            rows.append(['ASCII Diagrams to Convert', str(ascii_diagrams), 'Low'])

        working_docs = archive_report.get('total_found', 0)
        if working_docs:
            rows.append(['Working Documents to Archive', str(working_docs), 'Low'])

        stubs_summary = stubs_report.get('summary', {})
        if stubs_summary.get('error_count', 0):
            rows.append(['Critical Stubs (Errors)', str(stubs_summary['error_count']), 'High'])
        if stubs_summary.get('warning_count', 0):
            rows.append(['TODOs/FIXMEs', str(stubs_summary['warning_count']), 'Medium'])

        if not rows:
            return '**No issues found!** Documentation is clean.\n'

        return self._format_table(['Category', 'Count', 'Severity'], rows)

    def _generate_broken_links_section(self) -> str:
        """Generate broken links section."""
        link_report = self.reports.get('links', {})
        broken = link_report.get('broken_links', [])

        if not broken:
            return '_No broken links found._\n'

        # Group by severity (internal vs external)
        internal = [b for b in broken if b.get('link_type') != 'external']
        external = [b for b in broken if b.get('link_type') == 'external']

        sections = []

        if internal:
            sections.append('### Internal Links\n')
            rows = [[
                b.get('source_file', 'N/A'),
                str(b.get('line_number', 'N/A')),
                b.get('link_target', 'N/A')[:50],
                b.get('error_message', 'Not found')[:30]
            ] for b in internal[:20]]
            sections.append(self._format_table(
                ['File', 'Line', 'Link', 'Error'], rows
            ))
            if len(internal) > 20:
                sections.append(f'_...and {len(internal) - 20} more_\n')

        if external:
            sections.append('### External Links\n')
            rows = [[
                b.get('source_file', 'N/A'),
                str(b.get('line_number', 'N/A')),
                b.get('link_target', 'N/A')[:40],
                b.get('error_message', 'Failed')[:20]
            ] for b in external[:10]]
            sections.append(self._format_table(
                ['File', 'Line', 'URL', 'Status'], rows
            ))

        return '\n'.join(sections)

    def _generate_orphan_docs_section(self) -> str:
        """Generate orphan documents section."""
        link_report = self.reports.get('links', {})
        orphans = link_report.get('orphan_docs', [])

        if not orphans:
            return '_No orphan documents found._\n'

        lines = ['Documents with no inbound links:\n']
        for orphan in orphans[:20]:
            lines.append(f'- `{orphan}`')

        if len(orphans) > 20:
            lines.append(f'\n_...and {len(orphans) - 20} more_')

        return '\n'.join(lines) + '\n'

    def _generate_mermaid_section(self) -> str:
        """Generate mermaid diagrams section."""
        mermaid_report = self.reports.get('mermaid', {})
        invalid = mermaid_report.get('invalid_diagram_list', [])

        if not invalid:
            return '_All mermaid diagrams are valid._\n'

        rows = [[
            d.get('file', 'N/A'),
            str(d.get('start_line', 'N/A')),
            d.get('diagram_type', 'unknown'),
            d.get('error_message', 'Unknown error')[:40]
        ] for d in invalid[:15]]

        result = self._format_table(['File', 'Line', 'Type', 'Error'], rows)

        if len(invalid) > 15:
            result += f'\n_...and {len(invalid) - 15} more_\n'

        return result

    def _generate_ascii_section(self) -> str:
        """Generate ASCII diagrams section."""
        ascii_report = self.reports.get('ascii', {})
        diagrams = ascii_report.get('priority_conversions', [])

        if not diagrams:
            return '_No ASCII diagrams requiring conversion._\n'

        rows = [[
            d.get('file', 'N/A'),
            f"{d.get('start_line', '?')}-{d.get('end_line', '?')}",
            d.get('diagram_type', 'unknown'),
            d.get('suggestion', '')[:30]
        ] for d in diagrams[:10]]

        result = self._format_table(['File', 'Lines', 'Type', 'Suggestion'], rows)

        total = ascii_report.get('total_detected', 0)
        if total > 10:
            result += f'\n_...and {total - 10} more potential diagrams_\n'

        return result

    def _generate_archive_section(self) -> str:
        """Generate working documents section."""
        archive_report = self.reports.get('archive', {})
        docs = archive_report.get('working_docs', [])

        if not docs:
            return '_No working documents to archive._\n'

        rows = [[
            d.get('file', 'N/A'),
            d.get('suggested_archive_path', 'N/A'),
            d.get('reason', 'N/A')[:40]
        ] for d in docs[:15]]

        result = self._format_table(
            ['Current Location', 'Suggested Archive', 'Reason'], rows
        )

        if len(docs) > 15:
            result += f'\n_...and {len(docs) - 15} more_\n'

        return result

    def _generate_stubs_section(self) -> str:
        """Generate stubs and TODOs section."""
        stubs_report = self.reports.get('stubs', {})

        sections = []

        # Critical stubs (errors)
        stubs = stubs_report.get('stubs', [])
        if stubs:
            sections.append('### Critical Stubs\n')
            rows = [[
                s.get('file', 'N/A'),
                str(s.get('line_number', 'N/A')),
                s.get('marker_type', 'N/A').replace('STUB:', ''),
                s.get('content', 'N/A')[:40]
            ] for s in stubs[:10]]
            sections.append(self._format_table(['File', 'Line', 'Type', 'Content'], rows))

        # FIXMEs
        fixmes = stubs_report.get('fixmes', [])
        if fixmes:
            sections.append('### FIXMEs and Bugs\n')
            rows = [[
                f.get('file', 'N/A'),
                str(f.get('line_number', 'N/A')),
                f.get('marker_type', 'N/A'),
                f.get('content', 'N/A')[:40]
            ] for f in fixmes[:10]]
            sections.append(self._format_table(['File', 'Line', 'Type', 'Content'], rows))

        # TODOs
        todos = stubs_report.get('todos', [])
        if todos:
            sections.append('### TODOs\n')
            rows = [[
                t.get('file', 'N/A'),
                str(t.get('line_number', 'N/A')),
                t.get('content', 'N/A')[:50]
            ] for t in todos[:15]]
            sections.append(self._format_table(['File', 'Line', 'Content'], rows))
            if len(todos) > 15:
                sections.append(f'_...and {len(todos) - 15} more TODOs_\n')

        if not sections:
            return '_No stubs or TODOs found._\n'

        return '\n'.join(sections)

    def generate(self) -> str:
        """Generate the complete report."""
        now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

        report = f"""# Documentation Issues Report

**Generated:** {now}
**Project:** {self.project_name}

---

## Summary

{self._generate_summary()}

---

## Broken Links

{self._generate_broken_links_section()}

---

## Orphan Documents

{self._generate_orphan_docs_section()}

---

## Invalid Mermaid Diagrams

{self._generate_mermaid_section()}

---

## ASCII Diagrams to Convert

{self._generate_ascii_section()}

---

## Working Documents to Archive

{self._generate_archive_section()}

---

## Stubs and TODOs

{self._generate_stubs_section()}

---

## Recommendations

### High Priority
1. Fix all broken internal links
2. Resolve unimplemented stubs (error severity)
3. Address FIXME markers

### Medium Priority
1. Fix invalid mermaid diagrams
2. Link orphan documents or archive them
3. Review TODOs for relevance

### Low Priority
1. Convert ASCII diagrams to mermaid
2. Archive working documents
3. Clean up placeholder comments

---

_Report generated by Documentation Alignment Skill_
"""
        return report


def main():
    parser = argparse.ArgumentParser(description='Generate documentation issues report')
    parser.add_argument('--link-report', type=str, help='Link validation report JSON')
    parser.add_argument('--mermaid-report', type=str, help='Mermaid validation report JSON')
    parser.add_argument('--ascii-report', type=str, help='ASCII detection report JSON')
    parser.add_argument('--archive-report', type=str, help='Archive report JSON')
    parser.add_argument('--stubs-report', type=str, help='Stubs scan report JSON')
    parser.add_argument('--project-name', type=str, default='Project', help='Project name')
    parser.add_argument('--output', type=str, default='DOCUMENTATION_ISSUES.md',
                       help='Output markdown file')

    args = parser.parse_args()

    generator = ReportGenerator(project_name=args.project_name)

    # Load reports
    generator.load_report('links', args.link_report)
    generator.load_report('mermaid', args.mermaid_report)
    generator.load_report('ascii', args.ascii_report)
    generator.load_report('archive', args.archive_report)
    generator.load_report('stubs', args.stubs_report)

    # Generate report
    report = generator.generate()

    # Write output
    Path(args.output).write_text(report)
    print(f"Report written to {args.output}")


if __name__ == '__main__':
    main()
