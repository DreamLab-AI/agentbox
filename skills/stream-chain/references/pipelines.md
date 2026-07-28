# Stream-Chain — Predefined & Custom Pipelines

Predefined pipelines are battle-tested workflows for common development tasks.

```bash
claude-flow stream-chain pipeline <type> [options]
```

## Available Pipelines

### 1. Analysis Pipeline

Comprehensive codebase analysis and improvement identification.

```bash
claude-flow stream-chain pipeline analysis
```

**Workflow Steps:**
1. **Structure Analysis**: Map directory structure and identify components
2. **Issue Detection**: Find potential improvements and problems
3. **Recommendations**: Generate actionable improvement report

**Use Cases:**
- New codebase onboarding
- Technical debt assessment
- Architecture review
- Code quality audits

### 2. Refactor Pipeline

Systematic code refactoring with prioritization.

```bash
claude-flow stream-chain pipeline refactor
```

**Workflow Steps:**
1. **Candidate Identification**: Find code needing refactoring
2. **Prioritization**: Create ranked refactoring plan
3. **Implementation**: Provide refactored code for top priorities

**Use Cases:**
- Technical debt reduction
- Code quality improvement
- Legacy code modernization
- Design pattern implementation

### 3. Test Pipeline

Comprehensive test generation with coverage analysis.

```bash
claude-flow stream-chain pipeline test
```

**Workflow Steps:**
1. **Coverage Analysis**: Identify areas lacking tests
2. **Test Design**: Create test cases for critical functions
3. **Implementation**: Generate unit tests with assertions

**Use Cases:**
- Increasing test coverage
- TDD workflow support
- Regression test creation
- Quality assurance

### 4. Optimise Pipeline

Performance optimisation with profiling and implementation.

```bash
claude-flow stream-chain pipeline optimize
```

**Workflow Steps:**
1. **Profiling**: Identify performance bottlenecks
2. **Strategy**: Analyze and suggest optimisation approaches
3. **Implementation**: Provide optimised code

**Use Cases:**
- Performance improvement
- Resource optimisation
- Scalability enhancement
- Latency reduction

## Pipeline Options

| Option | Description | Default |
|--------|-------------|---------|
| `--verbose` | Show detailed execution | `false` |
| `--timeout <seconds>` | Timeout per step | `30` |
| `--debug` | Enable debug mode | `false` |

## Pipeline Examples

```bash
# Quick analysis
claude-flow stream-chain pipeline analysis

# Extended refactoring
claude-flow stream-chain pipeline refactor --timeout 60 --verbose

# Debug test generation
claude-flow stream-chain pipeline test --debug

# Comprehensive optimisation
claude-flow stream-chain pipeline optimize --timeout 90 --verbose
```

## Pipeline Output

Each pipeline execution provides:

- **Progress**: Step-by-step execution status
- **Results**: Success/failure per step
- **Timing**: Total and per-step execution time
- **Summary**: Consolidated results and recommendations

## Custom Pipeline Definitions

Define reusable pipelines in `.claude-flow/config.json`:

```json
{
  "streamChain": {
    "pipelines": {
      "security": {
        "name": "Security Audit Pipeline",
        "description": "Comprehensive security analysis",
        "prompts": [
          "Scan codebase for security vulnerabilities",
          "Categorize issues by severity (critical/high/medium/low)",
          "Generate fixes with priority and implementation steps",
          "Create security test suite"
        ],
        "timeout": 45
      },
      "documentation": {
        "name": "Documentation Generation Pipeline",
        "prompts": [
          "Analyze code structure and identify undocumented areas",
          "Generate API documentation with examples",
          "Create usage guides and tutorials",
          "Build architecture diagrams and flow charts"
        ]
      }
    }
  }
}
```

Execute a custom pipeline by name:

```bash
claude-flow stream-chain pipeline security
claude-flow stream-chain pipeline documentation
```
