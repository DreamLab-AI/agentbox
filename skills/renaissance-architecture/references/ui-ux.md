# UI/UX Philosophy

Guidance for interfaces that respect the user. Judgment-based defaults — the only hard line is on autoplay audio and never faking progress.

---

## 1. Immediate Feedback

**<100ms for user actions, honest progress for longer operations**

- Optimistic updates where safe (can rollback)
- Progress indicators that reflect actual work
- Spinners are fine - they indicate honest work
- Skeleton screens for predictable loading patterns

**Loading states should:**
- Show what's happening
- Estimate time when possible
- Allow cancellation for long operations
- Never fake progress

---

## 2. Visible State

**User always knows what the system is doing**

- Status visible without digging
- Background processes surfaced
- Errors prominent, not hidden
- System explains its decisions when non-obvious

**No black boxes**
- User can understand why something happened
- Audit trail for important actions
- State inspectable in dev tools

---

## 3. Spatial Consistency

**Things stay where you put them**

- No layout shifts after load
- No rearranging "for the user"
- Muscle memory works
- Consistent component placement

**Predictable navigation**
- Back button works
- URLs are bookmarkable and shareable
- State survives refresh
- Deep linking works

---

## 4. Undo & Recovery

**Implemented at the data layer, not just UI**

- Soft delete by default
- Versioned state where valuable
- Recovery path documented
- "Are you sure?" is not a substitute for undo

**Destructive actions**
- Confirmation for irreversible operations
- Grace period before permanent deletion
- Clear communication of consequences

---

## 5. Respect Attention

**Notifications**
- User opts in explicitly
- Meaningful, not engagement-driven
- Batched where appropriate
- Easy to adjust or disable

**Modals & Interruptions**
- User-initiated, not system-initiated
- Dismissable
- Don't trap focus unnecessarily
- Keyboard accessible

**Autoplay**
- Never for audio
- Video only with explicit user intent
- Motion respects prefers-reduced-motion

**Defaults over customization**
- Good defaults eliminate settings
- Power user options available but not required
- Complexity progressive
