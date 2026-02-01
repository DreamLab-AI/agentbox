# Build with Quality - Usage Examples

This guide shows how to invoke the **Build with Quality** skill for different project types. Each example is a ready-to-use prompt you can paste into Claude Code.

## Quick Reference

| Project Type | Complexity | Estimated Agents | Key Quality Focus |
|--------------|------------|------------------|-------------------|
| [Todo App](#example-1-todo-app-beginner) | Beginner | 20-30 | TDD basics, CRUD |
| [REST API](#example-2-rest-api-intermediate) | Intermediate | 40-50 | Security, contracts |
| [E-commerce](#example-3-e-commerce-platform-advanced) | Advanced | 80-100 | Full stack, payments |
| [CLI Tool](#example-4-cli-tool-intermediate) | Intermediate | 30-40 | Edge cases, UX |
| [Real-time Chat](#example-5-real-time-chat-app-advanced) | Advanced | 60-80 | WebSockets, scale |

---

## Example 1: Todo App (Beginner)

**Use case:** Learning the skill with a simple CRUD application.

```markdown
# Build with Quality - Claude Flow V3 Swarm

## Skill Activation
build-with-quality v1.1.0 (111+ agents, hierarchical-mesh)
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
build-with-quality v1.1.0 (111+ agents, hierarchical-mesh)
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
- **DDD:**
  - Bounded Contexts: Identity, ProjectManagement
  - Aggregates: User, Project, Task
  - Domain Events: UserRegistered, TaskCompleted
- **ADR:**
  - ADR-001: JWT vs Session authentication
  - ADR-002: Prisma vs TypeORM
- **TDD:** Test each endpoint before implementation

## Quality Gates
- Coverage: 85% overall, 95% auth flows
- Security: 0 critical (OWASP top 10)
- Contracts: OpenAPI schema validation

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
Phase 2: TDD for User aggregate and auth endpoints
Phase 3: TDD for Project and Task aggregates
Phase 4: Integration tests for all flows
Phase 5: Security scan and contract validation

Deliver production-ready API with full test coverage.
```

---

## Example 3: E-commerce Platform (Advanced)

**Use case:** Full-stack application with payments and complex business logic.

```markdown
# Build with Quality - Claude Flow V3 Swarm

## Skill Activation
build-with-quality v1.1.0 (111+ agents, hierarchical-mesh)
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
build-with-quality v1.1.0 (111+ agents, hierarchical-mesh)
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
build-with-quality v1.1.0 (111+ agents, hierarchical-mesh)
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
Build with Quality skill (v1.1.0).

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

*Version: 1.1.0*
*Last Updated: 2026-02-01*
