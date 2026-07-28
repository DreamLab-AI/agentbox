# Full Audit Rubric

The complete protocol for a broad-scope design audit ("audit the design", "make it
feel premium"). For a single focused change, use `refinement-lenses.md` instead.

## Before you start

Read and internalize before forming any opinion:

1. **DESIGN_SYSTEM (.md)** — tokens, colors, typography, spacing, shadows, radii
2. **FRONTEND_GUIDELINES (.md)** — component engineering, state management, file structure
3. **APP_FLOW (.md)** — every screen, route, user journey
4. **PRD (.md)** — features and requirements
5. **TECH_STACK (.md)** — what the stack supports
6. **progress (.txt)** — current build state
7. **LESSONS (.md)** — past design mistakes and corrections
8. **The live app** — walk every screen at mobile → tablet → desktop. Experience it as a user.

Understand the current system completely before proposing changes.

## Step 1 — Full audit

Review every screen against these dimensions. Miss nothing.

| Dimension | What to evaluate |
|-----------|-----------------|
| **Visual Hierarchy** | Does the eye land where it should? Primary action unmissable? Screen readable in 2 seconds? |
| **Spacing & Rhythm** | Consistent, intentional whitespace? Vertical rhythm harmonious? |
| **Typography** | Clear size hierarchy? Too many weights competing? Calm or chaotic? |
| **Color** | Restraint and purpose? Guiding attention or scattering it? Accessible contrast? |
| **Alignment & Grid** | Consistent grid? Anything off by 1–2px? Every element locked in? |
| **Components** | Identical styling across screens? Interactive elements obvious? All states covered (hover, focus, disabled)? |
| **Iconography** | Consistent style, weight, size? One cohesive set or mixed libraries? |
| **Motion** | Natural and purposeful transitions? Any gratuitous animation? Feasible in current stack? |
| **Empty States** | Every screen with no data — intentional or broken? User guided to first action? |
| **Loading States** | Consistent skeletons/spinners? App feels alive while waiting? |
| **Error States** | Styled consistently? Helpful and clear, not hostile and technical? |
| **Dark Mode** | If supported — actually designed or just inverted? Tokens/shadows/contrast hold up? |
| **Density** | Can anything be removed? Redundant elements? Every element earning its place? |
| **Responsiveness** | Works at every viewport? Touch targets sized for thumbs? Fluid adaptation, not just breakpoints? |
| **Accessibility** | Keyboard nav, focus states, ARIA labels, contrast ratios, screen reader flow? |

## Step 2 — Apply the reduction filter

For every element on every screen:

- Can this be removed without losing meaning? → Remove it.
- Would a user need to be told this exists? → Redesign until obvious.
- Does this feel inevitable? → If not, it's not done.
- Is visual weight proportional to functional importance? → If not, fix hierarchy.

## Step 3 — Compile the plan

Read `audit-template.md` for the exact output format. Organize findings into three phases:

- **Phase 1 — Critical**: Hierarchy, usability, responsiveness, consistency issues that actively hurt UX
- **Phase 2 — Refinement**: Spacing, typography, color, alignment, iconography that elevate the experience
- **Phase 3 — Polish**: Micro-interactions, transitions, empty/loading/error states, dark mode, subtle details

Include: design system updates required + implementation notes precise enough for a build agent to execute without interpretation.

## Step 4 — Wait for approval

- Present the plan. Do not implement anything.
- User may reorder, cut, or modify any recommendation.
- Execute only what's approved, surgically.
- After each phase: present results for review before moving to the next.
- If the result doesn't feel right, say so. Propose refinement before proceeding.

## Scope discipline — full rules

### You touch
- Visual design, layout, spacing, typography, color, interaction design, motion, accessibility
- DESIGN_SYSTEM token proposals when new values are needed
- Component styling and visual architecture

### You do not touch
- Application logic, state management, API calls, data models
- Feature additions, removals, or modifications
- Backend structure

If a design improvement requires a functional change, flag it:
> "This design improvement would require [functional change]. Outside my scope. Flagging for the build agent."

### Rules
- Every design change should preserve existing functionality exactly as defined in PRD
- All values should reference DESIGN_SYSTEM tokens — avoid hardcoded colors, spacing, or sizes
- If a component doesn't exist in DESIGN_SYSTEM, propose it — don't invent it silently
- If user behavior for a screen isn't documented in APP_FLOW, ask before designing for an assumed flow

## After implementation

1. Update **progress (.txt)** with design changes made
2. Update **LESSONS (.md)** with patterns or mistakes to remember
3. If DESIGN_SYSTEM was updated, confirm agent instruction files are current
4. Flag remaining approved-but-not-implemented phases
5. Present before/after comparison for each changed screen when possible

## Open-design integration

### 5-dimensional critique gate

After completing your audit, apply the five-dimensional scoring from
`../../open-design/references/critique-dimensions.md` to validate the post-audit state:

1. **Philosophy Consistency** — Does the audit produce a coherent result, or have patches introduced style conflicts?
2. **Visual Hierarchy** — Has the hierarchy improved measurably?
3. **Detail Execution** — Are spacing/alignment issues resolved to magazine-grade?
4. **Functionality** — Has responsiveness and accessibility improved?
5. **Innovation** — Is the result distinctive or merely "cleaner generic"?

Aim for all dimensions ≥6 post-audit. If Phase 1 changes lower any dimension, flag before proceeding.

### DESIGN.md compatibility

When auditing a project that uses an open-design DESIGN.md specification:
- All proposed token changes should remain within the schema format (6 required tokens + semantic)
- Shadow, radius, and spacing proposals should reference the DESIGN.md depth/elevation levels
- Derive new tokens via `color-mix()` — don't proliferate the palette
- See `../../open-design/references/design-system-schema.md` for the authoring format

### Anti-slop check

Apply `../../open-design/references/anti-slop-rules.md` as a final pass. If post-audit
output triggers ≥3 slop signals, the audit hasn't gone far enough — it's cleaned up
mediocrity without introducing distinction.
