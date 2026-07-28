# Architecture Principles

Defaults, not laws. Every table below is a starting point — violate with documented reasoning (see the Anti-Dogma section in SKILL.md).

---

## 1. Simplicity as Default, Complexity When Earned

**Start simple, add complexity when pain is measurable.**

| Start With | Move To | When |
|------------|---------|------|
| SQLite | Postgres | >10 concurrent writers, >100GB, need PostGIS/full-text |
| Single file | Multiple files | File exceeds ~500 LOC or has multiple responsibilities |
| Monolith | Services | Team can't work on same codebase, or genuine scale isolation needed |
| Static hosting | Server | Need auth, real-time, or server-side computation |
| Local state | Cloud sync | Multi-device is a real user need, not assumed |

**Not dogma, but defaults.** Violate with documented reasoning.

---

## 2. Framework Choices

**Use frameworks when they provide genuine leverage.**

| Framework | When to Use | When to Avoid |
|-----------|-------------|---------------|
| **Next.js** | Full-stack React apps, SSR matters, team knows it | Simple static sites, non-React teams |
| **Remix** | Data-heavy apps, progressive enhancement priority | Simple SPAs, unfamiliar teams |
| **Astro** | Content sites, partial hydration valuable | Highly interactive apps |
| **SvelteKit** | Smaller bundles critical, team willing to learn | Large existing React codebases |
| **Rails/Django** | Rapid CRUD apps, admin panels, proven patterns | Real-time heavy, team prefers JS |
| **FastAPI** | Python APIs, async matters | Simple scripts, team prefers other languages |
| **Hono/Elysia** | Edge functions, lightweight APIs | Complex apps needing full framework |

**The question isn't "framework or not" but "does this framework serve the thing we're creating, or are we creating something that serves the framework?"**

---

## 3. Human-Legible Systems

**Configuration**
- YAML/JSON are fine - the format isn't the problem
- Problem is: 500-line configs with nested conditionals
- Good: Config a new team member can read and modify in 10 minutes
- Document non-obvious settings inline

**Error messages that teach**
- What happened
- Why it happened
- What to do about it
- Link to docs if complex

**Logs you can understand**
- Structured logging (JSON) for machines
- Human-readable format for development
- Timestamps, context, severity
- Searchable without specialized tools

**Documentation lives WITH code**
- README in each significant directory
- API docs generated from code
- Architecture decisions recorded (ADRs)
- External wikis for onboarding/process only

---

## 4. Local-First Where It Matters

**Not "never use cloud" but "don't require cloud unnecessarily."**

| Feature | Local-First Approach | Cloud When |
|---------|---------------------|------------|
| Core functionality | Works offline | Never required for core |
| Data storage | SQLite/local storage | Sync, backup, multi-device |
| Computation | Client-side where possible | Heavy processing, shared resources |
| Auth | Local sessions work | OAuth for third-party, enterprise SSO |

**State should be inspectable**
- Serialize state to file for debugging
- State machines explicit, not implicit
- Reproducible from snapshot

**Sync as enhancement**
- Local is source of truth where possible
- Sync failures don't break the app
- Conflict resolution explicit, user-controlled

---

## 5. Composition Mindset

**Libraries over frameworks when:**
- You need one capability, not an ecosystem
- You want to control the architecture
- Exit cost matters more than speed

**Frameworks over libraries when:**
- Team expertise exists
- Time-to-market critical
- Convention over configuration is valuable
- The framework's opinions align with your needs

**APIs expose primitives**
- Convenience methods are fine
- But power users can access lower levels
- Don't hide the machine

**Minimize exit costs**
- Data exportable in standard formats
- Avoid proprietary lock-in where practical
- Document the exit path even if you never use it

---

## Cloud & Infrastructure

### When Cloud Makes Sense

| Use Case | Cloud Appropriate | Local/Edge Better |
|----------|-------------------|-------------------|
| Auth | Enterprise SSO, OAuth providers | Simple username/password |
| Storage | Multi-device sync, collaboration | Single-user, offline-capable |
| Compute | Heavy ML inference, video processing | Text processing, simple transforms |
| Database | Multi-writer, global distribution | Single user, local-first |
| Real-time | Multi-user collaboration | Single-user state |

### Cloud Pragmatically

- **Serverless** for spiky, unpredictable loads
- **Edge functions** for latency-sensitive operations
- **Managed databases** when ops overhead > cost
- **Self-hosted** when control/cost/compliance require it

**The question: Does cloud serve your users, or does it serve your assumptions about scale you don't have?**

---

## Threshold Triggers

**When to upgrade from defaults:**

| From | To | Trigger |
|------|-----|---------|
| SQLite | Postgres | >10 concurrent writers OR >100GB data OR need PostGIS/full-text search |
| Monolith | Services | Team can't work on same codebase OR genuine scale isolation needed |
| Static | Server | Need auth, real-time, or server-side computation |
| Local storage | Cloud sync | Multi-device is validated user need, not assumption |
| Library | Framework | Team expertise exists AND time-to-market critical AND framework opinions align |
| Simple | Complex | Pain is measurable, not theoretical |

---

## Justified Exceptions

**Complexity is acceptable when:**

- **Frameworks**: Team expertise exists AND problem fits framework opinions AND time-to-market matters
- **Cloud dependencies**: Multi-user collaboration OR heavy compute OR compliance requires it
- **Microservices**: Teams can't coordinate on monolith OR genuine scale isolation needed
- **Heavy tooling**: Build time investment pays off in development velocity

**Document the reasoning.** Future you will thank present you.
