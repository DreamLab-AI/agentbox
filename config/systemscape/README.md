# SystemScape hosts — source of truth (ADR-2203)

SystemScape's telemetry view can watch other machines beside this container:
each one runs `systemscape --probe` and the viewer reads it over SSH. This
directory holds the hosts file that lists them. It is mounted read-only at
`/etc/agentbox/systemscape` and never baked into the image.

| File | Tracked | Role |
|---|---|---|
| `hosts.example.toml` | yes | documented example with placeholders; copy it to start |
| `local/hosts.toml` | **no** (gitignored) | the operator's real machines, addresses and users |

At boot the entrypoint links `local/hosts.toml`, when it exists, to
`~/.config/systemscape/hosts.toml`, SystemScape's default path. The System
pane and any `systemscape` run in a shell then show those machines with no
flag. Remove the file and the next boot removes the link. A hosts file
written by hand at the default path is never replaced.

This repository is public: real addresses and user names go only in
`local/`. `tests/config/systemscape-hosts-layer.test.sh` checks that
`local/` stays ignored and that the tracked files carry no estate specifics.

## Set up a machine

1. On the remote machine, install the same SystemScape version as the image
   (`systemscape --version` in the container), for example
   `cargo install --locked --git https://github.com/DreamLab-AI/systemscape --root ~/.local`.
2. Make sure the container can reach it non-interactively:
   `ssh -o BatchMode=yes user@host true` from a container shell. Keys and
   `~/.ssh/config` come from the persisted `~/.ssh` mount; SSH never prompts.
3. `cp hosts.example.toml local/hosts.toml`, edit it, then check it without a
   reboot: `systemscape --hosts /etc/agentbox/systemscape/local/hosts.toml`.

The file takes effect at the next boot. There is no `agentbox.toml` gate: the
file existing is the switch. Field reference:
[SystemScape README, Other machines](https://github.com/DreamLab-AI/systemscape#other-machines).
