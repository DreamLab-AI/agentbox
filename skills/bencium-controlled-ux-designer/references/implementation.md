# Styling, Accessibility & Process

Implementation detail for the stack this skill targets (React + Tailwind + shadcn),
plus accessibility requirements and the design workflow. For deep references see
[accessibility.md](./accessibility.md) and [responsive-design.md](./responsive-design.md).

## Styling Implementation

### Component Library & Tools

**Component Library:**
- Strongly prefer shadcn components (v4, pre-installed in `@/components/ui`)
- Import individually: `import { Button } from "@/components/ui/button";`
- Use over plain HTML elements (`<Button>` over `<button>`)
- Avoid creating custom components with names that clash with shadcn

**Styling Engine:**
- Use Tailwind utility classes exclusively
- Adhere to theme variables in `index.css` via CSS custom properties
- Map variables in `@theme` (see `tailwind.config.js`)
- Use inline styles or CSS modules only when absolutely necessary

**Icons:**
- Use `@phosphor-icons/react` for buttons and inputs
- Example: `import { Plus } from "@phosphor-icons/react"; <Plus />`
- Use color for plain icon buttons
- Don't override default `size` or `weight` unless requested

**Notifications:**
- Use `sonner` for toasts
- Example: `import { toast } from 'sonner'`

**Loading States:**
- Always add loading states, spinners, placeholder animations
- Use skeletons until content renders

### Layout Implementation

**Spacing Strategy:**
- Use grid/flex wrappers with `gap` for spacing
- Prioritize wrappers over direct margins/padding on children
- Nest wrappers as needed for complex layouts

**Conditional Styling:**
- Use ternary operators or clsx/classnames utilities
- Example: `className={clsx('base-class', { 'active-class': isActive })}`

## Responsive Design

**Fluid Layouts:**
- Use relative units (%, em, rem) instead of fixed pixels
- Implement CSS Grid and Flexbox for flexible layouts
- Design mobile-first, then scale up

**Media Queries:**
- Use breakpoints based on content needs, not specific devices
- Test across range of devices and orientations

**Touch Targets:**
- Minimum 44x44 pixels for interactive elements
- Provide adequate spacing between touch targets
- Consider hover states for desktop, focus states for touch/keyboard

**Performance:**
- Optimize assets for mobile networks
- Use CSS animations over JavaScript
- Implement lazy loading for images and videos

Full breakpoint strategy and mobile-first patterns: [responsive-design.md](./responsive-design.md).

## Accessibility Standards

**Core Requirements:**
- Follow WCAG 2.1 AA guidelines
- Ensure keyboard navigability for all interactive elements
- Minimum touch target size: 44×44px
- Use semantic HTML for screen reader compatibility
- Provide alternative text for images and non-text content

**Implementation Details:**
- Use descriptive variable and function names
- Event functions: prefix with "handle" (handleClick, handleKeyDown)
- Add accessibility attributes:
  - `tabindex="0"` for custom interactive elements
  - `aria-label` for buttons without text
  - `role` attributes when semantic HTML isn't sufficient
- Ensure logical tab order
- Provide visible focus states

Comprehensive WCAG 2.1 AA guide (POUR, semantic HTML, ARIA patterns): [accessibility.md](./accessibility.md).

## Design Process & Testing

### Design Workflow

1. **Understand Context:**
   - What problem are we solving?
   - Who are the users and when will they use this?
   - What are the success criteria?

2. **Explore Options:**
   - Present 2-3 alternative approaches
   - Explain trade-offs of each option
   - Ask which direction resonates

3. **Implement Iteratively:**
   - Start with structure and hierarchy
   - Add visual polish progressively
   - Test at each stage

4. **Validate:**
   - Use playwright MCP to test visual changes
   - Check across different screen sizes
   - Verify accessibility

### Testing Checklist

**Visual Testing:**
- Use playwright MCP when available for automated testing
- Check responsive behavior at common breakpoints
- Verify touch targets on mobile
- Test with different content lengths (short, long, edge cases)

**Accessibility Testing:**
- Test keyboard navigation
- Verify screen reader compatibility
- Check color contrast ratios
- Ensure focus states are visible

**Cross-Device Testing:**
- Test on actual devices, not just emulators
- Check different browsers (Chrome, Firefox, Safari)
- Verify touch interactions on mobile
- Test landscape and portrait orientations
