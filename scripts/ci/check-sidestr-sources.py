#!/usr/bin/env python3
"""Dependency source rule for check-crate-licensing.sh (ADR-2106 D3, ADR-2112 D3, W3-04).

Fails when any Cargo manifest or `.cargo/config.toml` under ROOT resolves a
dependency whose real package name starts with `sidestr-` or `sidestr_` to a
`path` or `git` source. The package name is the `package` field when present,
otherwise the dependency key, so renames, dotted keys, quoted keys and table
forms all resolve the same way because the files are parsed with tomllib rather
than matched by text.

Tables read: dependencies, dev-dependencies, build-dependencies (and the
underscore spellings cargo accepts), target.<cfg>.<those>, workspace.dependencies,
patch.<registry>.<name>, replace.<pkgid>. In a `.cargo/config.toml` the `patch`
tables and the `paths` array are read too. A `{ workspace = true }` entry has no
source of its own and is judged at the workspace definition. A file that does
not parse fails, because it cannot be shown clean.

Directories skipped: `.git`, `node_modules`, and a directory named `target`
that carries cargo's own `CACHEDIR.TAG` or `.rustc_info.json` (cargo writes one
of them into every target directory it creates, so that is real build output).
A `target` without either marker is scanned. `result*` is not pruned by name:
nix build outputs are symlinks into /nix/store and symlinks are never followed.

Output: one `V: <relative path>: <message>` line per violation and a final
`N: <count>` line, both on stdout. Exit 1 when there is any violation.
Usage: check-sidestr-sources.py ROOT
"""
import os
import sys

try:
    import tomllib
except ImportError:  # Python < 3.11
    print("V: python3 >= 3.11 (tomllib) is required to run this gate")
    print("N: 0")
    sys.exit(1)

DEP_TABLES = ("dependencies", "dev-dependencies", "build-dependencies",
              "dev_dependencies", "build_dependencies")
SKIP_DIRS = {".git", "node_modules"}
BUILD_MARKERS = ("CACHEDIR.TAG", ".rustc_info.json")


def is_sidestr(name):
    n = str(name).lower()
    return n.startswith("sidestr-") or n.startswith("sidestr_")


def pkgid_name(key):
    """Package name from a [replace] key: `name:ver`, `name@ver`, or a full
    `registry+url#name:ver` / `url#name@ver` id."""
    if "#" in key:
        key = key.rsplit("#", 1)[1]
    for sep in (":", "@"):
        key = key.split(sep, 1)[0]
    return key


def check_spec(key, spec, where, out, name=None):
    if not isinstance(spec, dict):
        return  # a bare version string is a registry dependency
    resolved = spec.get("package", name if name is not None else key)
    if not is_sidestr(resolved):
        return
    src = [k for k in ("path", "git") if k in spec]
    if src:
        out.append(f"{where}: dependency `{key}` resolves to package `{resolved}` with a {src[0]} source")


def check_table(tbl, where, out):
    if isinstance(tbl, dict):
        for key, spec in tbl.items():
            check_spec(key, spec, where, out)


def check_dep_group(group, where, out):
    for t in DEP_TABLES:
        check_table(group.get(t), f"{where} [{t}]", out)


def check_patch(patch, where, out):
    if isinstance(patch, dict):
        for registry, tbl in patch.items():
            check_table(tbl, f"{where} [patch.{registry}]", out)


def check_manifest(data, where, out):
    check_dep_group(data, where, out)
    ws = data.get("workspace")
    if isinstance(ws, dict):
        check_table(ws.get("dependencies"), f"{where} [workspace.dependencies]", out)
        check_dep_group(ws, where, out)
    tgt = data.get("target")
    if isinstance(tgt, dict):
        for cfg, group in tgt.items():
            if isinstance(group, dict):
                check_dep_group(group, f"{where} [target.{cfg}]", out)
    check_patch(data.get("patch"), where, out)
    rep = data.get("replace")
    if isinstance(rep, dict):
        for key, spec in rep.items():
            check_spec(key, spec, f"{where} [replace]", out, name=pkgid_name(key))


def package_name_at(directory):
    try:
        with open(os.path.join(directory, "Cargo.toml"), "rb") as fh:
            return tomllib.load(fh).get("package", {}).get("name")
    except (OSError, tomllib.TOMLDecodeError):
        return None


def check_config(data, where, base, out):
    check_patch(data.get("patch"), where, out)
    paths = data.get("paths")
    if isinstance(paths, list):
        for p in paths:
            if not isinstance(p, str):
                continue
            # config `paths` are relative to the directory that holds `.cargo/`.
            name = package_name_at(os.path.normpath(os.path.join(base, p)))
            if is_sidestr(name or "") or (name is None and "sidestr" in p.lower()):
                out.append(f"{where}: `paths` override names {p} (package {name or 'unresolved'})")


def is_build_output(directory):
    return os.path.basename(directory) == "target" and any(
        os.path.exists(os.path.join(directory, m)) for m in BUILD_MARKERS)


def main(root):
    out, scanned = [], 0
    for cur, dirs, files in os.walk(root):
        dirs[:] = sorted(d for d in dirs if d not in SKIP_DIRS
                         and not is_build_output(os.path.join(cur, d)))
        targets = []
        if "Cargo.toml" in files:
            targets.append(("manifest", "Cargo.toml"))
        if os.path.basename(cur) == ".cargo":
            targets += [("config", f) for f in ("config.toml", "config") if f in files]
        for kind, fname in targets:
            path = os.path.join(cur, fname)
            where = os.path.relpath(path, root)
            scanned += 1
            try:
                with open(path, "rb") as fh:
                    data = tomllib.load(fh)
            except (OSError, tomllib.TOMLDecodeError) as exc:
                out.append(f"{where}: cannot be parsed, so it cannot be shown free of sidestr path/git sources ({exc})")
                continue
            if kind == "manifest":
                check_manifest(data, where, out)
            else:
                check_config(data, where, os.path.dirname(cur), out)
    for line in out:
        print(f"V: {line}")
    print(f"N: {scanned}")
    return 1 if out else 0


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("usage: check-sidestr-sources.py ROOT", file=sys.stderr)
        sys.exit(2)
    sys.exit(main(sys.argv[1]))
