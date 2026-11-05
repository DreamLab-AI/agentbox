# SuperSplat event bus (3.6.0)

`window.scene.events` is the editor's internal `Events` bus (`src/events.ts`). Two
kinds of call:

- `ev.invoke(name, ...args)` runs a function registered with `events.function(name, …)`
  and returns its value.
- `ev.fire(name, ...args)` triggers handlers registered with `events.on(name, …)`;
  it returns nothing, so read state back afterwards.

This is not a published API. It is pinned to SuperSplat 3.6.0 (`8c28d721`); after a
version bump, re-list the names with
`grep -rhoE "events\.(function|on)\('[a-zA-Z.]+'" src | sort -u` in the new source.

## Verified live (2026-11-05, workshop splat, 1,042,802 splats, WebGPU on the A6000)

| Call | Kind | Result |
|---|---|---|
| `scene.splats` | invoke | array of loaded splats; each has `name`, `numSplats`, `numSelected`, `numDeleted` |
| `scene.dirty` | invoke | `false` after load, `true` after any edit |
| `camera.getPose` | invoke | `{ position, target, fov }` |
| `select.all` | fire | `numSelected` = `numSplats` |
| `select.delete` | fire | selected splats move to `numDeleted`; `numSplats` drops by the same |
| `edit.undo` | fire | the delete is reverted, selection restored |
| `select.none` | fire | `numSelected` = 0 |

Recipe, the same sequence that was run:

```js
async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const ev = window.scene.events;
  const s = ev.invoke('scene.splats')[0];
  const snap = step => ({ step, numSplats: s.numSplats, numSelected: s.numSelected, numDeleted: s.numDeleted });
  const out = [snap('loaded')];
  ev.fire('select.all');    await sleep(500); out.push(snap('select.all'));
  ev.fire('select.delete'); await sleep(800); out.push(snap('select.delete'));
  ev.fire('edit.undo');     await sleep(800); out.push(snap('edit.undo'));
  ev.fire('select.none');   await sleep(500); out.push(snap('select.none'));
  return out;
}
```

The `await sleep()` matters: edits apply on the next frames, so read counters after
a short wait, not in the same tick.

## Present in 3.6.0 source, not exercised here

Read the handler in `src/` for its argument shape before using one of these, and
check its effect through `scene.splats` counters or a screenshot.

- Selection: `select.invert`, `select.hide`, `select.unhide`, `select.byBox`,
  `select.bySphere`, `select.rect`, `select.point`, `select.colorMatch`, `select.byMask`
- Editing: `edit.redo`, `edit.duplicate`, `edit.separate`, `edit.applyColor`, `edit.resetColor`
- Camera: `camera.setPose`, `camera.focus`, `camera.reset`, `camera.setFov`, `camera.align`
- Output: `render.image`, `render.video`, `scene.write`, `scene.export`, `doc.save`

Output calls write through the browser: the file lands in the browser sidecar's
download directory, not in this container. For files you need back here, reproduce
the edit with `splat-transform` (see SKILL.md).
