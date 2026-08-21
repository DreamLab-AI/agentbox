# Implementation Stack (--build mode)

## Component Library
- **shadcn/ui** (v4): prefer over plain HTML — `import { Button } from "@/components/ui/button"`
- **Tailwind CSS**: utility classes exclusively; `@theme` variables from `tailwind.config.js`
- **Icons**: `@phosphor-icons/react` — `import { Plus } from "@phosphor-icons/react"`
- **Toasts**: `sonner` — `import { toast } from 'sonner'`
- **Animation**: CSS-first; Motion library for React when complex orchestration needed

## Layout Implementation
- Grid/flex wrappers with `gap` for spacing; nest wrappers as needed
- Conditional styling: `clsx('base-class', { 'active-class': isActive })`
- Responsive: mobile-first, relative units (%, em, rem), content-based breakpoints

## Loading States
- Always add loading states — skeletons until content renders
- Spinners for >300ms operations; placeholder animations for skeleton screens

## Testing Checklist
- Playwright MCP for automated visual testing
- Responsive across breakpoints (mobile/tablet/desktop)
- Touch targets verified on mobile
- Keyboard navigation + screen reader compatibility
- Color contrast ratios (4.5:1 normal text, 3:1 large text)
