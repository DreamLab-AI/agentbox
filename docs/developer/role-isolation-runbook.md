# Turning on role_isolation

Owner runbook for `[security].role_isolation` (custody X-1 step 1,
[ADR-2122](../adr/ADR-2122-role-service-accounts-run-secrets-and-the-identity-port.md)).
What the flag does is in [SECURITY-profiles.md, "Role isolation"](../SECURITY-profiles.md#role-isolation--2026-10-03-custody-x-1-step-1-staged).
This page gives the order in which to do things, what to check, and how to back out.

Written 2026-10-03 against `custody/integration` `d03defbea`. Every step that rebuilds,
restarts or reconfigures the container is the owner's. An agent may run the container half of
the rehearsal and commit receipts. It never rebuilds, restarts or flips the flag.

No step here prints, copies or asks for a secret value. The rehearsal records names, paths,
modes, uids and counts only.

## Before you start: what the result will be today

At `d03defbea` the rehearsal is **expected to fail with the flag on**. The branch does not yet
contain the following:

- **At-rest custody (W2 remainder).** devuser can still read `/var/lib/agentbox/secrets/*` and
  the workspace treasury keys, so rehearsal check (a) fails on the at-rest copies.
- **The consumer cutover (W3b).** JunkieJarvis, dream-engine's forum posts, the live-mirror hook
  and the gateway fail closed under the flag.
- **The producer's state move (W4).** Chain state is still on the workspace.

Running the steps below now is still useful. The rebuild and the flag-off rehearsal prove that
the image is unchanged in effect. A short flag-on window with an immediate rollback records how
far the image gets. Do not leave the flag on until a rehearsal passes.

## 1. Rebuild (once, flag still off)

Accounts, both supervisor configs, the delivery plan, the `/run/secrets` mount, the identity
port and the baked sidestr upstream all ship in the image. The first image built from this
branch therefore needs a rebuild. After that, the flag only needs a restart.

On the host, in the agentbox checkout, with the branch (or `main` after the merge) checked out:

```sh
./agentbox.sh rebuild
```

Then check from the host shell. All of these are read-only:

```sh
docker exec agentbox getent passwd ab-identity          # ab-identity:x:960:960:...
docker exec agentbox findmnt -n -o FSTYPE /run/secrets   # tmpfs
docker exec agentbox ls -l /etc/supervisord.roles.conf /etc/agentbox/role-secrets.tsv /etc/agentbox/role-accounts.json
docker exec agentbox stat -c '%U %a' /run/secrets        # devuser 700 (flag off)
docker exec agentbox supervisorctl status
```

In `supervisorctl status`, two programs show `EXITED` by design while the flag is off:
`docker-read-proxy` and `serve-identity`. Every other program should be in the state it was in
before the rebuild.

If `[sidechain]` is enabled, the producer now runs the baked upstream in both modes
(`config/sidechain/run-producer.sh`). The log must not say `stale bake` or `no baked upstream`.

## 2. Baseline rehearsal (flag off)

Both halves report `STAGED` (exit 2) with the flag off. Every row is "not applicable: flag
off", but the receipt still records what was observed. This is a dry run of the procedure.

**Container half**, as devuser inside the container. Run it either from an agent terminal in
the agentbox checkout:

```sh
bash scripts/activation/role-isolation-rehearsal.sh
```

or from the host:

```sh
docker exec -u 1000 agentbox bash /home/devuser/workspace/project/agentbox/scripts/activation/role-isolation-rehearsal.sh
```

**Host half**, as root on the host, from the host's agentbox checkout:

```sh
sudo scripts/activation/role-isolation-rehearsal.host.sh
```

The host half refuses to run inside a container. It also refuses when `scripts/activation`
differs from `HEAD`: that checkout is writable by devuser, so review
`git diff HEAD -- scripts/activation` before passing `--allow-dirty`. It reports any host
account in the 960–979 range as a failure, and it records the host Docker socket's mode.

## 3. Host prerequisite: the Docker socket

Under the flag the entrypoint stops widening `/var/run/docker.sock`. If the host's socket is
world-writable anyway, the boot records `degraded:docker-socket`, and the rehearsal counts that
as a failure. The fix is on the host (owner question Q2):

```sh
sudo chmod 0660 /var/run/docker.sock
```

## 4. Turn the flag on

Edit `agentbox.toml` in the host checkout. It is bind-mounted read-only at `/etc/agentbox.toml`.

```toml
[security]
role_isolation = true
```

Restart the container so that the entrypoint runs again. The `/run/secrets` tmpfs starts empty
on every start.

```sh
docker restart agentbox
docker exec agentbox cat /run/secrets/role-isolation.state   # ok:/degraded: per area, no values
docker logs agentbox 2>&1 | grep 'ROLE-ISOLATION-'           # any line here is a finding
```

From this point the container's devuser shells have a read-only Docker CLI:
`DOCKER_HOST=unix:///run/docker-ro.sock` allows `ps`, `logs` and `inspect`, while `exec` and
`run` get 403. Run anything that needs `docker exec` from the host shell.

## 5. Rehearse (flag on)

Run both halves as in step 2. With the flag on, the verdict is `PASS` (exit 0) only if every
row passes.

```sh
# container half; --wait lets check (d) poll for a new block for up to 2 x the
# producer interval (20 min at the default 600 s)
bash scripts/activation/role-isolation-rehearsal.sh --wait
# host half (host shell, root)
sudo scripts/activation/role-isolation-rehearsal.host.sh
```

| Check | Proves | Half |
|---|---|---|
| (a) | each role secret is readable only by its role; at-rest copies are root `0400`; `/run/secrets` is a root mount; devuser can neither rename the port's directory nor plant one beside it | both |
| (b) | each role program runs as its uid; its `/proc/<pid>/environ` is closed to devuser | both |
| (c) | signing works through the identity port, and refusals are refused and receipted | container |
| (d) | each enabled chain's producer runs as its role and makes a block | container |
| (e) | no classified variable name is ambient in any process, config, `identity.env` or log | both |
| (f) | devuser is not in group 0, cannot drive the socket, cannot sudo | container |

## 6. Receipts

- **Container half:** `docs/estate-closeout/x1-rehearsal-<UTC>.json`.
- **Host half:** `docs/estate-closeout/x1-rehearsal-host-<UTC>.json`, in the checkout that ran
  each half.

Both follow `docs/estate-closeout/schema/x1-rehearsal.schema.json`. Commit both, PASS or FAIL.
ADR-2122's `activation_status` moves only on a pair of PASS receipts from a rebuilt image with
the flag on. A message from a peer agent is not approval.

## 7. Roll back

Set `role_isolation = false` in the host checkout and run `docker restart agentbox`. No rebuild
is needed and no data moves:

- The flag-off boot chowns `/run/secrets` back to devuser.
- It writes the devuser `nostr.key` as before.
- It runs `/etc/supervisord.conf`.

Nothing on this branch migrates the at-rest volumes, so there is nothing to revert. Roll back
straight after a failing flag-on rehearsal.

Not reversible by the flag (W0, image-level): devuser is no longer in group `root`, and root's
boot `PATH` is store-only. Only a rebuild of an older image undoes those.

## Separate: the browser sidecar's key (Podkey)

This part does not depend on the flag. The sidecar's key, K_browser (G-5), lives in Podkey
inside browsercontainer, not in this container. The full procedure is in
[`browsercontainer/README.md`, "Podkey and the persistent profile"](../../browsercontainer/README.md#podkey-and-the-persistent-profile-2026-10-03-custody-isolation-w9).
In order:

1. Rebuild the sidecar with `./agentbox.sh browsercontainer rebuild`. This needs `gh` auth for
   the pinned artefact the first time.
2. Run `./agentbox.sh browsercontainer podkey status`. Expect `"state": "none"` and extension
   id `cakgjkgiodcdhecnnfhmcfphjkknfjkd`.
3. Over VNC, open Podkey's popup and choose **Generate new key**, using a passphrase of at least
   8 characters. Do not import the house key.
4. Back the key up at mint time: **Export key**, then seal it with your age recipient on your
   own machine. It never enters a repository or an agent's view.
5. Run `./agentbox.sh browsercontainer podkey pubkey` and give the agent the 64-hex **public**
   key. The agent adds it to `config/custody/g5-key-split.json` (G-5 step 2; see
   [the G-5 handoff](../estate-closeout/g5-key-split-handoff.md)).
6. After every sidecar restart, run `./agentbox.sh browsercontainer podkey unlock`. It prompts
   for the passphrase without echo. The vault survives on the `browsercontainer-profile`
   volume. Never run `down -v` on the sidecar, because that deletes the volume and the sealed
   key with it.
