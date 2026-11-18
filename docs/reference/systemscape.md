# SystemScape: system telemetry and agent activity

Agentbox packages [DreamLab-AI/systemscape](https://github.com/DreamLab-AI/systemscape),
previously named `thermal3d`. The binary remains `systemscape`. It renders with
`gemini-engine 1.2.1` onto a supersampled half-block canvas: each terminal cell
shows two square pixels through `▀` with separate foreground and background
colours. It is not a Ratatui graphics pipeline. SystemScape 0.3 makes no model
calls and needs no extra service or database.

## System window (index 5): telemetry ridges

The System window runs `systemscape` beside `bottom`, which handles process
detail. It starts zoomed on SystemScape; tmux prefix then `z` shows `bottom`.

Each channel is a 3D ridge in its own colour, with its name and live value
at the "now" end:

- CPU temperature, then one ridge per GPU for temperature, utilisation and VRAM.
- Disk temperature, whole-system power, CPU load and memory.
- Disk IO and network traffic, on a log scale so everyday traffic shows.

Time always runs left to right, from `-2h` to `now`. The camera sways but never
orbits. Each of the 48 slots keeps the peak of its 150 s, so short spikes
survive. Panes under 80×20, or `f`, show one coloured sparkline per channel
instead. Space holds the flight, the arrow keys steer, `+`/`-` zoom and `0`
resets the camera.

## Activity window (normally index 10): the city

The Activity window runs `systemscape --activity`. Recorded work is drawn as
a city:

- **Districts** are projects. **Towers** are sessions. **Floors** are recorded
  actions, oldest at the ground, coloured by kind: shell, read, edit, web,
  memory, delegated agent, other tool, prompt, error or commit.
- A session with a record in the last five minutes is shown at full colour
  with a pulsing roof. Idle sessions are dimmed.
- The selected tower carries a callout, and a strip lists the five most recent
  sessions with what each last did.
- The tour follows live work, moving every six seconds to the next active
  session.
- Enter or `f` opens the detail view: every session of the day, then every
  record of the selected one. Panes under 80×20 always use it.

Tool records keep what the tool was given: a file path, the first line of a
command, or a query. Codex `exec` scripts are reduced to the tool called
inside them.

Keys: `j`/`k` select a session (a record in the detail view), Enter opens the
detail view or shows a record's source, `[`/`]` change day, `h` hides the
strip, `?` shows source coverage, Space follows or holds, `q` quits.

"Active" means a record arrived recently. It is evidence of logged activity,
not proof that an agent is running or that a task succeeded.

## Inputs

Activity reads local Claude and Codex histories, profile histories under
`$WORKSPACE/profiles`, and the shared event archive at
`$WORKSPACE/.agentbox/agent-events`. `AGENTBOX_EVENT_ARCHIVE_DIR` overrides the
archive path. Other agents appear when they publish to that archive. Missing
instrumentation is not treated as inactivity, and overlapping sources are not
added together as task-completion or billing totals.

Each transcript is read as an append-only log from a saved offset, so a poll
costs only the bytes written since the last one. Collection is bounded to
8 MiB per two-second poll, 1 MiB per file and 256 files. It keeps the newest
5,000 records and drops the oldest first. Commands are shown as recorded, so
use `--demo` when sharing the screen.

## Off-screen behaviour

Both views ask tmux every two seconds whether their window is the current
window of an attached session. Focus reports (`focus-events on` in
`config/tmux.conf`) make changes immediate.

- **Off screen,** the activity view neither polls nor draws, and catches up
  from its saved offsets when shown again. Telemetry stops drawing but keeps
  sampling `/proc` and hwmon every two seconds, querying `nvidia-smi` every ten
  seconds instead, so its two-hour history has no gaps.
- **On screen but unfocused,** a view holds its camera and redraws twice a
  second. This happens in the System window when `bottom` has focus, and is by
  design.

## Screenshots and upstream documentation

The [SystemScape README](https://github.com/DreamLab-AI/systemscape#readme)
shows real terminal captures of the activity city, the detail view, the
telemetry ridges and the sparkline view. Its
[capture guide](https://github.com/DreamLab-AI/systemscape/blob/main/docs/SCREENSHOTS.md)
explains how to regenerate them from synthetic fixtures.

## Other machines (SystemScape 0.4)

SystemScape 0.4 can show other machines in the System pane. Each runs
`systemscape --probe`, which the viewer reads over the container's OpenSSH
client. The list lives in the gitignored
[`config/systemscape/local/hosts.toml`](../../config/systemscape/README.md),
mounted read-only and linked to SystemScape's default path at boot
(ADR-2203). The pane command stays `systemscape`; Tab or `1`–`9` picks the
machine shown, and the strip on the top line marks each one live,
connecting, stale or failed with the reason.

Install the same SystemScape version on each remote machine and confirm
`ssh -o BatchMode=yes user@host true` works from a container shell before
adding it. A missing file leaves the pane exactly as before. The pinned
0.3.0 ignores the file; it takes effect once the pin moves to 0.4.0.

## Rebuild

SystemScape 0.3 is a rebuild-class package update. On the build host:

```sh
nix build .#systemscape
./result/bin/systemscape --activity --demo
./result/bin/systemscape --demo
./agentbox.sh rebuild
```

The Nix derivation pins the upstream commit, its source NAR hash and a
checked-in byte copy of its `Cargo.lock`. No `latest` download or runtime
compilation is used. The lock copy must match upstream whenever the source
pin changes.

The tmux launcher adds Activity to an existing session without restarting agents.
It preserves a user window at index 10 and chooses another free index in that
case. Repeated launches leave an existing Activity window alone. If the binary
is absent or too old, the pane explains that a rebuild is needed. After an image
upgrade, restart the Activity pane onto the new binary with:

```sh
tmux respawn-pane -k -t agentbox:Activity 'systemscape --activity'
```

In the System window, press `q` in the SystemScape pane. Its restart loop
starts the new binary two seconds later.

The Rust tests, strict Clippy checks, terminal smoke test and screenshot capture
run inside the development container. Nix itself is not installed there, so
actual Nix package and image builds must run on the host.

### Host verification — 2026-11-15

Agentbox PR #49 is merged. Official Nix prefetch reproduces the pinned source
hash `sha256-Dr1qiXF3ntAm/MI0RDptUiKZzGZ4pH392VmSyDIa3Bk=`, and the vendored
Cargo.lock is byte-identical to upstream `a123d8b0f09c681576c6e556b182537e9ea577ed`.
The standalone Nix build passes all 32 tests. The image prepared from Agentbox
`c254a24bfbfd3c7703193aaaa2e4cf0f8212d9fe` reports `systemscape 0.3.0` before
and after cutover. Executed Docker PTY probes render synthetic activity and
telemetry frames with RGB ANSI colours and Unicode half-block pixels; the
activity fixture does not open real histories. These are rendering smoke checks,
not a new claim about real-history coverage or every interactive control.
