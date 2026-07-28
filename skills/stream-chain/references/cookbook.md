# Stream-Chain — Cookbook, Integration & Troubleshooting

## Custom Chain Options

| Option | Description | Default |
|--------|-------------|---------|
| `--verbose` | Show detailed execution information | `false` |
| `--timeout <seconds>` | Timeout per step | `30` |
| `--debug` | Enable debug mode with full logging | `false` |

**Requirements:**
- Minimum 2 prompts required
- Each prompt becomes a step in the chain
- Output flows sequentially through all steps

## How Context Flows

Each step receives the previous output as context:

```
Step 1: "Write a sorting function"
Output: [function implementation]

Step 2 receives:
  "Previous step output:
  [function implementation]

  Next task: Add comprehensive tests"

Step 3 receives:
  "Previous steps output:
  [function + tests]

  Next task: Optimize performance"
```

## Custom Chain Examples

### Basic Development Chain

```bash
claude-flow stream-chain run \
  "Write a user authentication function" \
  "Add input validation and error handling" \
  "Create unit tests with edge cases"
```

### Security Audit Workflow

```bash
claude-flow stream-chain run \
  "Analyze authentication system for vulnerabilities" \
  "Identify and categorize security issues by severity" \
  "Propose fixes with implementation priority" \
  "Generate security test cases" \
  --timeout 45 \
  --verbose
```

### Code Refactoring Chain

```bash
claude-flow stream-chain run \
  "Identify code smells in src/ directory" \
  "Create refactoring plan with specific changes" \
  "Apply refactoring to top 3 priority items" \
  "Verify refactored code maintains behavior" \
  --debug
```

### Data Processing Pipeline

```bash
claude-flow stream-chain run \
  "Extract data from API responses" \
  "Transform data into normalized format" \
  "Validate data against schema" \
  "Generate data quality report"
```

## Advanced Use Cases

### Multi-Agent Coordination

Chain different agent types for complex workflows:

```bash
claude-flow stream-chain run \
  "Research best practices for API design" \
  "Design REST API with discovered patterns" \
  "Implement API endpoints with validation" \
  "Generate OpenAPI specification" \
  "Create integration tests" \
  "Write deployment documentation"
```

### Data Transformation Pipeline

Process and transform data through multiple stages:

```bash
claude-flow stream-chain run \
  "Extract user data from CSV files" \
  "Normalize and validate data format" \
  "Enrich data with external API calls" \
  "Generate analytics report" \
  "Create visualization code"
```

### Code Migration Workflow

Systematic code migration with validation:

```bash
claude-flow stream-chain run \
  "Analyze legacy codebase dependencies" \
  "Create migration plan with risk assessment" \
  "Generate modernized code for high-priority modules" \
  "Create migration tests" \
  "Document migration steps and rollback procedures"
```

### Quality Assurance Chain

Comprehensive code quality workflow:

```bash
claude-flow stream-chain pipeline analysis
claude-flow stream-chain pipeline refactor
claude-flow stream-chain pipeline test
claude-flow stream-chain pipeline optimize
```

## Best Practices

### 1. Clear and Specific Prompts

**Good:**
```bash
"Analyze authentication.js for SQL injection vulnerabilities"
```

**Avoid:**
```bash
"Check security"
```

### 2. Logical Progression

Order prompts to build on previous outputs:
```bash
1. "Identify the problem"
2. "Analyze root causes"
3. "Design solution"
4. "Implement solution"
5. "Verify implementation"
```

### 3. Appropriate Timeouts

- Simple tasks: 30 seconds (default)
- Analysis tasks: 45-60 seconds
- Implementation tasks: 60-90 seconds
- Complex workflows: 90-120 seconds

### 4. Verification Steps

Include validation in your chains:
```bash
claude-flow stream-chain run \
  "Implement feature X" \
  "Write tests for feature X" \
  "Verify tests pass and cover edge cases"
```

### 5. Iterative Refinement

Use chains for iterative improvement:
```bash
claude-flow stream-chain run \
  "Generate initial implementation" \
  "Review and identify issues" \
  "Refine based on issues found" \
  "Final quality check"
```

## Integration with Claude Flow

### Combine with Swarm Coordination

```bash
# Initialize swarm for coordination
claude-flow swarm init --topology mesh

# Execute stream chain with swarm agents
claude-flow stream-chain run \
  "Agent 1: Research task" \
  "Agent 2: Implement solution" \
  "Agent 3: Test implementation" \
  "Agent 4: Review and refine"
```

### Memory Integration

Stream chains automatically store context in memory for cross-session persistence:

```bash
# Execute chain with memory
claude-flow stream-chain run \
  "Analyze requirements" \
  "Design architecture" \
  --verbose

# Results stored in .claude-flow/memory/stream-chain/
```

### Neural Pattern Training

Successful chains train neural patterns for improved performance:

```bash
# Enable neural training
claude-flow stream-chain pipeline optimize --debug

# Patterns learned and stored for future optimizations
```

## Troubleshooting

### Chain Timeout

If steps timeout, increase timeout value:

```bash
claude-flow stream-chain run "complex task" --timeout 120
```

### Context Loss

If context not flowing properly, use `--debug`:

```bash
claude-flow stream-chain run "step 1" "step 2" --debug
```

### Pipeline Not Found

Verify pipeline name and custom definitions:

```bash
# Check available pipelines
cat .claude-flow/config.json | grep -A 10 "streamChain"
```

## Performance Characteristics

- **Throughput**: 2-5 steps per minute (varies by complexity)
- **Context Size**: Up to 100K tokens per step
- **Memory Usage**: ~50MB per active chain
- **Concurrency**: Supports parallel chain execution

## More Worked Examples

### Complete Development Workflow

```bash
claude-flow stream-chain run \
  "Analyze requirements for user profile feature" \
  "Design database schema and API endpoints" \
  "Implement backend with validation" \
  "Create frontend components" \
  "Write comprehensive tests" \
  "Generate API documentation" \
  --timeout 60 \
  --verbose
```

### Code Review Pipeline

```bash
claude-flow stream-chain run \
  "Analyze recent git changes" \
  "Identify code quality issues" \
  "Check for security vulnerabilities" \
  "Verify test coverage" \
  "Generate code review report with recommendations"
```

### Migration Assistant

```bash
claude-flow stream-chain run \
  "Analyze current Vue 2 codebase" \
  "Identify Vue 3 breaking changes" \
  "Create migration checklist" \
  "Generate migration scripts" \
  "Provide updated code examples"
```

## Related Skills

- **SPARC Methodology**: Systematic development workflow
- **Swarm Coordination**: Multi-agent orchestration
- **Memory Management**: Persistent context storage
- **Neural Patterns**: Adaptive learning
