# SPARC — Development Phases & the 17 Modes

Full catalog of SPARC's development phases and the 17 specialized modes. The lean
guide (`../SKILL.md`) summarises the phase flow; this file holds the per-mode
capabilities, quality standards, and usage snippets.

## Development Phases (detail)

### Phase 1: Specification
**Goal**: Define requirements, constraints, and success criteria

- Requirements analysis
- User story mapping
- Constraint identification
- Success metrics definition
- Pseudocode planning

**Key Modes**: `researcher`, `analyzer`, `memory-manager`

### Phase 2: Architecture
**Goal**: Design system structure and component interfaces

- System architecture design
- Component interface definition
- Database schema planning
- API contract specification
- Infrastructure planning

**Key Modes**: `architect`, `designer`, `orchestrator`

### Phase 3: Refinement (TDD Implementation)
**Goal**: Implement features with test-first approach

- Write failing tests
- Implement minimum viable code
- Make tests pass
- Refactor for quality
- Iterate until complete

**Key Modes**: `tdd`, `coder`, `tester`

### Phase 4: Review
**Goal**: Ensure code quality, security, and performance

- Code quality assessment
- Security vulnerability scanning
- Performance profiling
- Best practices validation
- Documentation review

**Key Modes**: `reviewer`, `optimizer`, `debugger`

### Phase 5: Completion
**Goal**: Integration, deployment, and monitoring

- System integration
- Deployment automation
- Monitoring setup
- Documentation finalization
- Knowledge capture

**Key Modes**: `workflow-manager`, `documenter`, `memory-manager`

---

## Available Modes

### Core Orchestration Modes

#### `orchestrator`
Multi-agent task orchestration with TodoWrite/Task/Memory coordination.

**Capabilities**:
- Task decomposition into manageable units
- Agent coordination and resource allocation
- Progress tracking and result synthesis
- Adaptive strategy selection
- Cross-agent communication

**Usage**:
```javascript
mcp__claude-flow__sparc_mode {
  mode: "orchestrator",
  task_description: "coordinate feature development",
  options: { parallel: true, monitor: true }
}
```

#### `swarm-coordinator`
Specialized swarm management for complex multi-agent workflows.

**Capabilities**:
- Topology optimisation (mesh, hierarchical, ring, star)
- Agent lifecycle management
- Dynamic scaling based on workload
- Fault tolerance and recovery
- Performance monitoring

#### `workflow-manager`
Process automation and workflow orchestration.

**Capabilities**:
- Workflow definition and execution
- Event-driven triggers
- Sequential and parallel pipelines
- State management
- Error handling and retry logic

#### `batch-executor`
Parallel task execution for high-throughput operations.

**Capabilities**:
- Concurrent file operations
- Batch processing optimisation
- Resource pooling
- Load balancing
- Progress aggregation

---

### Development Modes

#### `coder`
Autonomous code generation with batch file operations.

**Capabilities**:
- Feature implementation
- Code refactoring
- Bug fixes and patches
- API development
- Algorithm implementation

**Quality Standards**:
- ES2022+ standards
- TypeScript type safety
- Comprehensive error handling
- Performance optimisation
- Security best practices

**Usage**:
```javascript
mcp__claude-flow__sparc_mode {
  mode: "coder",
  task_description: "implement user authentication with JWT",
  options: {
    test_driven: true,
    parallel_edits: true,
    typescript: true
  }
}
```

#### `architect`
System design with Memory-based coordination.

**Capabilities**:
- Microservices architecture
- Event-driven design
- Domain-driven design (DDD)
- Hexagonal architecture
- CQRS and Event Sourcing

**Memory Integration**:
- Store architectural decisions
- Share component specifications
- Maintain design consistency
- Track architectural evolution

**Design Patterns**:
- Layered architecture
- Microservices patterns
- Event-driven patterns
- Domain modeling
- Infrastructure as Code

**Usage**:
```javascript
mcp__claude-flow__sparc_mode {
  mode: "architect",
  task_description: "design scalable e-commerce platform",
  options: {
    detailed: true,
    memory_enabled: true,
    patterns: ["microservices", "event-driven"]
  }
}
```

