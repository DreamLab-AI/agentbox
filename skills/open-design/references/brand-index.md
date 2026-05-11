# Brand Specification Index — 129 Design Systems

Specify a brand name during structured intake to load its DESIGN.md tokens.

---

## Developer Tools & SaaS

| Brand | Character | Key Token |
|-------|-----------|-----------|
| linear-app | Dark-native, indigo accent, Inter+weight 510 | `#5e6ad2` |
| github | Clean white, blue accents, Mona Sans | `#0969da` |
| vercel | B&W with blue accent, Geist font | `#0070f3` |
| cursor | Dark IDE, purple accent | `#7c3aed` |
| stripe | Light, deep navy + purple, sohne-var | `#533afd` |
| figma | Bright purple/rainbow on white | `#a259ff` |
| notion | Warm neutral, serif display | `#000000` |
| posthog | Dark with warm yellow | `#f9bd2b` |
| hashicorp | Black/white, geometric precision | `#000000` |
| openai | Minimal, green accent | `#10a37f` |
| anthropic | Warm cream, orange-brown | `#d97706` |
| cohere | Deep purple gradients | `#39594d` |
| mistral-ai | Orange accent, dark base | `#f97316` |
| ollama | Friendly white, blue | `#0ea5e9` |
| raycast | Dark, pink/purple gradient | `#ff6363` |
| arc | Bright pastels, playful | `#5856d6` |
| framer | Dark, vibrant blue | `#0055ff` |
| supabase | Dark emerald green | `#3ecf8e` |
| mongodb | Dark green/forest | `#00ed64` |

## Design & Creative

| Brand | Character | Key Token |
|-------|-----------|-----------|
| canva | Bright purple, friendly | `#7d2ae8` |
| miro | Dark yellow, collaborative | `#ffd02f` |
| adobe | Dark red accent | `#eb1000` |
| pinterest | Clean white, red accent | `#e60023` |

## Finance & Enterprise

| Brand | Character | Key Token |
|-------|-----------|-----------|
| coinbase | Blue gradient, finance | `#0052ff` |
| binance | Dark, gold accent | `#f0b90b` |
| mastercard | Orange/red, premium | `#eb001b` |
| kraken | Purple, dark | `#5741d9` |

## Consumer & Social

| Brand | Character | Key Token |
|-------|-----------|-----------|
| discord | Dark indigo, blurple | `#5865f2` |
| airbnb | Coral on white | `#ff5a5f` |
| duolingo | Bright green, playful | `#58cc02` |
| nike | B&W, bold, athletic | `#000000` |
| meta | Blue, clean | `#0668e1` |
| spotify | Dark, green accent | `#1db954` |

## Automotive & Luxury

| Brand | Character | Key Token |
|-------|-----------|-----------|
| bmw | Blue/white, premium | `#0066b1` |
| ferrari | Racing red, dark | `#dc0000` |
| bugatti | Dark blue, luxury | `#0f2a4e` |
| lamborghini | Gold on black | `#ddb321` |
| renault | Yellow, modern | `#ffcc00` |

## Gaming

| Brand | Character | Key Token |
|-------|-----------|-----------|
| playstation | Dark blue, immersive | `#003087` |
| nvidia | Dark, green accent | `#76b900` |

## Style-Based (No Brand)

| System | Character | Use When |
|--------|-----------|----------|
| default | Neutral modern, cobalt accent | No specific brand |
| minimal | Ultra-sparse, max whitespace | Clean utility |
| brutalism | Raw, harsh, intentional | Bold statement |
| editorial | Magazine-style, serif display | Content-heavy |
| glassmorphism | Frosted panels, translucent | Modern glass effect |
| neumorphism | Soft shadows, embossed | Soft 3D interface |
| neobrutalism | Bold borders, bright fills | Playful/bold apps |
| clay | Rounded 3D, matte | Friendly product |
| neon | Dark with neon glow | Night/gaming |
| gradient | Rich color gradients | Creative/expressive |
| mono | Single color + shades | Elegant restraint |
| paper | Textured, warm, organic | Stationery/docs |
| dithered | 1-bit retro, halftone | Nostalgic/retro |
| cosmic | Deep space, stars, glow | Sci-fi/futuristic |
| elegant | Thin serifs, generous space | Luxury/premium |

---

## Using a Brand

In the structured intake:

```
User: "Build a landing page using the Stripe design system"
→ Loads design-systems/stripe/DESIGN.md
→ Maps tokens: --bg=#ffffff, --fg=#061b31, --accent=#533afd, etc.
→ Uses sohne-var weight 300 for display
→ Blue-tinted multi-layer shadows
```

```
User: "Dashboard, dark mode, Linear-style"
→ Loads design-systems/linear-app/DESIGN.md
→ Maps tokens: --bg=#0f1011, --fg=#f7f8f8, --accent=#5e6ad2
→ Inter Variable with cv01+ss03
→ Semi-transparent borders
```

## Creating a New Brand

Follow the schema in `references/design-system-schema.md`. Minimum sections: Visual Theme, Color Palette, Typography Rules.
