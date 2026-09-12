# SystemScape: system telemetry and agent activity

Agentbox packages [DreamLab-AI/systemscape](https://github.com/DreamLab-AI/systemscape),
previously named `thermal3d`. The binary remains `systemscape`. It uses
`gemini-engine 1.2.1`, the current published renderer version checked on 12 September
2026; it is not a Ratatui graphics pipeline. The System window also runs `bottom`
for detailed process telemetry.

The new Activity window is normally index 10. It runs `systemscape --activity`,
a continuous 3D tour inspired by [bough](https://github.com/nickelsec/bough).
Time runs along textured paths on a procedural ASCII island. Agents occupy
districts, and coloured beacons represent
prompts, tool calls, failures and recorded commit receipts. The camera flies a relaxed 52-second circuit through the full-screen landscape, six times
wider and deeper than the original, at an altitude of 30–46 world units with a moderately downward camera angle.
Both telemetry and activity use muted pastel terrain, vivid warm data colours and black descriptive panels.
Record selection advances every four seconds. The tour traverses the retained
record pages, lane pages and UTC days.

Use arrows to rotate and tilt, `+`/`-` to zoom, `j`/`k` to select, `[`/`]` for
days, Tab for lane pages and Page Up/Down for record pages. Navigation pauses
the tour; Space resumes it. Enter shows the source path, `f` switches to a flat
view, and `q` exits. Small panes use the flat view automatically.

Activity reads local Claude and Codex histories, profile histories under
`$WORKSPACE/profiles`, and the shared event archive at
`$WORKSPACE/.agentbox/agent-events`. `AGENTBOX_EVENT_ARCHIVE_DIR` overrides the
archive path. Other agents appear when they publish to that archive. Missing
instrumentation is not treated as inactivity, and overlapping sources are not
added together as task-completion or billing totals.

The tour targets 18 frames per second, with panes up to 512×180 cells.
Press `?` for details and coverage or `h` for the district sidebar; both are
hidden by default to give the terrain more space. Paused views redraw only on change.
Collection is bounded to 8 MiB per two-second poll, 1 MiB per file, 256 files
and 5,000 retained records. Coverage shows pending files, omissions and limits.
This feature makes no model calls and needs no additional service or database.

## Rebuild

SystemScape 0.2 is a rebuild-class package update. On the build host:

```sh
nix build .#systemscape
./result/bin/systemscape --activity --demo
./agentbox.sh rebuild
```

The Nix derivation pins the upstream commit, source NAR hash and a checked-in
copy of its Cargo.lock. No `latest` download or runtime compilation is used.
The lock copy must match upstream whenever the source pin changes.

The tmux launcher adds Activity to an existing session without restarting agents.
It preserves a user window at index 10 and chooses another free index in that
case. Repeated launches leave an existing Activity window alone. If the binary
is absent or too old, the pane explains that a rebuild is needed. After an image
upgrade, a previously restored notice pane can be restarted with:

```sh
tmux respawn-pane -k -t agentbox:Activity 'systemscape --activity'
```

The Rust tests, strict Clippy checks, terminal captures and launcher regression
tests run inside the development container. Nix itself is not installed here,
so actual Nix package and image builds must run on the host.
