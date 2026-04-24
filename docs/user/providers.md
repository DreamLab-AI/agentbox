# Provider Reference

Providers are gated by `[providers.<name>]` sections in `agentbox.toml`.
Set `enabled = true` only for providers you actually use; the boot-time
validator (E017) will emit a warning for every enabled provider whose
primary `env_var` is absent from the environment.

## Supported Providers

| Name | env_var | Optional env vars |
|---|---|---|
| `anthropic` | `ANTHROPIC_API_KEY` | — |
| `openai` | `OPENAI_API_KEY` | `OPENAI_BASE_URL` |
| `gemini` | `GOOGLE_GEMINI_API_KEY` | — |
| `deepseek` | `DEEPSEEK_API_KEY` | `DEEPSEEK_BASE_URL` |
| `perplexity` | `PERPLEXITY_API_KEY` | — |
| `openrouter` | `OPENROUTER_API_KEY` | — |
| `context7` | `CONTEXT7_API_KEY` | — |
| `brave` | `BRAVE_API_KEY` | — |
| `github` | `GITHUB_TOKEN` | — |
| `zai` | `ZAI_API_KEY` | `ZAI_ANTHROPIC_API_KEY`, `ZAI_URL` |

## Enabling a Provider

```toml
# agentbox.toml
[providers.anthropic]
enabled = true
env_var = "ANTHROPIC_API_KEY"
optional_env_vars = []
```

Then in `.env`:

```
ANTHROPIC_API_KEY=sk-ant-...
```

Run `agentbox config validate` to confirm no E017/E018 violations before building.

## Adding a New Provider

1. Add a `[providers.<name>]` block to `agentbox.toml` with `enabled = false`.
2. Set `env_var` to the primary credential env var name.
3. List any supplementary vars (base URLs, secondary keys) in `optional_env_vars`.
4. The validator and management-API boot check will pick it up automatically.

No code changes are required for the validator or boot check — they iterate
all `[providers.*]` keys dynamically.
