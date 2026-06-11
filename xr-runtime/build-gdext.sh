#!/bin/bash
# Compile the visionclaw-xr-gdext GDExtension cdylib for desktop Linux x86_64.
# The crate at xr-client/rust is its own isolated cargo workspace (it pulls the
# heavy godot-rust bindings), so a plain `cargo build --release` from there
# produces target/release/libvisionclaw_xr_gdext.so — the path the
# .gdextension descriptor declares for linux.release.x86_64.
set -euo pipefail

export HOME="${HOME:-/home/devuser}"
export CARGO_HOME="${CARGO_HOME:-$HOME/.cargo}"
# godot-rust → bindgen → libclang. Pin so bindgen never guesses the wrong libpath.
export LIBCLANG_PATH="${LIBCLANG_PATH:-/usr/lib}"

RUST_DIR=/workspace/xr-client/rust
SO="$RUST_DIR/target/release/libvisionclaw_xr_gdext.so"

if [[ ! -d "$RUST_DIR" ]]; then
    echo "[gdext] FATAL: $RUST_DIR not mounted — is the XR project bound in?" >&2
    exit 1
fi

cd "$RUST_DIR"
echo "[gdext] cargo build --release  (cwd=$RUST_DIR, CARGO_HOME=$CARGO_HOME)"
cargo build --release

if [[ -f "$SO" ]]; then
    echo "[gdext] OK: $(ls -la "$SO")"
else
    echo "[gdext] FATAL: build finished but $SO is absent" >&2
    exit 1
fi

# Godot's desktop runtime is a *debug* build, so its GDExtension loader resolves
# the `linux.debug.x86_64` entry in visionclaw_xr_gdext.gdextension first — it
# looks for target/debug/…so, which a --release build never produces. With no
# file there the extension fails to load and NONE of the gdext classes
# (BinaryProtocolClient, PresenceClientNode, XrInteraction, …) register, so
# GraphScene's presence/binary-protocol networking is silently dead. Point the
# debug path at the release artifact so the same optimised cdylib serves both.
# target/ is the xr-gdext-target named volume, so this stays sidecar-local and
# never touches the host project tree.
DEBUG_SO="$RUST_DIR/target/debug/libvisionclaw_xr_gdext.so"
mkdir -p "$(dirname "$DEBUG_SO")"
ln -sfn "$SO" "$DEBUG_SO"
echo "[gdext] linked debug path → release cdylib: $DEBUG_SO"
