# ComfyUI Integration — Historical Patch Artifacts

These files were originally committed as live files in `management-api/` but are
**patch-instruction artifacts**, not runtime code. The integration they describe
is **already fully applied** in `management-api/server.js`:

- `ComfyUIManager` is required and instantiated (`server.js`)
- `routes/comfyui.js` is registered with the manager and payment gate
- The `/v1/comfyui/*` route surface is live

They were relocated here on the R-013 dead-code/duplication sprint to prevent
accidental `require()` or execution and to retain them as a historical record of
how the integration was wired.

| File | What it was |
|------|-------------|
| `server-comfyui-integration.patch.js` | Reference snippets for wiring ComfyUI into `server.js` |
| `package-comfyui-update.json` | Dependency additions (now in `management-api/package.json`) |
| `test-comfyui.sh` | One-off smoke script for the ComfyUI route surface |

Do not move these back into `management-api/`. If the integration needs to
change, edit `server.js`, `routes/comfyui.js`, and `utils/comfyui-manager.js`
directly.
