# Skills corpus upgrade path

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
