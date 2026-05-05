# Build with Quality - Usage Examples

This guide shows how to invoke the **Build with Quality** skill for different project types. Each example is a ready-to-use prompt you can paste into Claude Code.

## Quick Reference

| Project Type | Complexity | Estimated Agents | Key Quality Focus | EDD Fit (v1.2.0) |
|--------------|------------|------------------|-------------------|------------------|
| [Todo App](#example-1-todo-app-beginner) | Beginner | 20-30 | TDD basics, CRUD | Light: 1-2 EXPs, single auditor probe |
| [REST API](#example-2-rest-api-intermediate) | Intermediate | 40-50 | Security, contracts | **Strong**: see worked example below |
| [E-commerce](#example-3-e-commerce-platform-advanced) | Advanced | 80-100 | Full stack, payments | **Strong**: pricing math + payment ordering are textbook EDD targets |
| [CLI Tool](#example-4-cli-tool-intermediate) | Intermediate | 30-40 | Edge cases, UX | Light: error message expectations are subjective, keep human in step 5 |
| [Real-time Chat](#example-5-real-time-chat-app-advanced) | Advanced | 60-80 | WebSockets, scale | **Strong**: race conditions, presence consistency, reconnection — hard to capture in pure assert form |

---

## Example 1: Todo App (Beginner)

**Use case:** Learning the skill with a simple CRUD application.

```markdown
# Build with Quality - Claude Flow V3 Swarm

## Skill Activation
build-with-quality v1.2.0 (114+ agents, hierarchical-mesh, EDD)
Config: skill.yaml

## Project Context
- **Name:** SimpleTodo
- **Type:** web-app
- **Stack:** React + TypeScript + Vite + localStorage
- **Description:** A minimalist todo application for learning TDD

## Task
Build a todo app with add, complete, and delete functionality

## Acceptance Criteria
- [ ] Add new todos with text input
- [ ] Mark todos as complete (strikethrough)
- [ ] Delete todos
- [ ] Persist to localStorage
- [ ] Filter by: All, Active, Completed

## Methodology
- **DDD:** Todo aggregate (id, text, completed, createdAt)
- **ADR:** Document state management choice (useState vs useReducer)
- **TDD:** Test each CRUD operation before implementing

## Quality Gates (Relaxed for Learning)
- Coverage: 70% minimum
- Security: Basic XSS prevention
- Accessibility: WCAG A (keyboard navigation)

## Execute
1. Create Todo component with TDD
2. Implement CRUD operations
3. Add localStorage persistence
4. Build filter functionality
5. Verify all tests pass

Deliver working todo app with tests.
```

---

## Example 2: REST API (Intermediate)

**Use case:** Building a production-ready API with authentication.

```markdown
# Build with Quality - Claude Flow V3 Swarm

## Skill Activation
build-with-quality v1.2.0 (114+ agents, hierarchical-mesh, EDD)
Config: skill.yaml

## Project Context
- **Name:** TaskAPI
- **Type:** api
- **Stack:** Node.js + Express + TypeScript + Prisma + PostgreSQL
- **Description:** RESTful API for task management with JWT authentication

## Task
Build a complete REST API with users, projects, and tasks

## Acceptance Criteria
- [ ] User registration and login (JWT)
- [ ] CRUD for projects (owned by users)
- [ ] CRUD for tasks (belong to projects)
- [ ] Role-based access (admin, member)
- [ ] Rate limiting (100 req/min)
- [ ] OpenAPI documentation

## Methodology
- **EDD (NEW v1.2.0):** Author 4 expectations BEFORE coder runs (see Expectations block below). Producer = sonnet, Auditor = opus.
- **DDD:**
  - Bounded Contexts: Identity, ProjectManagement
  - Aggregates: User, Project, Task
  - Domain Events: UserRegistered, TaskCompleted
- **ADR:**
  - ADR-001: JWT vs Session authentication
  - ADR-002: Prisma vs TypeORM
- **TDD:** Test each endpoint before implementation; also stabilize EDD `regression_critical` expectations into permanent regression tests.

## Expectations (EDD — author before coder runs)

```yaml
- id: EXP-001
  priority: critical
  regression_critical: true
  evidence_category: executable
  expectation: |
    JWT tokens expire after exactly 1 hour from issuance. A request with an
    expired token returns HTTP 401 with body {"error":"TOKEN_EXPIRED"}, not
    a 500 or a silent refresh. The `iat` and `exp` claims are always set;
    `sub` is the user ID, never the email.
  in_scope:
    - Token expiry boundary (exactly 3600s)
    - Clock skew tolerance: 30s grace period MUST NOT be implemented
    - Wrong-secret signature rejection
  out_of_scope:
    - Refresh token flow (covered by EXP-002)
  counter_examples:
    - Returning 500 on expired token (must be 401)
    - Auto-refreshing without explicit refresh endpoint call
    - Putting email in `sub` claim

- id: EXP-002
  priority: high
  regression_critical: true
  evidence_category: executable
  expectation: |
    Rate limiting is per-user-per-endpoint at 100 req/min. The 101st
    request within a 60s window returns HTTP 429 with header
    `Retry-After: <seconds>`. Limits reset on a sliding window, not a
    fixed clock minute.
  in_scope:
    - Authenticated requests counted by user ID, anonymous by IP
    - Sliding window (not fixed bucket)
  out_of_scope:
    - Global rate limiting (separate concern)
  counter_examples:
    - Fixed-clock-minute reset (lets bursts slip through at boundaries)
    - 429 without Retry-After header
    - Counting OPTIONS preflight requests against the limit

- id: EXP-003
  priority: critical
  regression_critical: true
  evidence_category: executable
  expectation: |
    Members of a project can read its tasks but cannot delete the project.
    Only the project owner can delete it. Attempting to delete as a member
    returns 403, not 404 (don't leak existence-based information differently
    from authorization-based information for the same operation).
  in_scope:
    - Owner delete = 204
    - Member delete = 403
    - Non-member delete on existing project = 403 (NOT 404)
    - Anyone delete on nonexistent project = 404
  out_of_scope:
    - Soft delete vs hard delete (covered by ADR-003)
  counter_examples:
    - Returning 404 to members (information leak: differs from non-existent)
    - Allowing delete via DELETE /projects/:id?force=true bypass

- id: EXP-004
  priority: high
  regression_critical: false
  evidence_category: executable
  expectation: |
    OpenAPI schema served at /api/openapi.json validates against OpenAPI 3.1
    spec, includes every public endpoint, and the response schemas match
    actual response shapes for happy and error paths.
  in_scope:
    - Spec validates with @apidevtools/swagger-parser
    - Every route in router has an entry
    - Error response schemas (4xx, 5xx) match actual responses
  out_of_scope:
    - SDK generation (downstream)
  counter_examples:
    - Schema declares fields the actual response omits
    - Endpoints exist in router but missing from schema
```

**Anti-fox configuration:** evidence-producer runs on sonnet, evidence-auditor runs on opus. The auditor will run at least one adversarial counter-example per expectation (e.g. for EXP-003 it might probe `DELETE /projects/<id-that-doesnt-exist>` as a non-member to verify the 404 vs 403 distinction holds).

## Quality Gates
- Coverage: 85% overall, 95% auth flows
- Security: 0 critical (OWASP top 10)
- Contracts: OpenAPI schema validation
- **Evidence Coverage (NEW v1.2.0):** every EXP has executed evidence with receipts; auditor distinct from producer; `regression_critical` EXPs (001, 002, 003) have `stabilized_by` test references before merge.

## Swarm Emphasis
```yaml
agents:
  priority:
    - security-architect (auth design)
    - integration-test-generator (API tests)
    - contract-validator (OpenAPI)
  security_focus:
    - SQL injection
    - JWT vulnerabilities
    - Rate limiting bypass
```

## Execute
Phase 1: Design auth system with security-architect
Phase 1.5 (NEW v1.2.0): expectation-author drafts EXP-001..004; human signs off
Phase 2: TDD for User aggregate and auth endpoints (informed by EXP-001, EXP-003)
Phase 2.5 (NEW v1.2.0): evidence-producer (sonnet) executes scenarios; evidence-auditor (opus) verifies + adversarial probe
Phase 3: TDD for Project and Task aggregates (informed by EXP-003)
Phase 4: Integration tests for all flows + Evidence Coverage gate
Phase 5: Security scan and contract validation
Phase 6 (NEW v1.2.0): tdd-stabilizer converts EXP-001..003 into permanent regression tests (EXP-004 not regression_critical, optional)

Deliver production-ready API with full test coverage and proven evidence.
```

---

## Example 3: E-commerce Platform (Advanced)

**Use case:** Full-stack application with payments and complex business logic.

```markdown
# Build with Quality - Claude Flow V3 Swarm

## Skill Activation
build-with-quality v1.2.0 (114+ agents, hierarchical-mesh, EDD)
Config: skill.yaml - FULL CAPABILITY MODE

## Project Context
- **Name:** ShopFlow
- **Type:** web-app
- **Stack:** Next.js 14 + TypeScript + Prisma + PostgreSQL + Stripe + Redis
- **Description:** E-commerce platform with cart, checkout, and order management

## Task
Build complete e-commerce with product catalog, cart, checkout, and orders

## Acceptance Criteria
- [ ] Product catalog with search and filters
- [ ] Shopping cart (persistent across sessions)
- [ ] Stripe checkout integration
- [ ] Order history and status tracking
- [ ] Admin dashboard for inventory
- [ ] Email notifications (order confirmation)

## Methodology
- **DDD:**
  - Core Domain: Orders, Payments
  - Supporting: Catalog, Inventory, Notifications
  - Bounded Contexts: Shopping, Fulfillment, Admin
  - Aggregates:
    - Product (id, name, price, inventory)
    - Cart (id, items[], userId)
    - Order (id, items[], status, payment)
  - Domain Events:
    - ProductAddedToCart
    - OrderPlaced
    - PaymentCompleted
    - OrderShipped
- **ADR:**
  - ADR-001: Stripe vs PayPal
  - ADR-002: Server Components vs Client for catalog
  - ADR-003: Redis for cart persistence
  - ADR-004: Optimistic vs pessimistic inventory
- **TDD:** Full red-green-refactor for each aggregate

## Quality Gates (Production Critical)
- Coverage: 90% overall, 100% payment flows
- Security: 0 any severity, PCI-DSS compliance
- Accessibility: WCAG AA, keyboard checkout
- Chaos: 90% graceful degradation (Stripe outage)

## Swarm Configuration
```yaml
domains:
  development: 4 concurrent (architect, coder, reviewer, browser-agent)
  quality: 4 concurrent (full test suite)
  security: 2 concurrent (PCI focus)
max_agents: 100
topology: hierarchical-mesh
```

## Execute
Phase 1: DDD modeling with architect
  - Define all bounded contexts
  - Create context map
  - Document ADRs
Phase 2: Catalog domain (TDD)
  - Product listing, search, filters
  - Unit + integration tests
Phase 3: Cart domain (TDD)
  - Add/remove items, persistence
  - Redis integration tests
Phase 4: Checkout domain (TDD)
  - Stripe integration
  - Payment flow tests (mock + real)
Phase 5: Order domain (TDD)
  - Status management
  - Email notifications
Phase 6: Quality validation
  - E2E tests (Playwright)
  - Security scan (PCI)
  - Chaos testing (payment failures)
  - Accessibility audit

Deliver production-ready e-commerce with full quality assurance.
```

---

## Example 4: CLI Tool (Intermediate)

**Use case:** Command-line application with good UX and error handling.

```markdown
# Build with Quality - Claude Flow V3 Swarm

## Skill Activation
build-with-quality v1.2.0 (114+ agents, hierarchical-mesh, EDD)
Config: skill.yaml

## Project Context
- **Name:** projgen
- **Type:** cli
- **Stack:** Node.js + TypeScript + Commander.js + Inquirer
- **Description:** Project scaffolding CLI that generates boilerplate

## Task
Build a CLI that scaffolds new projects from templates

## Acceptance Criteria
- [ ] `projgen init` - interactive project setup
- [ ] `projgen add <template>` - add component templates
- [ ] `projgen list` - show available templates
- [ ] `projgen config` - manage settings
- [ ] Support: React, Vue, Node API, CLI templates
- [ ] Colored output and progress indicators

## Methodology
- **DDD:**
  - Aggregates: Template, Project, Config
  - Value Objects: TemplatePath, ProjectName
- **ADR:**
  - ADR-001: Commander vs Yargs
  - ADR-002: Template engine (Handlebars vs EJS)
- **TDD:** Test each command before implementing

## Quality Gates
- Coverage: 85% overall, 100% command handlers
- Security: Path traversal prevention, no arbitrary code exec
- Edge cases: Invalid inputs, missing files, permissions

## Swarm Emphasis
```yaml
agents:
  priority:
    - integration-test-generator (CLI commands)
    - edge-case coverage
    - error handling validation
  security_focus:
    - command injection
    - path traversal
    - symlink attacks
```

## Execute
Phase 1: Core command structure with TDD
Phase 2: Template engine implementation
Phase 3: Interactive prompts (Inquirer)
Phase 4: Integration tests for all commands
Phase 5: Edge case and error handling tests

Deliver polished CLI with excellent error messages.
```

---

## Example 5: Real-time Chat App (Advanced)

**Use case:** WebSocket-based application with scaling considerations.

```markdown
# Build with Quality - Claude Flow V3 Swarm

## Skill Activation
build-with-quality v1.2.0 (114+ agents, hierarchical-mesh, EDD)
Config: skill.yaml - FULL CAPABILITY MODE

## Project Context
- **Name:** ChatFlow
- **Type:** web-app
- **Stack:** Next.js + TypeScript + Socket.io + Redis + PostgreSQL
- **Description:** Real-time chat with rooms, typing indicators, and message history

## Task
Build real-time chat with rooms, presence, and message persistence

## Acceptance Criteria
- [ ] User authentication (OAuth: Google, GitHub)
- [ ] Create/join chat rooms
- [ ] Real-time messaging (WebSocket)
- [ ] Typing indicators
- [ ] Online/offline presence
- [ ] Message history with pagination
- [ ] File sharing (images)
- [ ] Mobile responsive

## Methodology
- **DDD:**
  - Bounded Contexts: Identity, Messaging, Presence
  - Aggregates:
    - User (id, name, avatar, status)
    - Room (id, name, members[], messages[])
    - Message (id, content, sender, timestamp)
  - Domain Events:
    - UserJoinedRoom
    - MessageSent
    - UserStartedTyping
    - UserWentOffline
- **ADR:**
  - ADR-001: Socket.io vs native WebSocket
  - ADR-002: Redis pub/sub for horizontal scaling
  - ADR-003: Message storage (PostgreSQL vs MongoDB)
  - ADR-004: Presence heartbeat interval
- **TDD:** Full cycle for each feature

## Quality Gates
- Coverage: 85% overall, 95% WebSocket handlers
- Security: 0 critical, XSS in messages, auth bypass
- Accessibility: WCAG AA, screen reader support
- Chaos: Connection drops, Redis failover, high load

## Swarm Configuration
```yaml
domains:
  development: 4 concurrent
  quality: 4 concurrent
  security: 2 concurrent
chaos:
  network_resilience: 80%  # WebSocket reconnection
  resource_exhaustion: 75% # Memory with many connections
  graceful_degradation: 85% # Redis failover
```

## Execute
Phase 1: Architecture with DDD
  - Define bounded contexts
  - Document ADRs for real-time decisions
Phase 2: Auth system (TDD)
  - OAuth integration
  - Session management
Phase 3: Room management (TDD)
  - Create, join, leave
  - Member list
Phase 4: Real-time messaging (TDD)
  - Socket.io handlers
  - Message persistence
  - Typing indicators
Phase 5: Presence system (TDD)
  - Online/offline status
  - Heartbeat mechanism
Phase 6: Quality validation
  - E2E tests with multiple clients
  - Load testing (100 concurrent users)
  - Chaos testing (disconnections)
  - Security scan

Deliver scalable real-time chat with production quality.
```

---

## Quick Start Templates

### Minimal (Any Project)

```markdown
Build with Quality skill (v1.2.0).

Project: [NAME] | Stack: [TECH] | Task: [DESCRIPTION]

Methodology: DDD + ADR + TDD
Quality: 85% coverage, security scan, WCAG AA

Execute and deliver tested code.
```

### Rapid Prototype (Reduced Gates)

```markdown
Build with Quality skill - PROTOTYPE MODE.

Project: [NAME] | Stack: [TECH] | Task: [DESCRIPTION]

Quality gates (relaxed):
- Coverage: 60%
- Security: Critical only
- Accessibility: Skip
- Chaos: Skip

Focus on working implementation, tests for core paths only.
```

### Production Critical (Maximum Gates)

```markdown
Build with Quality skill - PRODUCTION MODE.

Project: [NAME] | Stack: [TECH] | Task: [DESCRIPTION]

Quality gates (strict):
- Coverage: 95% overall, 100% critical paths
- Security: 0 any severity
- Accessibility: WCAG AAA
- Chaos: 90% all categories
- Mutation testing: 80% mutation score

Full quality validation required before delivery.
```

---

## Skill Configuration Reference

All examples use settings from [`config/skill.yaml`](./config/skill.yaml):

| Setting | Default | Customize In Prompt |
|---------|---------|---------------------|
| Coverage minimum | 85% | "Coverage: 70%" |
| Security threshold | 0 critical/high | "Security: critical only" |
| Accessibility level | AA | "Accessibility: WCAG A" |
| TDD enforcement | Required | "TDD: optional" |
| Chaos testing | Enabled | "Chaos: skip" |

---

## References

- [BUILD-WITH-QUALITY-PROMPT.md](./BUILD-WITH-QUALITY-PROMPT.md) - Full activation prompt
- [config/skill.yaml](./config/skill.yaml) - Skill configuration
- [Claude Flow V3](https://github.com/ruvnet/claude-flow/tree/main/v3) - Development agents
- [Agentic QE](https://github.com/proffesor-for-testing/agentic-qe) - Quality agents

---

*Version: 1.2.0*
*Last Updated: 2026-05-03*
*New in v1.2.0: Expectation-Driven Development examples in REST API entry below.*
