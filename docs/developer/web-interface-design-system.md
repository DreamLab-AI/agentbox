# Agentbox web-interface design contract

Agentbox owns two browser interfaces: the running-system cockpit and the
pre-boot setup wizard. They retain their distinct visual character, but expose
the same semantic CSS token vocabulary:

| Token | Meaning |
|---|---|
| `--agentbox-accent` | Product accent; use for the single primary action |
| `--agentbox-focus` | Keyboard focus indicator |
| `--agentbox-surface` | Raised working surface |
| `--agentbox-foreground` | Primary readable text |
| `--agentbox-muted` | Secondary text that still meets WCAG AA |
| `--agentbox-success` | Confirmed healthy or completed state |
| `--agentbox-warning` | Degraded, waiting, or consequential state |
| `--agentbox-danger` | Failed, unavailable, or destructive state |
| `--agentbox-radius` | Standard control radius |

The tokens are aliases over each surface's local palette, not an instruction to
make the setup wizard and cockpit visually identical. Upstream interfaces—AoE,
code-server, JupyterLab, and ComfyUI—are configured and linked, not forked for
cosmetic consistency.

Quality is enforced by `npm run test:web`: Playwright drives the existing
browsercontainer Chrome, injects axe-core, checks desktop/mobile overflow and
WCAG A/AA, and compares the owned interfaces against committed screenshots.
The focused Jest contract additionally prevents reintroducing the retired setup
dashboard or drifting the navigation, authentication, and token contracts.
