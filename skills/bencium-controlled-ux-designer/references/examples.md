# Examples & Patterns

Worked examples of the collaborate-then-implement flow, plus the do/don't checklist.

## Example 1: Designing a Button

**Initial Questions to Ask:**
```
Before I implement this button, I have a few design questions:
1. What's the primary action you want to emphasize?
2. Do you have brand colors in mind, or should I suggest options?
3. What emotion should this button convey? (urgent, calm, playful, professional)
```

**After Confirming Direction, Implementation:**
```tsx
import { Button } from "@/components/ui/button";
import { ArrowRight } from "@phosphor-icons/react";

<Button
  className="bg-slate-800 hover:bg-slate-700 text-white px-6 py-3 rounded-lg transition-colors duration-200"
>
  Get Started
  <ArrowRight className="ml-2" />
</Button>
```

## Example 2: Typography Hierarchy

**Question First:**
```
For this content hierarchy, I'm thinking:
- Headline: Large, bold, attention-grabbing
- Subheading: Medium, regular weight
- Body: Smaller, optimized for reading

Should we go bold and contemporary, or subtle and refined?
```

**Implementation After Confirming:**
```tsx
<div className="space-y-4">
  <h1 className="text-5xl font-bold tracking-tight text-slate-900">
    Headline Here
  </h1>
  <h2 className="text-2xl text-slate-600">
    Supporting subheading
  </h2>
  <p className="text-base leading-relaxed text-slate-700">
    Body text optimized for readability with proper line height.
  </p>
</div>
```

## Example 3: Unique Color Palette Suggestion

**Presenting Options:**
```
I'd like to suggest three color directions that break from typical SaaS patterns:

1. **Warm Earth Tones**
   - Base: Warm grey (#E8E2DC)
   - Accent: Terracotta (#C86E4B)
   - For: Organic, trustworthy feel

2. **Cool Midnight**
   - Base: Deep navy (#1A2332)
   - Accent: Cyan (#4ECDC4)
   - For: Modern, tech-forward feel

3. **Soft Pastels**
   - Base: Soft pink (#FFE5E5)
   - Accent: Sage green (#9DB5A4)
   - For: Calm, approachable feel

Which direction feels right for your brand?
```

## Common Patterns to Avoid

❌ **Don't:**
- Use generic SaaS blue (#3B82F6) without considering alternatives
- Default to shadows and gradients for depth
- Copy Apple's design language
- Use glass morphism effects
- Make significant design decisions without confirming direction
- Implement typography without considering the font version
- Use animations that delay user actions
- Create cluttered interfaces with competing elements

✅ **Do:**
- Confirm direction before committing to a design language
- Suggest unique, contextually appropriate color pairs
- Use flat, minimal design
- Consider unconventional typography choices
- Provide immediate feedback for interactions
- Create generous white space
- Test with real devices
- Validate accessibility
