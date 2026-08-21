# FossFLOW Validation, Running & Troubleshooting

## Validation Checklist

**Compact Format:**
- [ ] Metadata exactly `{"f": "compact", "v": "1.0"}`
- [ ] Item names max 30 chars, descriptions max 100 chars
- [ ] Title max 40 chars
- [ ] Connection indices valid (0 to n-1)
- [ ] Icon names from available list

**Verbose Format:**
- [ ] All items have unique `id`
- [ ] Connector `from`/`to` match item IDs
- [ ] Colors referenced in connectors exist in `colors` array
- [ ] Icon names from available list

**Both Formats:**
- [ ] Positions within -20 to +20 range
- [ ] 3-5 unit spacing between connected items
- [ ] Valid JSON structure

Run `scripts/validate-diagram.js` to check a diagram file against these rules programmatically.

## Running FossFLOW

```bash
# Local development
cd /home/devuser/workspace/dreamlab-cumbria/FossFLOW
npm install && npm run dev
# Access at http://localhost:3001

# Import diagram: Hamburger menu → Open → Select JSON
# Fit to screen: Press '0' key
# Export: File menu → Export
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "Error in your model" | Check metadata format, icon names, and JSON structure |
| Connectors invisible | Verify from/to IDs match item IDs exactly |
| Icons missing | Use exact icon names (case-sensitive) |
| Layout cramped | Increase coordinate spacing to 4-6 units |
| Import fails | Validate JSON; check required fields |
