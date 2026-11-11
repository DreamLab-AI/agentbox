---
name: wasm-js
description: "Builds performance-critical web graphics in WebAssembly with JavaScript interop: WASM does the maths (computational geometry, real-time animation) while JS owns the DOM, Canvas or WebGL. Use for hybrid JS/WASM rendering where JavaScript alone is too slow. Not for general Rust or non-graphical WASM (rust-development), Leptos web apps (leptos) or server-side GPU compute (cuda)."
---

# WASM-JS Interop Skill

High-performance WebAssembly graphics with JavaScript interoperability for web applications.

## When to Use This Skill

- **Performance-critical graphics** requiring computational geometry
- **Real-time animations** with complex mathematical operations
- **Canvas/WebGL rendering** with WASM computation backend
- **Hybrid JS/WASM** architectures where JS handles DOM, WASM handles math

## When Not To Use

- For general Rust development without WebAssembly graphics -- use the rust-development skill instead
- For server-side CUDA GPU compute -- use the cuda skill instead
- For non-graphical WASM modules (data processing, crypto) -- the rust-development skill with wasm32 target is sufficient
- For browser automation and testing -- use the browser skill instead
- For UI component design guidance (styles, palettes, typography, layout) -- use the ui-ux-pro-max-skill skill instead; for auditing/polishing an existing interface -- use the design-audit skill

## Architecture Pattern

```
+-----------------------------------------------------+
|                 React/JS Application                 |
|  - DOM manipulation, event handling                  |
|  - requestAnimationFrame loop                        |
|  - Canvas context management                         |
+---------------------------+--------------------------+
                            | wasm-bindgen bridge
                            v
+-----------------------------------------------------+
|                 Rust WASM Module                     |
|  - Computational geometry (Delaunay, Voronoi)        |
|  - Noise generation (Simplex, Perlin)                |
|  - Particle/mote physics                             |
|  - Returns Float32Array for JS rendering             |
+-----------------------------------------------------+
```

## Key Patterns

### WASM Boundary Optimisation
- Minimize cross-boundary calls (batch operations)
- Return typed arrays (Float32Array) instead of objects
- Let JS handle DOM/Canvas, WASM handles computation

### Memory Management
- Use `wasm-bindgen` with `#[wasm_bindgen]` attributes
- Typed arrays share memory without copying
- Clean up resources with explicit deallocation

### Build Configuration
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

### Integration Pattern
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

## Build Commands

```bash
# wasm-pack is baked into the image (command -v wasm-pack)

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

## Project Templates

- `templates/voronoi-graphics/` - Golden ratio seed placement, Bowyer-Watson Delaunay triangulation, Simplex noise animation

## Related Skills

- `rust-development` - Rust toolchain and patterns
- `performance-analysis` - Profiling and optimisation
- `browser` - Visual testing of graphics output
- `leptos` - Full-stack reactive Rust web framework; reach for it instead of this skill when the WASM/JS work is happening inside a Leptos component tree rather than a standalone hand-wired WASM module

## References

- [wasm-bindgen Guide](https://rustwasm.github.io/wasm-bindgen/)
- [Rust and WebAssembly Book](https://rustwasm.github.io/docs/book/)
- [Delaunay Triangulation Algorithm](https://en.wikipedia.org/wiki/Bowyer%E2%80%93Watson_algorithm)
