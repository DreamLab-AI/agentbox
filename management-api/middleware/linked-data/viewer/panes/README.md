# Built-in viewer panes

This directory holds agentbox's first-party panes for the viewer slot
([PRD-006 §15](../../../../../docs/reference/prd/PRD-006-linked-data-interfaces.md#15-viewer-slot)).
They cover the surfaces the upstream linkedobjects/browser does not
ship — every other surface is rendered by an upstream pane (folder,
profile, markdown, todo, playlist, sharing, source).

| File | Surface | What it renders |
|------|---------|-----------------|
| `vc-pane.js` | S3 / S8 | Verifiable Credentials, payment mandates and receipts |
| `provenance-pane.js` | S5 / S11 | PROV-O Activity records and `agbx:AgentEventStream` envelopes |
| `capability-pane.js` | S6 | W3C WoT Thing Descriptions for MCP servers |
| `runtime-pane.js` | S11 | `/v1/meta` — the agentbox runtime contract |
| `dcat-pane.js` | S9 | DCAT-3 catalogues, e.g. memory namespace catalogues |
| `handoff-pane.js` | S2 | Agent-to-agent verbs (HandoffClaim, RequestBriefing, DeliverArtefact) |
| `enrichment-review-pane.js` | S12 | Broker Review Surface (G6, PRD-013): two-pane diff of agent-proposed knowledge enrichments with inline approval actions |

## Writing a new pane

A pane is one ES module exporting a default object with this shape:

```js
import { html, render } from '../losos/html.js';

export default {
  id: 'my-pane',                 // unique
  label: 'My pane',
  icon: '✨',
  surface: 'S?',                  // which PRD-006 surface (optional)
  matches: [                      // any-of; empty = pane decides
    { '@type': 'http://example.org/MyType' }
  ],
  canHandle(subject, store) { … return true/false … },
  render(subject, store, container, rawData) { … },
};
```

The `html` and `render` helpers come from the upstream LOSOS
shell — same contract any linkedobjects/browser pane uses.

## Where panes can live

Three sources, in priority order:

1. **Operator-supplied** under `[linked_data.viewer].extra_panes`. Each
   entry is a URL or a path under `/workspace/profiles/<stack>/viewer/panes/`.
2. **Built-in** — this directory. Edits here ship in the next image.
3. **Upstream** — the linkedobjects/browser bundle's own `panes/` dir.

The pane manifest at `/lo/manifest.json` merges the three sources;
later sources override earlier ones by `id`.

## Attribution

The pane render shape and the `html`/`render` helpers are imported
from [linkedobjects/browser](https://github.com/linkedobjects/browser)
(Melvin Carvalho et al., AGPL-3.0). Vocabulary attribution per pane
is in the file headers and in
[`docs/reference/_vocab/agbx.md`](../../../../../docs/reference/_vocab/agbx.md).
