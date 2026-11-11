#!/usr/bin/env python3
"""nar-hash.py - compute Nix SRI sha256 hashes without a Nix evaluator.

Usage:
    scripts/nar-hash.py <https-tarball-url | local.tar.gz | directory> [--keep-git]

Prints ``sha256-<base64>``, the value for a ``fetchFromGitHub`` ``hash`` or a
``cargoLock.outputHashes`` entry. A tarball is unpacked and its single
top-level directory stripped (what fetchFromGitHub hashes); a directory is
hashed as is. ``.git`` is excluded unless --keep-git is given.

    # fetchFromGitHub hash
    scripts/nar-hash.py https://codeload.github.com/<owner>/<repo>/tar.gz/<rev>
    # cargoLock git dependency (fetchgit checkout, .git removed)
    scripts/nar-hash.py https://codeload.github.com/<owner>/<repo>/tar.gz/<full rev>

Caveats: codeload applies `export-ignore` and `export-subst` from
.gitattributes, which a git checkout does not; check the repo has none before
trusting a codeload hash for a git dependency. Submodules are not fetched.

The NAR format (nix-archive-1): every string is length-prefixed (8-byte
little-endian) and zero-padded to a multiple of 8. Directory entries are sorted
by name bytes; regular files carry an "executable" marker when any exec bit is
set; symlinks carry their target. Validate after any change with a known hash.
"""
import base64
import hashlib
import io
import os
import stat
import struct
import sys
import tarfile
import tempfile
import urllib.request


def _s(h, b):
    if isinstance(b, str):
        b = b.encode()
    h.update(struct.pack("<Q", len(b)))
    h.update(b)
    h.update(b"\0" * (-len(b) % 8))


def _dump(h, path, skip_git):
    path = os.fsencode(path)
    st = os.lstat(path)
    _s(h, "(")
    if stat.S_ISLNK(st.st_mode):
        _s(h, "type"); _s(h, "symlink")
        _s(h, "target"); _s(h, os.readlink(path))
    elif stat.S_ISDIR(st.st_mode):
        _s(h, "type"); _s(h, "directory")
        names = sorted(n for n in os.listdir(path)
                       if not (skip_git and n == b".git"))
        for n in names:
            _s(h, "entry"); _s(h, "(")
            _s(h, "name"); _s(h, n)
            _s(h, "node")
            _dump(h, os.path.join(os.fsencode(path), n), skip_git)
            _s(h, ")")
    else:
        _s(h, "type"); _s(h, "regular")
        if st.st_mode & 0o111:
            _s(h, "executable"); _s(h, "")
        _s(h, "contents")
        h.update(struct.pack("<Q", st.st_size))
        with open(path, "rb") as f:
            while chunk := f.read(1 << 20):
                h.update(chunk)
        h.update(b"\0" * (-st.st_size % 8))
    _s(h, ")")


def nar_sri(path, skip_git=True):
    h = hashlib.sha256()
    _s(h, "nix-archive-1")
    _dump(h, path, skip_git)
    return "sha256-" + base64.b64encode(h.digest()).decode()


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if len(args) != 1:
        sys.exit(__doc__)
    keep_git = "--keep-git" in sys.argv
    src = args[0]
    if os.path.isdir(src):
        print(nar_sri(src, not keep_git))
        return
    if src.startswith("http"):
        data = urllib.request.urlopen(src).read()
    else:
        data = open(src, "rb").read()
    with tempfile.TemporaryDirectory() as d:
        with tarfile.open(fileobj=io.BytesIO(data)) as t:
            t.extractall(d, filter="tar")
        entries = [e for e in os.listdir(d) if e != "pax_global_header"]
        if len(entries) != 1:
            sys.exit("expected one top-level directory, got %r" % entries)
        print(nar_sri(os.path.join(d, entries[0]), not keep_git))


if __name__ == "__main__":
    main()
