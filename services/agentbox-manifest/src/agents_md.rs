//! Embed a tier's canonical `AGENTS.md` into its `CLAUDE.md` (ADR-2111).
//!
//! Every instruction tier keeps one tool-neutral source, `AGENTS.md`, and a
//! `CLAUDE.md` holding only Claude-only notes. Inside a repository the
//! `CLAUDE.md` simply imports the source (`@AGENTS.md`). The workspace tier
//! cannot: `~/workspace` sits above every project root, so Claude Code treats
//! the import as an *external include* and silently skips it until the
//! operator approves external includes per project — which would also let any
//! trusted repository pull arbitrary files into context. Instead the source is
//! copied into a marked block of `CLAUDE.md` at boot. `AGENTS.md` stays the
//! only place anyone edits; the block is regenerated, never hand-edited.

use std::path::Path;

/// Opening marker of the generated block.
pub const BEGIN: &str = "<!-- agents-md:begin — generated from AGENTS.md at boot; edit AGENTS.md, not this block -->";
/// Closing marker of the generated block.
pub const END: &str = "<!-- agents-md:end -->";

/// Pure: `target` with its generated block replaced by `source`.
///
/// The block goes where the markers are; failing that, in place of a line that
/// is exactly `@AGENTS.md` (the import it supersedes); failing that, straight
/// after the first line (the title). Idempotent: embedding the same source
/// twice yields the same text.
pub fn embed(target: &str, source: &str) -> String {
    let block = format!("{BEGIN}\n{}\n{END}", source.trim_end());
    if let (Some(b), Some(e)) = (target.find(BEGIN), target.find(END)) {
        if b < e {
            let tail = &target[e + END.len()..];
            return format!("{}{block}{tail}", &target[..b]);
        }
    }
    let mut lines: Vec<&str> = target.lines().collect();
    if let Some(i) = lines.iter().position(|l| l.trim() == "@AGENTS.md") {
        lines[i] = &block;
        return join(&lines, target);
    }
    match target.split_once('\n') {
        Some((title, rest)) => format!("{title}\n\n{block}\n{rest}"),
        None if target.is_empty() => format!("{block}\n"),
        None => format!("{target}\n\n{block}\n"),
    }
}

fn join(lines: &[&str], original: &str) -> String {
    let mut out = lines.join("\n");
    if original.ends_with('\n') {
        out.push('\n');
    }
    out
}

/// Embed `source` into `target` on disk. A missing source or target is a
/// no-op (fail-open: boot never breaks over an instruction file); the target
/// is rewritten only when its text changes.
pub fn run(source: &Path, target: &Path, dry_run: bool) -> Result<(), String> {
    let Ok(src) = std::fs::read_to_string(source) else {
        eprintln!("  [agents-md] {} absent — nothing to embed", source.display());
        return Ok(());
    };
    let Ok(cur) = std::fs::read_to_string(target) else {
        eprintln!("  [agents-md] {} absent — nothing to update", target.display());
        return Ok(());
    };
    let next = embed(&cur, &src);
    if next == cur {
        return Ok(());
    }
    if dry_run {
        println!("  [agents-md] would refresh {} from {}", target.display(), source.display());
        return Ok(());
    }
    let tmp = target.with_extension("md.agents-md.tmp");
    std::fs::write(&tmp, &next).map_err(|e| format!("{}: {e}", tmp.display()))?;
    std::fs::rename(&tmp, target).map_err(|e| format!("{}: {e}", target.display()))?;
    println!("  [agents-md] refreshed {} from {}", target.display(), source.display());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const SRC: &str = "# Env facts\n\nfact one\n";

    #[test]
    fn replaces_the_import_line_in_place() {
        let t = "# Workspace — Claude\n\n@AGENTS.md\n\n## Browser\nuse the skill\n";
        let out = embed(t, SRC);
        assert!(!out.contains("\n@AGENTS.md\n"));
        let b = out.find(BEGIN).unwrap();
        assert!(b < out.find("fact one").unwrap());
        assert!(out.find(END).unwrap() < out.find("## Browser").unwrap());
        assert!(out.ends_with("use the skill\n"));
    }

    #[test]
    fn refreshes_an_existing_block_and_is_idempotent() {
        let t = "# W\n\n@AGENTS.md\n\n## Claude only\nx\n";
        let once = embed(t, SRC);
        assert_eq!(embed(&once, SRC), once);
        let changed = embed(&once, "# Env facts\n\nfact two\n");
        assert!(changed.contains("fact two") && !changed.contains("fact one"));
        assert!(changed.ends_with("## Claude only\nx\n"));
        assert_eq!(changed.matches(BEGIN).count(), 1);
    }

    #[test]
    fn without_markers_or_import_inserts_after_the_title() {
        let out = embed("# Title\nbody\n", SRC);
        assert!(out.starts_with("# Title\n\n<!-- agents-md:begin"));
        assert!(out.ends_with("body\n"));
    }

    #[test]
    fn missing_files_are_a_no_op() {
        let dir = std::env::temp_dir().join(format!("agents-md-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let (s, t) = (dir.join("AGENTS.md"), dir.join("CLAUDE.md"));
        assert!(run(&s, &t, false).is_ok());
        std::fs::write(&s, SRC).unwrap();
        assert!(run(&s, &t, false).is_ok());
        assert!(!t.exists());
        std::fs::write(&t, "# W\n\n@AGENTS.md\n").unwrap();
        run(&s, &t, false).unwrap();
        let first = std::fs::read_to_string(&t).unwrap();
        assert!(first.contains("fact one"));
        run(&s, &t, false).unwrap();
        assert_eq!(std::fs::read_to_string(&t).unwrap(), first);
        std::fs::remove_dir_all(&dir).ok();
    }
}
