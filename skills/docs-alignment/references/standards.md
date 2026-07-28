# Validation Standards, Scoring & Outputs

The full catalog of what the alignment validates and fixes, the grading rubric,
and every deliverable it produces. Treat these as targets, not hard gates —
tune thresholds per project.

## What Gets Validated & Fixed

**Comprehensive Coverage**
- 100% system component documentation
- Full API endpoint coverage
- Complete feature documentation
- All configuration options documented
- Database schema documentation
- Protocol specifications
- Zero orphaned files (all discoverable)

**Technical Quality**
- 99%+ front matter compliance (YAML metadata)
- 94%+ link validity (4,165+ cross-references)
- 41+ production Mermaid diagrams (zero ASCII art)
- Bidirectional link validation
- No broken internal references
- Git-compliant diagram rendering

**Standards & Compliance**
- Diataxis framework implementation (tutorial/howto/reference/explanation)
- UK English spelling throughout
- Consistent naming conventions
- Clean file structure (max 3 directory levels)
- Standardised 45-tag vocabulary
- No developer notes/TODOs in documentation
- No stubbed or incomplete content
- Professional-grade formatting

**Navigation & Discoverability**
- Master INDEX with 226+ indexed documents
- Multiple entry points (7+ navigation paths)
- Role-based guides (User/Developer/Architect/DevOps)
- Learning paths with progressive difficulty
- Cross-reference matrices
- Alphabetical topic index
- Search-optimised structure

**Automation & Maintenance**
- 8+ validation scripts (links, frontmatter, diagrams, coverage)
- CI/CD pipeline (GitHub Actions)
- Automated report generation
- Weekly validation procedures
- Maintenance playbooks
- Contribution guidelines

## Validation Standards

### Link Validation
- No broken internal links (100% valid)
- All files have 2+ inbound links (except landing pages)
- All files have 2+ outbound links (except landing pages)
- Bidirectional links tracked
- Anchor links verified
- No circular dependencies

### Diagram Standards
- 41+ production Mermaid diagrams
- Zero ASCII art remaining
- GitHub-compliant rendering
- 100% syntax validation
- 6+ diagram types supported
- Consistent styling and colours

### Front Matter Compliance
- 99% metadata coverage
- Required fields: title, description, category, tags
- Optional fields: related-docs, dependencies, difficulty
- 45 standardised tags (no freelancing)
- Diataxis category: tutorial|howto|reference|explanation
- Difficulty: beginner|intermediate|advanced

### Spelling & Language
- UK English throughout (colour, favour, organise, realise)
- Consistent terminology
- No American spellings in main docs
- Proper noun capitalisation
- Grammar validation

### Content Quality
- No developer notes (FIXME, TODO, WIP, XXX, HACK)
- No stub implementations
- No incomplete sections
- No test/debug code in docs
- All code examples validated
- All links working

### Structure Compliance
- Max 3 directory levels
- Proper file naming (kebab-case)
- Consistent extension (.md)
- 7-section top-level structure
- Clear file ownership
- Logical grouping

### Coverage Standards
- 100% component coverage (41/41 actors)
- 100% API coverage (85+ endpoints)
- 100% feature coverage (10/10 features)
- 95.3% Diataxis compliance
- All error codes documented
- All configuration options documented

## Quality Scoring

```
Grade A (94-100): Production Ready
├─ Coverage: 100/100 (A+)
├─ Link Health: 98/100 (A)
├─ Consistency: 94/100 (A-)
├─ Navigation: 100/100 (A+)
└─ Standards: 94/100 (A)

Grade B (85-93): Good Quality
Grade C (75-84): Acceptable
Grade F (< 75): Needs Work
```

## Output Deliverables

### Main Corpus
- `/docs/INDEX.md` - Master index (226+ documents)
- `/docs/NAVIGATION.md` - Navigation guide (50+ scenarios)
- `/docs/reference/` - Unified reference documentation
- `/docs/diagrams/mermaid-library/` - 41 production diagrams
- `/docs/guides/` - How-to guides by role
- `/docs/explanations/` - Conceptual documentation

### Analysis Reports
- `UNIFIED_CORPUS_SUMMARY.md` - Complete overview
- `quality-report.md` - Quality scorecard
- `coverage-validation.md` - Coverage matrix
- `link-validation-report.md` - Link integrity
- `frontmatter-validation.md` - Metadata compliance
- `spelling-audit.md` - UK English audit
- `structure-audit.md` - File organisation audit

### Automation & CI/CD
- `/docs/scripts/validate-all.sh` - Master validator
- `/docs/scripts/validate-links.sh` - Link validation
- `/docs/scripts/validate-frontmatter.sh` - Metadata validation
- `/docs/scripts/validate-mermaid.sh` - Diagram validation
- `/docs/scripts/detect-ascii.sh` - ASCII detection
- `/docs/scripts/validate-coverage.sh` - Coverage validation
- `/docs/scripts/validate-spelling.sh` - UK spelling validation
- `/.github/workflows/docs-ci.yml` - GitHub Actions pipeline
- `/docs/MAINTENANCE.md` - Maintenance procedures
- `/docs/CONTRIBUTION.md` - Contribution guidelines

## Success Metrics

| Metric | Target | Measured |
|--------|--------|----------|
| **Coverage** | 100% | All components |
| **Link Validity** | 94%+ | 4,165 links |
| **Front Matter** | 99%+ | 299/303 files |
| **Diagrams** | 41+ Mermaid | Zero ASCII |
| **Grade** | A (94+) | Production ready |
| **Orphaned Files** | 0% | 100% discoverable |
| **Navigation Paths** | 7+ | Multiple entry points |
