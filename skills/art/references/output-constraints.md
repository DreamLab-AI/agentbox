# Output Constraints — Diagram Pitfalls & Platform Limits

Depth relocated from SKILL.md. Load when generating architecture/technical diagrams or
producing images for a specific social/publishing platform.

---

## Common Diagram Pitfalls (Avoid These)

**Learned from 2026-01-16 portfolio diagram session:**

| Pitfall | Problem | Fix |
|---------|---------|-----|
| Hex codes in prompts | `#1A8A9B` renders as visible text | Use "teal color" not "#1A8A9B" |
| Vague flow direction | Arrows go random directions | Explicitly state "LEFT TO RIGHT" or "TOP TO BOTTOM" |
| Duplicate labels | Text appears both inside and below elements | Specify "SINGLE label BELOW only, not inside" |
| Implicit positioning | Elements placed confusingly | Use "horizontal row" or "vertical column" explicitly |
| Assumed numbering | Numbers placed inconsistently | State "numbered 1-7 in sequence" |

**Pre-flight checklist for architecture diagrams:**
- [ ] No hex codes - use color names only
- [ ] Flow direction explicitly stated
- [ ] Label position explicitly stated (inside OR below, not both)
- [ ] Layout explicitly stated (horizontal/vertical)
- [ ] Key element highlighting specified

---

## Platform Constraints

| Platform | Dimensions | Max Size | Notes |
|----------|------------|----------|-------|
| YouTube thumbnail | 1280x720 (16:9) | **2MB** | Use `--size 1080p` or compress after |
| LinkedIn post | 1200x627 | 5MB | |
| Twitter/X post | 1200x675 (16:9) | 5MB | |
| Newsletter header | 1200x600 | 1MB | Email platform limit |
| Instagram square | 1080x1080 | 8MB | |

**If generated image exceeds size limit:**
```bash
# Compress PNG with pngquant
pngquant --quality=65-80 --force --output compressed.png original.png

# Or convert to optimized JPEG
convert original.png -quality 85 compressed.jpg
```
