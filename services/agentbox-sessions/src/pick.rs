//! The tab-8 picker (ADR-2153 §9).
//!
//! It moves one tmux client to a chosen session, and only ever the client it is
//! running in. `switch-client` with no `-c` acts on the client tmux infers; from
//! a shell that merely inherited `TMUX` that is the operator's, with every tab
//! attached, and their next prefix-d detaches it (the ADR-2063 hijack). So the
//! client is chosen here, named explicitly, and refused if it cannot be found.

use crate::plane::{Plane, SessionView};
use crate::tmux::{Client, Tmux};
use anyhow::{anyhow, bail, Result};
use std::io::{BufRead, Write};

/// The client this picker runs in: among the clients attached to the pane's own
/// session, the one with the most recent activity.
pub fn choose_client(clients: &[Client], pane_session: &str) -> Option<String> {
    clients.iter().filter(|c| c.session == pane_session).max_by_key(|c| c.activity).map(|c| c.tty.clone())
}

pub fn own_client(tmux: &Tmux) -> Result<String> {
    if std::env::var("TMUX").unwrap_or_default().is_empty() {
        bail!("not inside tmux; there is no client to switch");
    }
    let pane = std::env::var("TMUX_PANE").map_err(|_| anyhow!("TMUX_PANE is not set"))?;
    let session = tmux.pane_session(&pane)?;
    choose_client(&tmux.clients()?, &session).ok_or_else(|| anyhow!("no client is attached to session {session:?}"))
}

pub fn render(rows: &[SessionView]) -> String {
    let mut s = String::new();
    for (i, r) in rows.iter().enumerate() {
        s += &format!("{:>2}  {:<12} {:<9} {:<22} {:<9} {}\n", i + 1, r.slug, r.origin, r.label, r.tool, r.model.as_deref().unwrap_or(""));
    }
    s
}

fn target_for(r: &SessionView) -> String {
    if r.origin == "external" {
        r.name.clone()
    } else {
        format!("={}", r.name)
    }
}

pub fn run(plane: &Plane, list_only: bool) -> Result<()> {
    let stdin = std::io::stdin();
    loop {
        let rows = plane.status()?;
        println!("{}", render(&rows));
        if list_only {
            return Ok(());
        }
        print!("switch to # · r refresh · q quit > ");
        std::io::stdout().flush()?;
        let mut line = String::new();
        if stdin.lock().read_line(&mut line)? == 0 {
            return Ok(());
        }
        match line.trim() {
            "q" | "quit" => return Ok(()),
            "" | "r" => continue,
            n => {
                let Some(row) = n.parse::<usize>().ok().and_then(|i| rows.get(i.wrapping_sub(1))) else {
                    println!("not a session number: {n}");
                    continue;
                };
                if !row.present {
                    println!("{} is not running", row.slug);
                    continue;
                }
                match own_client(&plane.tmux).and_then(|c| plane.tmux.switch_client(&c, &target_for(row))) {
                    Ok(()) => return Ok(()),
                    Err(e) => println!("cannot switch: {e:#}"),
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn c(tty: &str, session: &str, activity: u64) -> Client {
        Client { tty: tty.into(), session: session.into(), activity }
    }

    #[test]
    fn picks_the_most_active_client_on_the_panes_own_session() {
        let clients = [c("/dev/pts/1", "agentbox", 10), c("/dev/pts/2", "agentbox", 30), c("/dev/pts/3", "other", 99)];
        assert_eq!(choose_client(&clients, "agentbox").as_deref(), Some("/dev/pts/2"));
    }

    #[test]
    fn never_falls_back_to_a_client_on_another_session() {
        assert_eq!(choose_client(&[c("/dev/pts/3", "other", 99)], "agentbox"), None);
        assert_eq!(choose_client(&[], "agentbox"), None);
    }

    #[test]
    fn switch_client_is_issued_in_exactly_one_place_and_always_names_a_client() {
        let src = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let mut hits = vec![];
        for e in std::fs::read_dir(&src).unwrap() {
            let p = e.unwrap().path();
            let text = std::fs::read_to_string(&p).unwrap();
            for (n, l) in text.lines().enumerate() {
                if l.contains("\"switch-client\"") {
                    hits.push((p.file_name().unwrap().to_string_lossy().into_owned(), l.trim().to_string(), n));
                }
            }
        }
        assert_eq!(hits.len(), 1, "{hits:?}");
        assert_eq!(hits[0].0, "tmux.rs");
        assert!(hits[0].1.contains("\"-c\""), "the one switch-client call must pass -c: {}", hits[0].1);
    }
}
