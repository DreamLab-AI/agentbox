# Agentbox Management API

This directory contains the HTTP management API used by the Agentbox runtime.

## Current Role

The management API is the local control surface for:

- health and readiness checks
- task submission and inspection
- system status
- metrics
- agent event streaming
- optional ComfyUI integration routes

It is intended to run inside the Agentbox container under supervisord.

## Current Authentication Model

The API now supports a hybrid authentication path:

- `Authorization: Bearer <token>`
- `Authorization: Nostr <base64-event>` for scaffold-level NIP-98 support

The auth mode is controlled with:

- `MANAGEMENT_API_KEY`
- `MANAGEMENT_API_AUTH_MODE`

Current modes:

- `bearer`
- `nip98`
- `hybrid`

Important limitation:

- the NIP-98 path is currently structural/freshness validation, not full cryptographic signature verification

## Runtime Contract

Default runtime environment:

- port: `9090`
- host: `0.0.0.0`
- managed by supervisord
- mounted in the image at `/opt/agentbox/management-api`

Health endpoints that do not require auth:

- `GET /health`
- `GET /ready`
- `GET /metrics`

## Main Files

- `server.js`: Fastify server bootstrap
- `middleware/auth.js`: bearer + NIP-98 auth middleware
- `routes/tasks.js`: task routes
- `routes/status.js`: status and health routes
- `routes/comfyui.js`: ComfyUI routes
- `routes/agent-events.js`: event stream routes

## Notes

- Older documentation that mentions pm2, CachyOS workstation assumptions, or bearer-only auth is obsolete.
- The management API is part of the agentbox runtime, not a standalone workstation control plane.
