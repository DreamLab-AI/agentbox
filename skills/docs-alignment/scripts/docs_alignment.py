#!/usr/bin/env python3
"""
Documentation Alignment Master Script

Orchestrates all documentation validation scripts and generates comprehensive report.

Usage:
    python docs_alignment.py --project-root /path/to/project
"""

import argparse
import json
import os
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import Dict, Optional


class DocumentationAligner:
    """Master orchestrator for documentation alignment."""

    def __init__(self, project_root: Path, output_dir: Optional[Path] = None):
        self.project_root = Path(project_root).resolve()
        self.output_dir = output_dir or (self.project_root / '.doc-alignment-reports')
        self.scripts_dir = Path(__file__).parent
        self.reports: Dict[str, Path] = {}

    def setup(self) -> None:
        """Set up output directory."""
        self.output_dir.mkdir(parents=True, exist_ok=True)
        print(f"Output directory: {self.output_dir}")

    def run_script(self, script_name: str, args: list) -> bool:
        """Run a validation script."""
        script_path = self.scripts_dir / script_name
        if not script_path.exists():
            print(f"Warning: Script not found: {script_path}")
            return False

        cmd = [sys.executable, str(script_path)] + args
        print(f"\nRunning: {' '.join(cmd[:3])}...")

        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=300  # 5 minute timeout
            )
            if result.returncode != 0 and 'error' not in script_name.lower():
                # Non-zero exit is OK for validation scripts (means issues found)
                pass
            if result.stderr:
                print(f"  Stderr: {result.stderr[:200]}")
            return True
        except subprocess.TimeoutExpired:
            print(f"  Timeout running {script_name}")
            return False
        except Exception as e:
            print(f"  Error running {script_name}: {e}")
            return False

    def validate_links(self) -> bool:
        """Run link validation."""
        output_path = self.output_dir / 'link-report.json'
        self.reports['links'] = output_path

        return self.run_script('validate_links.py', [
            '--root', str(self.project_root),
            '--docs-dir', 'docs',
            '--output', str(output_path)
        ])

    def check_mermaid(self) -> bool:
        """Run mermaid validation."""
        output_path = self.output_dir / 'mermaid-report.json'
        self.reports['mermaid'] = output_path

        docs_path = self.project_root / 'docs'
        if not docs_path.exists():
            docs_path = self.project_root

        return self.run_script('check_mermaid.py', [
            '--root', str(docs_path),
            '--output', str(output_path)
        ])

    def detect_ascii(self) -> bool:
        """Run ASCII diagram detection."""
        output_path = self.output_dir / 'ascii-report.json'
        self.reports['ascii'] = output_path

        docs_path = self.project_root / 'docs'
        if not docs_path.exists():
            docs_path = self.project_root

        return self.run_script('detect_ascii.py', [
            '--root', str(docs_path),
            '--output', str(output_path)
        ])

    def archive_working(self) -> bool:
        """Run working document detection."""
        output_path = self.output_dir / 'archive-report.json'
        self.reports['archive'] = output_path

        return self.run_script('archive_working_docs.py', [
            '--root', str(self.project_root),
            '--output', str(output_path)
        ])

    def scan_stubs(self) -> bool:
        """Run stub scanning."""
        output_path = self.output_dir / 'stubs-report.json'
        self.reports['stubs'] = output_path

        return self.run_script('scan_stubs.py', [
            '--root', str(self.project_root),
            '--output', str(output_path)
        ])

    def generate_report(self) -> bool:
        """Generate final report."""
        output_path = self.project_root / 'docs' / 'DOCUMENTATION_ISSUES.md'

        # Ensure docs directory exists
        output_path.parent.mkdir(parents=True, exist_ok=True)

        args = [
            '--output', str(output_path),
            '--project-name', self.project_root.name
        ]

        if self.reports.get('links'):
            args.extend(['--link-report', str(self.reports['links'])])
        if self.reports.get('mermaid'):
            args.extend(['--mermaid-report', str(self.reports['mermaid'])])
        if self.reports.get('ascii'):
            args.extend(['--ascii-report', str(self.reports['ascii'])])
        if self.reports.get('archive'):
            args.extend(['--archive-report', str(self.reports['archive'])])
        if self.reports.get('stubs'):
            args.extend(['--stubs-report', str(self.reports['stubs'])])

        success = self.run_script('generate_report.py', args)

        if success:
            print(f"\n{'='*60}")
            print(f"Final report: {output_path}")
            print(f"{'='*60}")

        return success

    def run_all(self) -> Dict:
        """Run all validation steps."""
        self.setup()

        print(f"\n{'='*60}")
        print("Documentation Alignment - Full Scan")
        print(f"Project: {self.project_root}")
        print(f"Started: {datetime.now().isoformat()}")
        print(f"{'='*60}")

        results = {
            'links': self.validate_links(),
            'mermaid': self.check_mermaid(),
            'ascii': self.detect_ascii(),
            'archive': self.archive_working(),
            'stubs': self.scan_stubs(),
        }

        results['report'] = self.generate_report()

        # Print summary
        print(f"\n{'='*60}")
        print("Scan Complete - Summary")
        print(f"{'='*60}")

        for name, success in results.items():
            status = '✓' if success else '✗'
            print(f"  {status} {name}")

        # Load and print quick summary from reports
        self._print_quick_summary()

        return results

    def _print_quick_summary(self) -> None:
        """Print quick summary from reports."""
        print(f"\n{'='*60}")
        print("Quick Summary")
        print(f"{'='*60}")

        try:
            if self.reports.get('links') and self.reports['links'].exists():
                data = json.loads(self.reports['links'].read_text())
                print(f"  Links: {data.get('valid_links', 0)} valid, "
                      f"{len(data.get('broken_links', []))} broken")
                print(f"  Orphan docs: {len(data.get('orphan_docs', []))}")

            if self.reports.get('mermaid') and self.reports['mermaid'].exists():
                data = json.loads(self.reports['mermaid'].read_text())
                print(f"  Mermaid: {data.get('valid_diagrams', 0)} valid, "
                      f"{data.get('invalid_diagrams', 0)} invalid")

            if self.reports.get('ascii') and self.reports['ascii'].exists():
                data = json.loads(self.reports['ascii'].read_text())
                print(f"  ASCII diagrams: {data.get('total_detected', 0)} detected")

            if self.reports.get('archive') and self.reports['archive'].exists():
                data = json.loads(self.reports['archive'].read_text())
                print(f"  Working docs: {data.get('total_found', 0)} to archive")

            if self.reports.get('stubs') and self.reports['stubs'].exists():
                data = json.loads(self.reports['stubs'].read_text())
                summary = data.get('summary', {})
                print(f"  Stubs: {summary.get('error_count', 0)} errors, "
                      f"{summary.get('warning_count', 0)} warnings")

        except Exception as e:
            print(f"  (Could not load summary: {e})")


def main():
    parser = argparse.ArgumentParser(
        description='Documentation Alignment - Full Scan',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
    # Run full scan
    python docs_alignment.py --project-root /path/to/project

    # Run with custom output directory
    python docs_alignment.py --project-root . --output-dir ./reports
        """
    )
    parser.add_argument(
        '--project-root',
        type=str,
        default='.',
        help='Project root directory (default: current directory)'
    )
    parser.add_argument(
        '--output-dir',
        type=str,
        help='Directory for intermediate reports (default: .doc-alignment-reports)'
    )

    args = parser.parse_args()

    aligner = DocumentationAligner(
        project_root=args.project_root,
        output_dir=Path(args.output_dir) if args.output_dir else None
    )

    results = aligner.run_all()

    # Exit with error if any critical issues
    if not all(results.values()):
        sys.exit(1)


if __name__ == '__main__':
    main()
