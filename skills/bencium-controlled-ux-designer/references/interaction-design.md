# Interaction Design

Motion, animation, and UX patterns. For full easing-curve and duration tables see
[motion-spec.md](./motion-spec.md).

## Motion & Animation

### Purposeful Animation

Every animation must serve a functional purpose:
- **Orient users**: Smooth transitions during navigation changes
- **Establish relationships**: Show how elements connect (expand from source, slide between states)
- **Provide feedback**: Confirm interactions (button press, form submission)
- **Guide attention**: Direct focus to important changes (new messages, errors)

### Animation & Gestalt Principles

Motion should reinforce visual relationships:
- **Proximity**: Elements near each other move together (grouped cards animating)
- **Similarity**: Similar elements animate similarly (all buttons have same hover timing)
- **Continuity**: Movement follows natural paths (smooth curves, not jumpy angles)
- **Figure-ground**: Important elements animate while backgrounds stay stable

### Natural Physics

Animations should feel organic, not mechanical:
- **Easing**: Use ease-out for entrances (fast start, slow end)
- **Easing**: Use ease-in for exits (slow start, fast end)
- **Easing**: Use ease-in-out for transitions (smooth both ends)
- Avoid linear easing (feels robotic) except for continuous loops
- Apply appropriate mass/momentum (lightweight UI vs weighty modals)

### Subtle Restraint
- Animations should be felt rather than seen
- Don't delay user actions unnecessarily (keep under 300ms for interactive feedback)
- Never block critical actions with decorative animations
- Respect `prefers-reduced-motion` media query

### Timing Guidelines
- **Micro-interactions** (button press, checkbox toggle): 100-150ms
- **State changes** (expanding accordion, tab switch): 200-300ms
- **Page transitions** (route changes, modal open/close): 300-500ms
- **Attention-directing** (notification appearance, error highlight): 200-400ms

### Physics Profiles

Define consistent durations for element types:
- **Lightweight** (icons, small UI): 150ms
- **Standard** (cards, panels): 300ms
- **Weighty** (modals, page transitions): 500ms

### Performance Optimization
- Animate `transform` and `opacity` only (GPU-accelerated, smooth 60fps)
- Avoid animating `width`, `height`, `top`, `left`, `margin` (causes reflow/repaint)
- Use `will-change` sparingly for complex animations (pre-allocates GPU resources)
- Test on low-end devices (60fps on powerful hardware ≠ 60fps on mobile)

### Implementation
- Use `framer-motion` sparingly and purposefully
- Prefer CSS animations over JavaScript when possible (better performance)
- Use CSS transitions for simple hover/focus states
- Implement `@media (prefers-reduced-motion: reduce)` to disable/reduce animations

**Example:**
```tsx
// Simple hover transition
<button className="
  transition-colors duration-200 ease-out
  bg-blue-600 hover:bg-blue-700
">
  Click me
</button>

// Framer Motion for complex interaction
<motion.div
  initial={{ opacity: 0, y: 20 }}
  animate={{ opacity: 1, y: 0 }}
  exit={{ opacity: 0, y: -20 }}
  transition={{ duration: 0.3, ease: "easeOut" }}
>
  Content
</motion.div>
```

For detailed motion specs (easing curves, duration tables, state-specific
animations, implementation patterns), see [motion-spec.md](./motion-spec.md).

## User Experience Patterns

### Core UX Principles

1. **Direct Manipulation**
   - Users interact directly with content, not through abstract controls
   - Examples:
     - Drag & drop to reorder items (not up/down buttons)
     - Inline editing (click to edit, not separate form)
     - Sliders for ranges (not numeric input with +/-)
     - Pinch/zoom gestures on mobile (not +/- buttons)

2. **Immediate Feedback**
   - Every interaction provides instantaneous visual feedback (within 100ms)
   - Types of feedback:
     - **Visual**: Button pressed state, hover effects, color changes
     - **Haptic**: Vibration on mobile (submit, error, success)
     - **Audio**: Subtle sounds for critical actions (optional, user-controlled)
     - **Loading**: Skeleton screens, spinners for >300ms operations
     - **Success**: Checkmarks, green highlights, toast notifications
     - **Error**: Red highlights, inline error messages, shake animations

3. **Consistent Behavior**
   - Similar-looking elements behave similarly
   - Examples:
     - **Visual consistency**: All primary buttons have same colors, sizes, hover states
     - **Behavioral consistency**: All modals close via X button, ESC key, and outside click
     - **Interaction consistency**: All drag targets have same hover state and drop feedback
     - **Pattern consistency**: All forms validate on blur and submit

4. **Forgiveness**
   - Make errors difficult, but recovery easy
   - **Prevention strategies**:
     - Disable invalid actions (grey out unavailable buttons)
     - Validate inputs inline (before submission)
     - Confirm destructive actions (delete, overwrite)
     - Auto-save in background (drafts, progress)
   - **Recovery strategies**:
     - Undo/redo for all state changes
     - Soft deletes (trash/archive before permanent delete)
     - Clear error messages with actionable fixes
     - Preserve user input on errors (don't clear forms)

5. **Progressive Disclosure**
   - Reveal details as needed rather than overwhelming users
   - Levels of disclosure:
     - **Summary**: Show essential info by default (card title, price, rating)
     - **Details**: Expand to show more info (description, specs, reviews)
     - **Advanced**: Hide complex options behind "Advanced settings" toggle
   - Examples:
     - Accordion: Start collapsed, expand on click
     - Search filters: Show 3-5 common filters, hide rest behind "More filters"
     - Settings: Basic settings visible, advanced behind "Show advanced"

### Modern UX Patterns

1. **Conversational Interfaces**

   Prioritize natural language interaction where appropriate:

   **Four types:**
   - **Pure chat**: Full conversation (AI assistants, support bots)
   - **Command palette**: Text-based shortcuts (Cmd+K, search everywhere)
   - **Smart search**: Natural language queries (search "meetings next week" vs filtering)
   - **Form alternatives**: Conversational data collection ("What's your name?" vs form fields)

   **When to use:**
   - Complex searches with multiple variables
   - Task guidance (wizards, onboarding)
   - Contextual help
   - Quick actions (command palette)

   **When NOT to use:**
   - Simple forms (just use inputs)
   - Precise control interfaces (design tools, dashboards)
   - High-frequency repetitive tasks

2. **Adaptive Layouts**

   Respond to user context automatically:
   - **Time-based**: Dark mode at night, light during day
   - **Device-based**: Simplified UI on mobile, full features on desktop
   - **Connection-based**: Reduce images/video on slow connections
   - **Usage-based**: Prioritize frequent actions, hide rarely-used features

   Examples:
   - Auto dark/light mode based on time or system preference
   - Simplified mobile navigation (hamburger menu) vs full desktop nav
   - Collapsed sidebar on small screens, expanded on large

3. **Minimal, Flat Design**

   Current aesthetic preference:
   - No drop shadows (except subtle ones for modals/dropdowns)
   - No gradients for depth (use for accents/backgrounds if desired)
   - No glass morphism effects
   - Focus on typography, color, and spacing to create hierarchy
   - Functional depth: Layers of content (modals, sheets) use positioning, not visual depth

### Navigation
- Clear structure with intuitive navigation menus
- Implement breadcrumbs for deep hierarchies (more than 2 levels)
- Use standard UI patterns to reduce learning curve (hamburger menu, tab bars)
- Ensure predictable behavior (back button works, links look clickable)
- Maintain navigation context (highlight current page, preserve scroll position)
