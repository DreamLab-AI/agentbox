# Documentation Alignment Skill

Enterprise-grade documentation validation, modernization, and corpus alignment using AI swarms.

## Features

- ✅ Link validation (broken links, orphaned files)
- ✅ Frontmatter validation (YAML metadata)
- ✅ Mermaid diagram syntax validation
- ✅ ASCII diagram detection
- ✅ UK English spelling enforcement
- ✅ Diataxis structure validation
- ✅ GitHub Actions CI/CD pipeline
- ✅ Comprehensive quality reports

## Installation

```bash
# Install Python dependencies
pip install -r requirements.txt

# Install system dependencies
sudo apt-get install bc jq python3 python3-yaml

# Make scripts executable
chmod +x scripts/*.sh
```

## Quick Start

```bash
# Run all validations
./scripts/validate-all.sh

# Run individual validators
./scripts/validate-links.sh
./scripts/validate-frontmatter.sh
./scripts/validate-mermaid.sh
./scripts/detect-ascii.sh
./scripts/validate-spelling.sh
./scripts/validate-structure.sh

# Generate quality report
./scripts/generate-reports.sh
```

## CI/CD Integration

Copy `.github/workflows/docs-ci.yml` to your repository to enable automated documentation validation on every push and pull request.

**Quality Threshold:** 90% overall score required to pass

## Documentation

- [MAINTENANCE.md](../../docs/MAINTENANCE.md) - Maintenance procedures
- [CONTRIBUTION.md](../../docs/CONTRIBUTION.md) - Contribution guidelines
- [SKILL.md](SKILL.md) - Skill implementation guide

## Scripts

| Script | Purpose |
|--------|---------|
| `validate-all.sh` | Master validator (runs all checks) |
| `validate-links.sh` | Check link integrity |
| `validate-frontmatter.sh` | Check metadata |
| `validate-mermaid.sh` | Check diagrams |
| `detect-ascii.sh` | Find ASCII art |
| `validate-spelling.sh` | UK English check |
| `validate-structure.sh` | Structure validation |
| `generate-reports.sh` | Quality reports |

All scripts support `--json` flag for machine-readable output.

## License

MIT
