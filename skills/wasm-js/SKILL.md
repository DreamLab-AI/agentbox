# WASM-JS Interop Skill

High-performance WebAssembly graphics with JavaScript interoperability for web applications.

## Overview

This skill provides patterns and templates for creating performant WASM graphics modules that integrate seamlessly with JavaScript/TypeScript web applications. Derived from the DreamLab AI Voronoi hero project.

## When to Use This Skill

- **Performance-critical graphics** requiring computational geometry
- **Real-time animations** with complex mathematical operations
- **Canvas/WebGL rendering** with WASM computation backend
- **Hybrid JS/WASM** architectures where JS handles DOM, WASM handles math

## Architecture Pattern

```
┌─────────────────────────────────────────────────────┐
│                 React/JS Application                 │
│  - DOM manipulation, event handling                  │
│  - requestAnimationFrame loop                        │
│  - Canvas context management                         │
└──────────────────────┬──────────────────────────────┘
                       │ wasm-bindgen bridge
                       ▼
┌─────────────────────────────────────────────────────┐
│                 Rust WASM Module                     │
│  - Computational geometry (Delaunay, Voronoi)        │
│  - Noise generation (Simplex, Perlin)                │
│  - Particle/mote physics                             │
│  - Returns Float32Array for JS rendering             │
└─────────────────────────────────────────────────────┘
```

## Key Lessons Learned

### 1. WASM Boundary Optimization
- Minimize cross-boundary calls (batch operations)
- Return typed arrays (Float32Array) instead of objects
- Let JS handle DOM/Canvas, WASM handles computation

### 2. Memory Management
- Use `wasm-bindgen` with `#[wasm_bindgen]` attributes
- Typed arrays share memory without copying
- Clean up resources with explicit deallocation

### 3. Build Configuration
```toml
# Cargo.toml
[lib]
crate-type = ["cdylib"]

[dependencies]
wasm-bindgen = "0.2"
js-sys = "0.3"
getrandom = { version = "0.2", features = ["js"] }

[profile.release]
opt-level = "z"
lto = true
```

### 4. Integration Pattern
```typescript
// Lazy-load WASM module
const wasmModule = await import('./pkg/my_wasm_module');

// Call WASM computation
const positions = wasmModule.compute_voronoi(width, height, seedCount);

// Render in JS (Canvas2D or WebGL)
ctx.beginPath();
for (let i = 0; i < positions.length; i += 4) {
  ctx.moveTo(positions[i], positions[i+1]);
  ctx.lineTo(positions[i+2], positions[i+3]);
}
ctx.stroke();
```

## Project Templates

### Voronoi/Delaunay Graphics
- Golden ratio seed placement (Vogel's model)
- Bowyer-Watson Delaunay triangulation
- Simplex noise for organic animation
- Bronze/gold color palette

### Particle Systems
- Light motes traveling along edges
- Physics simulation in WASM
- Rendering batched to JS

## Build Commands

```bash
# Install wasm-pack
cargo install wasm-pack

# Build for web target
wasm-pack build --target web --release

# Output in pkg/ directory:
# - my_module.js (ES module wrapper)
# - my_module_bg.wasm (binary)
# - my_module.d.ts (TypeScript definitions)
```

## Performance Targets

| Metric | Target | Achieved |
|--------|--------|----------|
| WASM binary size | <100KB | 72KB |
| Frame time | <16ms (60fps) | ~8ms |
| Memory overhead | <10MB | ~4MB |
| Cross-boundary calls | <100/frame | ~20/frame |

## Toolchain Requirements

**Already installed in Turbo Flow container:**
- `rustup` with stable toolchain
- `wasm32-unknown-unknown` target
- `rustfmt`, `clippy`, `rust-analyzer`

**Install wasm-pack on first use:**
```bash
cargo install wasm-pack
```

## Files in This Skill

- `SKILL.md` - This documentation
- `templates/voronoi-graphics/` - Voronoi/Delaunay template with React integration
  - `Cargo.toml` - Rust project configuration
  - `src/lib.rs` - WASM module implementation
  - `integration.tsx` - React component example
  - `build.sh` - Build script

## Related Skills

- `rust-development` - Rust toolchain and patterns
- `performance-analysis` - Profiling and optimization
- `playwright` - Visual testing of graphics output

## References

- [wasm-bindgen Guide](https://rustwasm.github.io/wasm-bindgen/)
- [Rust and WebAssembly Book](https://rustwasm.github.io/docs/book/)
- [Delaunay Triangulation Algorithm](https://en.wikipedia.org/wiki/Bowyer%E2%80%93Watson_algorithm)
- [Golden Angle (Vogel's Model)](https://en.wikipedia.org/wiki/Golden_angle)
