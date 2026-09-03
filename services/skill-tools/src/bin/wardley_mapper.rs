//! `wardley-mapper` — port of `wardley_mapper.py`'s `main()`: the MCP-style
//! stdin/stdout JSON-line loop. Reads one `{"method": ..., "params": {...}}` request
//! per line, dispatches to `create_map` / `analyze_map` / `parse_text` /
//! `create_interactive_map`, and writes one `{"result": ...}` (or `{"error": ...}`)
//! JSON response per line to stdout, flushing after each — see
//! `skill_tools::wardley::mapper` for the per-method response shapes.

fn main() {
    skill_tools::wardley::mapper::run_stdio_loop();
}
