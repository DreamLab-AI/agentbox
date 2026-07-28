# What This Rejects

These are the failure modes renaissance architecture pushes against. Treat them as smells to notice, not crimes — each has legitimate exceptions when the constraint is real.

---

## Derivative Thinking
- "X but for Y" without asking if Y needs X
- Features because competitors have them
- Patterns because tutorials use them
- Architecture because FAANG does it

## Cargo Cult Engineering
- "Best practices" from different-scale companies
- Microservices for 3-person teams
- Kubernetes for single-server loads
- OAuth for internal tools

## Premature Complexity
- Abstraction layers "for future flexibility"
- Scale architecture before scale problems
- Features before foundations work
- Real-time before single-user works

## Process Over Thinking
- Scrum ceremonies replacing actual thought
- Documentation for compliance, not clarity
- Meetings about meetings
- Roadmaps pretending to predict

---

## Review Checklists

Apply these when reviewing a design or generating a new solution.

### When Reviewing Designs

**First-Principles Check**
- [ ] What new thing does this create? (Not "what existing thing does it extend?")
- [ ] Why does this need to exist?
- [ ] What becomes possible that wasn't before?

**Simplicity Check**
- [ ] Is complexity earned or assumed?
- [ ] Can a new developer understand this in an hour?
- [ ] What's the simplest version that solves the core problem?

**Tool Fitness Check**
- [ ] Do tool choices serve the creation, or does creation serve the tools?
- [ ] Is the framework justified by team expertise + problem fit?
- [ ] Are cloud dependencies necessary or assumed?

**Human-Legibility Check**
- [ ] Can someone read the config and understand it?
- [ ] Do error messages teach?
- [ ] Is documentation where developers will find it?

**UI/UX Check**
- [ ] Is feedback immediate or honestly progressive?
- [ ] Can users see what the system is doing?
- [ ] Is everything recoverable/undoable?
- [ ] Are interruptions user-initiated?

### When Generating Solutions

**Start by asking:**
1. What genuinely new thing are we creating?
2. What's the simplest architecture that enables it?
3. What complexity is earned by real constraints?

**Default to:**
- Simplest tool that works
- Framework if team knows it and it fits
- Local-first where possible
- Cloud where genuinely needed

**Add complexity when:**
- Pain is measurable, not theoretical
- Team agrees on the tradeoff
- The path back to simple is documented
