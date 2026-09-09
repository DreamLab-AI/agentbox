---
name: rust-development
description: "Complete Rust toolchain with cargo, rustfmt, clippy, and WASM support. Use when writing Rust code, running cargo build/test/clippy, compiling to WASM, or debugging Rust compilation errors."
---

# Rust Development Skill

Full Rust development environment with stable toolchain, formatters, linters, and WebAssembly compilation.

## Capabilities

- Cargo project management (build, run, test)
- Code formatting with rustfmt
- Linting and suggestions with clippy
- LSP support with rust-analyzer
- WebAssembly compilation (wasm32-unknown-unknown)
- Dependency management via Cargo.toml
- Benchmark and documentation generation
- Cross-compilation support

## When to Use

- Systems programming
- Performance-critical applications
- WebAssembly modules
- CLI tools development
- Network services
- Embedded programming

## When Not To Use

- For WASM graphics with JS interop specifically -- use the wasm-js skill which covers the full WASM+JS architecture
- For CUDA GPU kernel development -- use the cuda skill instead
- For Python-based ML model training -- use the pytorch-ml skill instead
- For general TypeScript/JavaScript development -- standard Claude Code editing suffices
- For Rust WASM build targets already handled by wasm-js -- avoid duplicating configuration

## Commands

### Project Management
```bash
cargo new project-name           # Create new project
cargo init                        # Initialize in existing dir
cargo build                       # Build project
cargo build --release            # Optimized build
cargo run                        # Build and run
cargo test                       # Run tests
cargo bench                      # Run benchmarks
cargo doc --open                 # Generate and open docs
```

### Quality Tools
```bash
cargo fmt                        # Format code
cargo clippy                     # Lint with suggestions
cargo clippy -- -W clippy::all  # All warnings
cargo check                      # Fast compilation check
```

### WebAssembly
```bash
cargo build --target wasm32-unknown-unknown --release
wasm-bindgen target/wasm32-unknown-unknown/release/project.wasm --out-dir pkg
```

### Dependencies
```bash
cargo add serde                  # Add dependency
cargo update                     # Update dependencies
cargo tree                       # Show dependency tree
```

## Project Structure

```
project/
├── Cargo.toml          # Dependencies and metadata
├── Cargo.lock          # Locked versions
├── src/
│   ├── main.rs         # Binary entry point
│   └── lib.rs          # Library root
├── tests/              # Integration tests
├── benches/            # Benchmarks
└── examples/           # Example code
```

## Cargo.toml Example

```toml
[package]
name = "myproject"
version = "0.1.0"
edition = "2021"

[dependencies]
serde = { version = "1.0", features = ["derive"] }
tokio = { version = "1", features = ["full"] }

[dev-dependencies]
criterion = "0.5"

[profile.release]
opt-level = 3
lto = true
```

## Common Patterns

### Error Handling
```rust
use std::error::Error;

fn main() -> Result<(), Box<dyn Error>> {
    let result = risky_operation()?;
    Ok(())
}
```

### Async/Await
```rust
#[tokio::main]
async fn main() {
    let result = async_function().await;
}
```

### Traits
```rust
trait Drawable {
    fn draw(&self);
}

impl Drawable for Circle {
    fn draw(&self) {
        println!("Drawing circle");
    }
}
```

## Environment

- **Toolchain**: stable (default)
- **Components**: rustfmt, clippy, rust-analyzer
- **Targets**: wasm32-unknown-unknown
- **Path**: ~/.cargo/bin added to PATH

## House rules

- **Pinned toolchain**: this image bakes its Rust toolchain via rust-overlay
  (`flake.nix`) — stable plus a nightly toolchain for `llvm-tools`. The
  `wasm32-unknown-unknown` target is already baked into that toolchain; don't run
  `rustup target add wasm32-unknown-unknown`, it's redundant and can drift from the
  pinned set.
- **Never hand-roll cryptography.** Use the most trusted RustCrypto-ecosystem
  crates — `aes-gcm`, `chacha20poly1305`, `sha2`, `hmac`, `pbkdf2`, `argon2`,
  `k256`/`secp256k1`, `ring`/`rustls`, `ed25519-dalek` — pinned and verified against
  published test vectors. If existing code hand-rolls a primitive, replacing it is
  the highest-priority change.
- **Clean-room reusable modules go to crates.io.** A published crate ships full
  inline rustdoc (crate-level `//!` plus every public item documented, with examples
  that compile), a README, licence and repository metadata, and passes
  `cargo doc --no-deps` without warnings. Never publish a bespoke crypto envelope or
  token format as a reusable crate — keep project-specific constructions private and
  point new work at established formats (age, JWE/COSE via maintained crates)
  instead.

## Related Skills

- `cuda` — safe CUDA bindings in Rust, GPU kernel development
- `leptos` — full-stack Rust web apps (fine-grained reactive framework, SSR/hydration)
- `wasm-js` — WASM+JS interop architecture when JS-side bindings/graphics are involved

## Notes

- Compile times can be significant for large projects
- Use `cargo check` for fast iteration
- `cargo clippy` provides excellent suggestions
- WASM builds require wasm-bindgen for JS interop
