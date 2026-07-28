# CodeAct — Cost, Empirical Priors, and References

Empirical measurements and cost accounting that inform *when* to prefer CodeAct
over chain-of-thought or alternative skills. Moved off the JIT routing surface
(the front-matter `description`) so the routing decision stays trigger-led;
consult this when justifying the choice or sizing a swarm.

---

## Empirical priors (peer-reviewed literature)

- **+12pp on BIG-Bench Hard** (Chain of Code, arxiv:2312.04474): 84% vs 72%
  chain-of-thought baseline. The gain comes from real interpreter execution for
  arithmetic steps and LM-emulator fallback for semantic steps.
- **+20% success rate** on API-Bank tool-use benchmark (CodeAct,
  arxiv:2402.01030): measured across 17 LLMs; the unified executable action
  space consistently outperforms JSON/text action formats.
- **10-81% more token-efficient** than dedicated reasoning models (CodeAdapt,
  arxiv:2510.20909): the range reflects task type; numerical and data tasks
  show the largest efficiency gains.
- **+12pp over chain-of-thought on 8 benchmarks** (Program of Thoughts,
  arxiv:2211.12588): code-delegated arithmetic outperforms text-only reasoning
  for structured numerical problems.

These are inference-time patterns. No fine-tuning is required; all lifts are
achievable with a standard frontier model and the kernel MCP alone.

---

## Operational cost note

Idle kernel RSS is approximately 80 MB. With scientific packages imported
(pandas, numpy, scipy) this rises to 300-500 MB. Account for this in swarm
configurations where multiple agents run concurrently. The `max_memory_mb`
manifest key sets the advisory RLIMIT_AS ceiling (default 512 MB per kernel
process); the operator alert fires at 400 MB RSS.

---

## References

- ADR-018: Persistent code-interpreter MCP and CodeAct skill
  (`docs/reference/adr/ADR-018-persistent-code-interpreter-mcp.md`)
- DDD-005: Code Execution and Experiential Learning Domain
  (`docs/reference/ddd/DDD-005-code-execution-domain.md`)
- PRD-008 §3.3 and §7 Phase 2a acceptance criteria
  (`docs/reference/prd/PRD-008-code-as-harness-integration.md`)
- arxiv:2402.01030 -- CodeAct: Executable Code Actions Elicit Better LLM Agents
- arxiv:2312.04474 -- Chain of Code: Reasoning with Language Model Executed Code
- arxiv:2211.12588 -- Program of Thoughts Prompting
- arxiv:2510.20909 -- CodeAdapt: token-efficiency benchmarks
