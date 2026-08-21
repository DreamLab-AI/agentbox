# PaperBanana Providers & Configuration

## Supported Providers

Model ids track the current nano-banana-2 / Gemini 3.x image era (consistent with the `art` skill).

| Component | Provider | Model | Notes |
|-----------|----------|-------|-------|
| VLM | Google Gemini | gemini-3.1-flash | Free tier available |
| Image Gen | Google Gemini | nano-banana-2 (`gemini-3.1-flash-image-preview`) | Free tier available |
| Image Gen (HQ) | Google Gemini | nano-banana-pro (`gemini-3-pro-image-preview`) | Maximum quality |
| VLM | OpenAI | gpt-image-1 | Best quality (verify current version at provider docs) |
| Image Gen | OpenAI | gpt-image-1 | Best quality (verify current version at provider docs) |
| VLM/Image | OpenRouter | Various | Flexible routing |

## Environment variables

```bash
# Provider selection
PAPERBANANA_VLM_PROVIDER=google        # or openai, openrouter
PAPERBANANA_IMAGE_PROVIDER=google      # or openai
PAPERBANANA_VLM_MODEL=gemini-3.1-flash
PAPERBANANA_IMAGE_MODEL=gemini-3.1-flash-image-preview   # nano-banana-2

# API keys
GOOGLE_API_KEY=your-gemini-key
OPENAI_API_KEY=your-openai-key

# Defaults
PAPERBANANA_DEFAULT_ITERATIONS=3
PAPERBANANA_DEFAULT_FORMAT=png
```

## `.env` file

```bash
# Place in project root or home directory
echo 'GOOGLE_API_KEY=your-key' >> .env
```
