# PaperBanana Troubleshooting

## "No API key found"
```bash
paperbanana setup  # Interactive wizard
# Or set directly:
export GOOGLE_API_KEY=your-key
```

## Poor quality output
- Add `--optimize` to pre-process inputs
- Use `--auto` for iterative refinement until critic satisfied
- Increase `--iterations` (default 3, try 5-7)
- Provide more detailed source text

## Rate limiting
- Gemini free tier: limited requests/minute
- Add delays between batch items
- Consider OpenAI for high-volume generation

## Image not matching description
- Use `--continue` to resume with feedback
- The critic evaluation shows which dimensions scored low
- Refine the caption to be more specific about visual layout
