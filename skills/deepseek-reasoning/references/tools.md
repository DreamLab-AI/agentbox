# DeepSeek Reasoning — Tools Reference

The MCP server exposes three reasoning tools. All run as `devuser`; the server spawns
`tools/deepseek_client.js` directly (no sudo bridge).

## deepseek_reason

**Purpose:** Complex multi-step reasoning.

**Parameters:**
- `query` (required) — Question requiring reasoning
- `context` (optional) — Background information
- `max_steps` (optional) — Max reasoning steps (default: 10)
- `format` (optional) — Output format: `prose|structured|steps` (default: structured)
- `strategy` (optional) — Reasoning approach: `first_principles|incremental|analogical`

**Returns:**
```json
{
  "reasoning": {
    "steps": [
      {"step": 1, "thought": "...", "conclusion": "..."},
      {"step": 2, "thought": "...", "conclusion": "..."}
    ],
    "final_answer": "...",
    "confidence": 0.95
  },
  "usage": {"total_tokens": 450}
}
```

## deepseek_analyze

**Purpose:** Code/system analysis with root-cause reasoning.

**Parameters:**
- `code` (required) — Code to analyse
- `issue` (required) — Problem description
- `language` (optional) — Programming language
- `depth` (optional) — Analysis depth: `quick|normal|deep` (default: normal)

**Returns:**
```json
{
  "analysis": {
    "root_cause": "...",
    "reasoning_trace": ["...", "...", "..."],
    "recommendations": [
      {"priority": "high", "action": "...", "rationale": "..."}
    ]
  },
  "code_issues": [
    {"line": 42, "severity": "error", "message": "..."}
  ]
}
```

## deepseek_plan

**Purpose:** Task planning with dependency analysis.

**Parameters:**
- `goal` (required) — What to achieve
- `constraints` (optional) — Limitations or requirements
- `context` (optional) — Existing system context
- `granularity` (optional) — Task size: `coarse|medium|fine` (default: medium)

**Returns:**
```json
{
  "plan": {
    "phases": [
      {
        "name": "Phase 1: Setup",
        "tasks": [
          {"id": "T1", "description": "...", "dependencies": [], "reasoning": "..."}
        ],
        "reasoning": "Why this phase is needed"
      }
    ],
    "critical_path": ["T1", "T3", "T7"],
    "estimated_complexity": "high"
  }
}
```

## Special model features

The special endpoint model provides:
- **Required thinking mode** — reasoning cannot be disabled
- **Extended context** — handles complex multi-step problems
- **Structured output** — clear reasoning + conclusion format
- **Metacognitive traces** — shows how the model thinks

## DeepSeek vs Claude reasoning

| Aspect | DeepSeek Special | Claude Sonnet 4.6 |
|--------|------------------|-------------------|
| Multi-step logic | Excellent | Very Good |
| Code generation | Good | Excellent |
| Reasoning transparency | Explicit traces | Implicit |
| Speed | Medium (2-5s) | Fast (<1s) |
| Cost | Lower | Higher |
| Best for | Planning, analysis | Execution, polish |

**Recommendation:** Use both in a hybrid workflow — DeepSeek plans, Claude executes.
