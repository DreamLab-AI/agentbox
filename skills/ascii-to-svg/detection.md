# ASCII Art Detection Heuristics

## Overview
Detect ASCII art in markdown code blocks by analyzing character patterns,
structure, and context.

## What to Scan

Only examine content inside markdown code blocks:
- Fenced blocks: ``` or ~~~
- Indented blocks (4 spaces)

Ignore inline code and regular text.

## Detection Signals

### Strong Positive Signals (+25 points each)
- Box-drawing characters: `─│┌┐└┘├┤┬┴┼╔╗╚╝║═`
- Unicode arrows: `→←↑↓↔↕▶◀▲▼►◄`
- Consistent vertical alignment of `|` characters across 3+ lines
- Diamond patterns for decisions: `/ \` and `\ /` forming diamond shapes

### Medium Positive Signals (+15 points each)
- ASCII box patterns: `+-+` or `+--+` forming corners
- Arrow patterns: `-->`, `<--`, `->`, `<-`, `=>`, `<=`, `~>`
- Repeated horizontal lines used as separators: `---`, `===`, `___`
- Tree structure indicators: `├──`, `└──`, `│   `

### Weak Positive Signals (+10 points each)
- Mixed alphanumeric text with box-drawing characters
- Caret arrows: `^`, `v` at line start/end suggesting direction
- Pipe `|` characters at consistent column positions

### Negative Signals (-20 points each)
- **Table pattern**: Header row with `|---|` separator line
- **Code pattern**: Language keywords (function, const, let, var, def, class, import, return, if, for, while)
- **CLI pattern**: Lines starting with `$`, `#`, `>`, or `%` followed by commands
- **Log pattern**: Timestamps like `2024-01-15`, log levels like `[INFO]`, `[ERROR]`
- **Config pattern**: Key-value with `=` or `:` (e.g., `port=8080`, `host: localhost`)
- **Very short**: Fewer than 3 lines total

### Context Signals (+15 points each)
- Text within 3 lines before block contains: diagram, architecture, flow, structure, overview, schema, layout
- Preceding markdown header contains: diagram, architecture, flow, design, overview
- Code block language hint is: `diagram`, `ascii`, `art`, `chart`, `graph`

## Confidence Calculation

```
confidence = clamp(sum(all_signals), 0, 100)
```

## Decision Matrix

| Confidence | Action |
|------------|--------|
| 75-100 | Auto-convert without asking |
| 40-74 | Show to user: "This might be a diagram. Convert? [content preview]" |
| 0-39 | Skip silently, note in final report |

## Diagram Type Classification

After confirming something is ASCII art, classify for appropriate conversion:

| Detected Pattern | Classification |
|------------------|----------------|
| Boxes connected horizontally with arrows | `flowchart` |
| Boxes stacked vertically with connections | `architecture` |
| Tree with `├──`, `└──` branches | `tree` |
| Vertical flow with numbered steps or time indicators | `sequence` |
| Single box with internal divisions | `component` |
| Boxes with bidirectional arrows | `system-diagram` |
| Grid of connected elements | `network` |
| Nested boxes | `hierarchy` |

## Override Markers

### Skip Conversion
```markdown
<!-- skip-ascii-to-svg -->
```
Sets confidence to 0 for the next code block.

### Force Conversion
```markdown
<!-- convert-to-svg -->
<!-- convert-to-svg: flowchart -->
```
Sets confidence to 100 and optionally specifies type.

## Examples

### High Confidence (90%) - Unicode Box Drawing
```
┌─────────────┐     ┌─────────────┐
│   Service   │────▶│  Database   │
└─────────────┘     └─────────────┘
```
Signals: box-drawing chars (+25), unicode arrow (+25), aligned structure (+25), 3+ lines (+15)

### High Confidence (85%) - ASCII Flowchart
```
+--------+     +--------+     +--------+
| Input  | --> | Process| --> | Output |
+--------+     +--------+     +--------+
```
Signals: ASCII box pattern (+15 x3), arrow pattern (+15 x2), aligned pipes (+25)

### Medium Confidence (55%) - Simple Boxes
```
+------+
| Auth |
+------+
   |
   v
+------+
| API  |
+------+
```
Signals: ASCII box pattern (+15 x2), caret arrow (+10), short structure

### Low Confidence (25%) - Likely a Table
```
| Name    | Type   | Required |
|---------|--------|----------|
| id      | string | yes      |
| email   | string | yes      |
```
Signals: aligned pipes (+10), but table separator detected (-20), no box corners

### Low Confidence (15%) - Likely Code
```
const flow = input
  |> validate
  |> transform
  |> output
```
Signals: pipe chars (+10), but code keywords detected (-20), no box structure

### Zero Confidence - CLI Output
```
$ npm install
added 150 packages in 2.5s

$ npm run build
> project@1.0.0 build
> tsc && vite build
```
Signals: CLI pattern detected (-20 x2), no diagram structure