#### `tdd`
Test-driven development with comprehensive testing.

**Capabilities**:
- Test-first development
- Red-green-refactor cycle
- Test suite design
- Coverage optimisation (target: 90%+)
- Continuous testing

**TDD Workflow**:
1. Write failing test (RED)
2. Implement minimum code
3. Make test pass (GREEN)
4. Refactor for quality (REFACTOR)
5. Repeat cycle

**Testing Strategies**:
- Unit testing (Jest, Mocha, Vitest)
- Integration testing
- End-to-end testing (Playwright, Cypress)
- Performance testing
- Security testing

**Usage**:
```javascript
mcp__claude-flow__sparc_mode {
  mode: "tdd",
  task_description: "shopping cart feature with payment integration",
  options: {
    coverage_target: 90,
    test_framework: "jest",
    e2e_framework: "playwright"
  }
}
```

#### `reviewer`
Code review using batch file analysis.

**Capabilities**:
- Code quality assessment
- Security vulnerability detection
- Performance analysis
- Best practices validation
- Documentation review

**Review Criteria**:
- Code correctness and logic
- Design pattern adherence
- Comprehensive error handling
- Test coverage adequacy
- Maintainability and readability
- Security vulnerabilities
- Performance bottlenecks

**Batch Analysis**:
- Parallel file review
- Pattern detection
- Dependency checking
- Consistency validation
- Automated reporting

**Usage**:
```javascript
mcp__claude-flow__sparc_mode {
  mode: "reviewer",
  task_description: "review authentication module PR #123",
  options: {
    security_check: true,
    performance_check: true,
    test_coverage_check: true
  }
}
```

---

### Analysis and Research Modes

#### `researcher`
Deep research with parallel WebSearch/WebFetch and Memory coordination.

**Capabilities**:
- Comprehensive information gathering
- Source credibility evaluation
- Trend analysis and forecasting
- Competitive research
- Technology assessment

**Research Methods**:
- Parallel web searches
- Academic paper analysis
- Industry report synthesis
- Expert opinion gathering
- Statistical data compilation

**Memory Integration**:
- Store research findings with citations
- Build knowledge graphs
- Track information sources
- Cross-reference insights
- Maintain research history

**Usage**:
```javascript
mcp__claude-flow__sparc_mode {
  mode: "researcher",
  task_description: "research microservices best practices 2024",
  options: {
    depth: "comprehensive",
    sources: ["academic", "industry", "news"],
    citations: true
  }
}
```

#### `analyzer`
Code and data analysis with pattern recognition.

**Capabilities**:
- Static code analysis
- Dependency analysis
- Performance profiling
- Security scanning
- Data pattern recognition

#### `optimizer`
Performance optimisation and bottleneck resolution.

**Capabilities**:
- Algorithm optimisation
- Database query tuning
- Caching strategy design
- Bundle size reduction
- Memory leak detection

---

### Creative and Support Modes

#### `designer`
UI/UX design with accessibility focus.

**Capabilities**:
- Interface design
- User experience optimisation
- Accessibility compliance (WCAG 2.1)
- Design system creation
- Responsive layout design

#### `innovator`
Creative problem-solving and novel solutions.

**Capabilities**:
- Brainstorming and ideation
- Alternative approach generation
- Technology evaluation
- Proof of concept development
- Innovation feasibility analysis

#### `documenter`
Comprehensive documentation generation.

**Capabilities**:
- API documentation (OpenAPI/Swagger)
- Architecture diagrams
- User guides and tutorials
- Code comments and JSDoc
- README and changelog maintenance

#### `debugger`
Systematic debugging and issue resolution.

**Capabilities**:
- Bug reproduction
- Root cause analysis
- Fix implementation
- Regression prevention
- Debug logging optimisation

#### `tester`
Comprehensive testing beyond TDD.

**Capabilities**:
- Test suite expansion
- Edge case identification
- Performance testing
- Load testing
- Chaos engineering

#### `memory-manager`
Knowledge management and context preservation.

**Capabilities**:
- Cross-session memory persistence
- Knowledge graph construction
- Context restoration
- Learning pattern extraction
- Decision tracking
