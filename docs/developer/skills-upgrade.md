# Skills corpus upgrade path

## Context in one paragraph

The "skills corpus" is the tree of ~96 skill packages (one agent playbook each — markdown brief + optional scripts + optional MCP server) that ship inside the image at `/opt/agentbox/skills`. Today the tree lives in-repo under `skills/` and is consumed by the flake (Nix's pure build descriptor, [ADR-001](../reference/adr/ADR-001-nixos-flakes.md)) as a `path:` input. The plan is to extract that tree into its own repository and switch the flake input to a `github:` pin so the corpus versions independently of the runtime. This file describes the current state, the target state, and the one-line migration that connects them. Driver: keeping the core agentbox repo focused on runtime concerns while allowing a larger team to iterate on the skills catalogue; constraint: the migration must be a zero-risk cutover because the skills tree is on every built image.

## Current state (path input)

`skills/` is committed in this repo and exposed to Nix as a `path`-type flake input:

```nix
# flake.nix inputs block
skills = {
  url   = "path:./skills";
  flake = false;
};
```

The `outputs` function receives `skills` and binds it to `skillsTree`, which is then
copied into the image at `/opt/agentbox/skills`:

```nix
skillsTree = skills;
# ...
cp -r ${skillsTree} $out/opt/agentbox/skills
```

This is operationally identical to the previous `cp -r ${./skills} …` but threads the
corpus through the flake input machinery, establishing the seam for a remote extract.

A **flake input** is Nix's mechanism for referencing another source tree (local path, Git ref, tarball, GitHub repo). Inputs are content-addressed: the `flake.lock` file pins each input to a specific narHash (the hash of the unpacked tree) so two builds of the same lock file are byte-identical. Threading `skills` through an input rather than inlining `./skills` buys us that lockfile-backed pinning for free once the source moves off disk.

### Why not: publish skills to npm or a tarball registry?

A npm package or a plain HTTP tarball are both simpler delivery mechanisms. They were rejected because Nix flakes already solve the pinning and fetching problem with integrity hashes in `flake.lock`, and because the skill packages routinely need large non-code assets (sample workflows, fixture media) that bloat npm packages. Staying inside the Nix input model keeps the rebuild semantics consistent: change the skills pin → lock updates → next build picks it up deterministically.

## Future state (remote extract — Path A, deferred)

> Prerequisite: create `github.com/DreamLab-AI/agentbox-skills` and push the current
> `skills/` tree as its initial commit.

Once that repo exists, the migration is a single two-line edit in `flake.nix`:

```nix
# Before (path input)
skills = {
  url   = "path:./skills";
  flake = false;
};

# After (remote pin)
skills = {
  url   = "github:DreamLab-AI/agentbox-skills/main";
  flake = false;
};
```

Then regenerate the lock file:

```bash
nix flake lock --update-input skills
```

`flake.lock` will record the exact commit SHA. No other file changes are needed.

## Upgrading the pinned skills commit

Once on the remote input, upgrading is:

```bash
nix flake lock --update-input skills
git add flake.lock
git commit -m "chore: update skills corpus to <sha>"
```

## Migration steps (full extract)

1. Create `DreamLab-AI/agentbox-skills` on GitHub (public repo, no CI required initially).
2. Push the current `skills/` tree:
   ```bash
   cd /tmp && cp -r /path/to/agentbox/skills agentbox-skills
   cd agentbox-skills && git init && git add -A
   git commit -m "feat: initial skills corpus from agentbox monorepo"
   git remote add origin git@github.com:DreamLab-AI/agentbox-skills.git
   git push -u origin main
   ```
3. Update `flake.nix` inputs as shown above.
4. Run `nix flake lock --update-input skills`.
5. Delete `skills/` from this repo and remove it from `.gitignore` exclusions if applicable.
6. Open a PR; CI (`tests/flake/skills-input.sh`) validates the input is still present.

## Why path input now?

The seam is in place so that switching to the remote is a one-line change with zero
risk to the build. The full extract (removing `skills/` from this repo) is deferred
until `DreamLab-AI/agentbox-skills` is created and the team is ready to manage a
second repo. See `CHANGELOG.md` D.9 entry for context.

## Related specs

- [ADR-001](../reference/adr/ADR-001-nixos-flakes.md) — why the build graph uses Nix flakes, and what a flake input is in our terms.
- [ADR-004](../reference/adr/ADR-004-upstream-sync.md) — upstream sync boundaries; the skills repo would be governed by this policy once extracted.
- [version-tracking.md](version-tracking.md) — once `skills` is a remote input, its pin flows through the standard `nix flake update` Monday workflow alongside `nixpkgs` and the others.
