# Quick Code Examples

### Distinctive Button (Not Generic)
```tsx
import { Button } from "@/components/ui/button";
import { ArrowRight } from "@phosphor-icons/react";

// Terracotta accent — not the default SaaS blue
<Button className="bg-[#C4603C] hover:bg-[#A8502F] text-white px-6 py-3 rounded-none
                   font-mono tracking-widest text-xs uppercase transition-colors duration-200">
  Begin
  <ArrowRight className="ml-2" />
</Button>
```

### Typography Hierarchy (Distinctive)
```tsx
<div className="space-y-4">
  {/* Editorial serif — NOT Inter */}
  <h1 className="font-['Playfair_Display'] text-6xl font-bold tracking-tight text-slate-900">
    Headline
  </h1>
  <p className="font-['IBM_Plex_Mono'] text-sm text-slate-600 leading-relaxed max-w-prose">
    Body copy with technical clarity.
  </p>
</div>
```

### Grain Overlay (Anti-Flat Background)
```css
.atmospheric-bg::before {
  content: '';
  position: fixed;
  inset: 0;
  background-image: url("data:image/svg+xml,..."); /* SVG noise */
  opacity: 0.04;
  pointer-events: none;
  z-index: 0;
}
```
