//! Per-role service accounts and the isolated supervisor config (ADR-2122,
//! custody X-1 step 1, workstream W1).
//!
//! `config/role-accounts.json` is the single source for every role: its name,
//! uid (= gid), the supervised programs that run as it and the secrets it alone
//! may read. Three things are derived from it, and only from it:
//!
//! * `/etc/passwd` and `/etc/group` lines, baked by `flake.nix` (the role
//!   groups have no members; a `groups` entry, such as the identity port's
//!   socket group, lists its members explicitly);
//! * `/etc/supervisord.roles.conf`, a pure function of today's rendered
//!   `/etc/supervisord.conf`: each role program's `user=` becomes its role and its
//!   `environment=` gains `HOME`, `AGENTBOX_SECRETS_DIR` and the per-secret path
//!   variables pointed at `/run/secrets/<role>/`. No other line changes, so the
//!   two configs cannot drift (the test suite diffs them);
//! * the delivery plan the entrypoint executes as root before `exec
//!   supervisord` when `[security].role_isolation = true`.
//!
//! A secret's at-rest source comes from the program's OWN `environment=` value
//! when it sets the variable (that is where the manifest's `faucet_key_file` or
//! `parent_credential_file` lands), and from the table's `source` otherwise, so
//! the table never duplicates a manifest value. Secret values never pass through
//! this module: it handles names and paths only.

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use serde::Deserialize;

/// The table's schema tag. A different tag is refused rather than guessed at.
pub const SCHEMA: &str = "agentbox.role-accounts/1";

/// Linux `useradd` limit; longer names are truncated by some tools.
const NAME_MAX: usize = 32;

/// The account every non-role program runs as, and the only `user=` a role
/// program may have in today's config.
const DEVUSER: &str = "devuser";
const DEVUSER_ID: u32 = 1000;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Table {
    #[serde(rename = "$comment", default)]
    _comment: Option<String>,
    pub schema: String,
    pub uid_range: [u32; 2],
    #[serde(default)]
    pub reserved_ids: BTreeMap<String, String>,
    pub secrets_root: String,
    #[serde(default)]
    pub secret_bearing_programs: Vec<String>,
    pub roles: Vec<Role>,
    /// Shared groups beyond each role's own (the identity port's socket group).
    #[serde(default)]
    pub groups: Vec<Group>,
    /// Directories outside `secrets_root` that root prepares before supervisord
    /// for a role program that cannot create them itself.
    #[serde(default)]
    pub dirs: Vec<DirSpec>,
}

/// A shared group: a gid in `uid_range`, explicit members, and a role that owns
/// `<secrets_root>/<name>/` (0750, group = this gid) to put a socket in. The
/// owner's programs get the gid in `env`, so the socket can be chgrp'd to it.
/// The directory sits inside the root-owned secrets mount because the rest of
/// `/run` belongs to devuser, who could rename anything else out of the way.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Group {
    pub name: String,
    pub gid: u32,
    #[serde(default)]
    pub purpose: String,
    /// `devuser` or role names. The owner must be one (chgrp needs membership).
    pub members: Vec<String>,
    /// The role that owns `<secrets_root>/<name>/` and receives `env`.
    pub owner: String,
    /// The variable the owner's programs read the gid from.
    pub env: String,
}

/// A directory root creates (or re-owns) before supervisord starts.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DirSpec {
    pub path: String,
    /// `root`, `devuser` or a role name.
    pub owner: String,
    /// `root`, `devuser`, a role name or a `groups` name.
    pub group: String,
    /// Octal mode, three or four digits.
    pub mode: String,
    #[serde(default)]
    pub purpose: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Role {
    pub name: String,
    pub uid: u32,
    #[serde(default)]
    pub purpose: String,
    #[serde(default)]
    pub programs: Vec<String>,
    #[serde(default)]
    pub secrets: Vec<Secret>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Secret {
    pub file: String,
    #[serde(default)]
    pub env: Option<String>,
    #[serde(default)]
    pub source: Option<String>,
    #[serde(default)]
    pub from_env: Option<String>,
}

impl Table {
    fn role_dir(&self, role: &Role) -> String {
        format!("{}/{}", self.secrets_root, role.name)
    }

    fn role_home(&self, role: &Role) -> String {
        format!("{}/home", self.role_dir(role))
    }

    fn role_for_program(&self, program: &str) -> Option<&Role> {
        self.roles
            .iter()
            .find(|r| r.programs.iter().any(|p| p == program))
    }

    /// uid of `root`, `devuser` or a role.
    fn user_id(&self, name: &str) -> Option<u32> {
        match name {
            "root" => Some(0),
            DEVUSER => Some(DEVUSER_ID),
            _ => self.roles.iter().find(|r| r.name == name).map(|r| r.uid),
        }
    }

    /// gid of `root`, `devuser`, a role's own group or a shared group.
    fn group_id(&self, name: &str) -> Option<u32> {
        self.user_id(name)
            .or_else(|| self.groups.iter().find(|g| g.name == name).map(|g| g.gid))
    }

    fn is_secret_bearing(&self, program: &str) -> bool {
        self.secret_bearing_programs
            .iter()
            .any(|pat| match pat.strip_suffix('*') {
                Some(prefix) => program.starts_with(prefix),
                None => program == pat,
            })
    }
}

/// Read and validate a table. Every rule violation is reported, not just the first.
pub fn load(path: &Path) -> Result<Table, String> {
    let text = std::fs::read_to_string(path)
        .map_err(|e| format!("role-accounts: cannot read {}: {e}", path.display()))?;
    let table: Table = serde_json::from_str(&text).map_err(|e| {
        format!(
            "role-accounts: {} is not a valid table: {e}",
            path.display()
        )
    })?;
    validate(&table)?;
    Ok(table)
}

fn is_env_name(s: &str) -> bool {
    let mut cs = s.chars();
    matches!(cs.next(), Some(c) if c.is_ascii_uppercase() || c == '_')
        && cs.all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_')
}

fn is_role_name(s: &str) -> bool {
    s.len() <= NAME_MAX
        && s.starts_with("ab-")
        && s.len() > 3
        && s.chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        && !s.ends_with('-')
}

fn is_file_name(s: &str) -> bool {
    !s.is_empty()
        && s != "home"
        && !s.starts_with('.')
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
}

/// A path a secret may be read from or written under: absolute, no `..`, and
/// nothing a supervisor `environment=` value or a TSV row would mangle.
fn is_plain_abs_path(s: &str) -> bool {
    s.starts_with('/')
        && !s.split('/').any(|seg| seg == "..")
        && !s.chars().any(|c| {
            c.is_whitespace() || c.is_control() || matches!(c, '"' | '\'' | ',' | '%' | '\\')
        })
}

/// Check every rule in ADR-2122's account table.
pub fn validate(t: &Table) -> Result<(), String> {
    let mut errs: Vec<String> = Vec::new();
    if t.schema != SCHEMA {
        errs.push(format!("schema is {:?}, expected {SCHEMA:?}", t.schema));
    }
    let [lo, hi] = t.uid_range;
    if lo > hi || lo < 100 || hi >= 1000 {
        errs.push(format!(
            "uid_range [{lo}, {hi}] must be ordered, system-range (100..999) and below devuser's 1000"
        ));
    }
    let mut reserved = BTreeSet::new();
    for k in t.reserved_ids.keys() {
        match k.parse::<u32>() {
            Ok(n) => {
                reserved.insert(n);
            }
            Err(_) => errs.push(format!("reserved_ids key {k:?} is not a number")),
        }
    }
    if !is_plain_abs_path(&t.secrets_root) || t.secrets_root.ends_with('/') {
        errs.push(format!(
            "secrets_root {:?} must be an absolute path without a trailing slash",
            t.secrets_root
        ));
    }
    for pat in &t.secret_bearing_programs {
        let stem = pat.strip_suffix('*').unwrap_or(pat);
        if stem.is_empty() || stem.contains('*') {
            errs.push(format!(
                "secret_bearing_programs entry {pat:?}: only a trailing * is allowed"
            ));
        }
    }

    let mut names = BTreeSet::new();
    let mut uids = BTreeSet::new();
    let mut programs = BTreeSet::new();
    let mut env_owners: BTreeMap<&str, &str> = BTreeMap::new();
    for r in &t.roles {
        if !is_role_name(&r.name) {
            errs.push(format!(
                "role {:?}: names are ab-<lowercase, digits, hyphens>, at most {NAME_MAX} characters",
                r.name
            ));
        }
        if !names.insert(r.name.as_str()) {
            errs.push(format!("role {:?} is listed twice", r.name));
        }
        if r.uid < lo || r.uid > hi {
            errs.push(format!(
                "role {}: uid {} is outside uid_range [{lo}, {hi}]",
                r.name, r.uid
            ));
        }
        if reserved.contains(&r.uid) {
            let why = t
                .reserved_ids
                .get(&r.uid.to_string())
                .map(String::as_str)
                .unwrap_or("");
            errs.push(format!(
                "role {}: uid {} is reserved ({why})",
                r.name, r.uid
            ));
        }
        if !uids.insert(r.uid) {
            errs.push(format!("role {}: uid {} is already taken", r.name, r.uid));
        }
        for p in &r.programs {
            if p.is_empty() || p.contains(char::is_whitespace) || p.contains(']') {
                errs.push(format!("role {}: program name {p:?} is malformed", r.name));
            }
            if !programs.insert(p.as_str()) {
                errs.push(format!(
                    "program {p} is mapped to more than one role (role {})",
                    r.name
                ));
            }
        }
        let mut files = BTreeSet::new();
        let mut envs = BTreeSet::new();
        for s in &r.secrets {
            let at = format!("role {} secret {:?}", r.name, s.file);
            if !is_file_name(&s.file) {
                errs.push(format!(
                    "{at}: file names are [A-Za-z0-9._-], not dotted, not \"home\""
                ));
            }
            if !files.insert(s.file.as_str()) {
                errs.push(format!("{at}: file name used twice"));
            }
            match (&s.source, &s.from_env) {
                (Some(_), Some(_)) => {
                    errs.push(format!("{at}: give `source` or `from_env`, not both"))
                }
                (None, None) => errs.push(format!("{at}: needs `source` or `from_env`")),
                (Some(src), None) => {
                    if !is_plain_abs_path(src) {
                        errs.push(format!(
                            "{at}: source {src:?} must be a plain absolute path"
                        ));
                    }
                    if src.starts_with(&format!("{}/", t.secrets_root)) {
                        errs.push(format!(
                            "{at}: source {src:?} is inside secrets_root; sources are at-rest copies"
                        ));
                    }
                    if s.env.is_none() {
                        errs.push(format!(
                            "{at}: a file secret needs `env`, the variable its program reads the path from"
                        ));
                    }
                }
                (None, Some(var)) => {
                    if !is_env_name(var) {
                        errs.push(format!("{at}: from_env {var:?} is not an environment name"));
                    } else if let Some(other) = env_owners.insert(var.as_str(), r.name.as_str()) {
                        errs.push(format!(
                            "{at}: from_env {var} already belongs to role {other}; a secret has one holder"
                        ));
                    }
                }
            }
            if let Some(e) = &s.env {
                if !is_env_name(e) {
                    errs.push(format!("{at}: env {e:?} is not an environment name"));
                }
                if matches!(e.as_str(), "HOME" | "AGENTBOX_SECRETS_DIR") {
                    errs.push(format!("{at}: env {e} is set by the transform itself"));
                }
                if !envs.insert(e.as_str()) {
                    errs.push(format!("{at}: env {e} names two secrets"));
                }
            }
        }
    }
    let mut gids = BTreeSet::new();
    for g in &t.groups {
        let at = format!("group {:?}", g.name);
        if !is_role_name(&g.name) {
            errs.push(format!("{at}: names are ab-<lowercase, digits, hyphens>, at most {NAME_MAX} characters"));
        }
        if !names.insert(g.name.as_str()) {
            errs.push(format!("{at}: the name is already a role or group"));
        }
        if g.gid < lo || g.gid > hi {
            errs.push(format!("{at}: gid {} is outside uid_range [{lo}, {hi}]", g.gid));
        }
        if reserved.contains(&g.gid) {
            errs.push(format!("{at}: gid {} is reserved", g.gid));
        }
        if uids.contains(&g.gid) || !gids.insert(g.gid) {
            errs.push(format!("{at}: gid {} is already taken", g.gid));
        }
        for m in &g.members {
            if m != DEVUSER && !t.roles.iter().any(|r| &r.name == m) {
                errs.push(format!("{at}: member {m:?} is neither devuser nor a role"));
            }
        }
        match t.roles.iter().find(|r| r.name == g.owner) {
            None => errs.push(format!("{at}: owner {:?} is not a role", g.owner)),
            Some(r) => {
                if !g.members.contains(&g.owner) {
                    errs.push(format!("{at}: owner {} must be a member (chgrp needs it)", g.owner));
                }
                if r.secrets.iter().any(|s| s.env.as_deref() == Some(g.env.as_str())) {
                    errs.push(format!("{at}: env {} already names a secret of {}", g.env, g.owner));
                }
            }
        }
        if !is_env_name(&g.env) || matches!(g.env.as_str(), "HOME" | "AGENTBOX_SECRETS_DIR") {
            errs.push(format!("{at}: env {:?} is not a free environment name", g.env));
        }
    }
    for d in &t.dirs {
        let at = format!("dir {:?}", d.path);
        if !is_plain_abs_path(&d.path) || d.path.ends_with('/') || d.path.matches('/').count() < 2 {
            errs.push(format!("{at}: must be a plain absolute path below a top-level directory"));
        }
        if d.path == t.secrets_root || d.path.starts_with(&format!("{}/", t.secrets_root)) {
            errs.push(format!("{at}: secrets_root is the delivery's own; list groups there instead"));
        }
        if d.owner != "root" && d.owner != DEVUSER && !t.roles.iter().any(|r| r.name == d.owner) {
            errs.push(format!("{at}: owner {:?} is not root, devuser or a role", d.owner));
        }
        if t.group_id(&d.group).is_none() {
            errs.push(format!("{at}: group {:?} is not root, devuser, a role or a group", d.group));
        }
        let m = d.mode.as_str();
        if !(3..=4).contains(&m.len()) || !m.chars().all(|c| ('0'..='7').contains(&c)) || m.ends_with(['2', '3', '6', '7']) {
            errs.push(format!("{at}: mode {m:?} must be 3-4 octal digits and not world-writable"));
        }
    }
    for reserved_name in ["root", DEVUSER, "wheel", "nobody", "nogroup"] {
        if names.contains(reserved_name) {
            errs.push(format!("role name {reserved_name} is a system account"));
        }
    }
    for p in &programs {
        if !t.is_secret_bearing(p) {
            errs.push(format!(
                "program {p} is mapped to a role but not listed in secret_bearing_programs"
            ));
        }
    }
    if errs.is_empty() {
        Ok(())
    } else {
        Err(format!(
            "role-accounts: the table is invalid:\n  - {}",
            errs.join("\n  - ")
        ))
    }
}

/// `/etc/passwd` lines. Shell `/sbin/nologin`: whether or not the image ships
/// it, a shell that cannot run refuses a login just as well; supervisord's
/// `user=` never consults it.
pub fn passwd_lines(t: &Table) -> String {
    t.roles
        .iter()
        .map(|r| {
            format!(
                "{name}:x:{uid}:{uid}:agentbox role {name}:{home}:/sbin/nologin\n",
                name = r.name,
                uid = r.uid,
                home = t.role_home(r)
            )
        })
        .collect()
}

/// `/etc/group` lines: each role's own primary group, with NO members (nobody,
/// devuser included, joins a role group), then each shared group with exactly
/// the members the table lists.
pub fn group_lines(t: &Table) -> String {
    let roles = t.roles.iter().map(|r| format!("{}:x:{}:\n", r.name, r.uid));
    let shared = t
        .groups
        .iter()
        .map(|g| format!("{}:x:{}:{}\n", g.name, g.gid, g.members.join(",")));
    roles.chain(shared).collect()
}

/// One line per role (name, uid, programs, purpose), per shared group and per
/// created directory, then a count. Names and
/// paths only, never a value.
pub fn summary(t: &Table) -> String {
    let mut out = String::new();
    for r in &t.roles {
        let programs = if r.programs.is_empty() {
            "-".to_string()
        } else {
            r.programs.join(",")
        };
        out.push_str(&format!(
            "{}\t{}\t{}\t{} secret(s)\t{}\n",
            r.name,
            r.uid,
            programs,
            r.secrets.len(),
            r.purpose
        ));
    }
    for g in &t.groups {
        out.push_str(&format!(
            "{}\t{}\tgroup of {}\t{}/{}/ owned by {}\t{}\n",
            g.name,
            g.gid,
            g.members.join(","),
            t.secrets_root,
            g.name,
            g.owner,
            g.purpose
        ));
    }
    for d in &t.dirs {
        out.push_str(&format!(
            "{}\tdir {}:{} {}\t{}\n",
            d.path, d.owner, d.group, d.mode, d.purpose
        ));
    }
    out.push_str(&format!("role-accounts: {} role(s) valid\n", t.roles.len()));
    out
}

// ─── supervisor environment= values ──────────────────────────────────────────

/// One `KEY=value` item of an `environment=` value. `raw` is the item exactly as
/// written, so an untouched item re-renders byte for byte.
#[derive(Debug, Clone, PartialEq)]
struct EnvItem {
    key: String,
    value: String,
    raw: String,
}

fn unquote(v: &str) -> &str {
    let b = v.as_bytes();
    if b.len() >= 2 && (b[0] == b'"' || b[0] == b'\'') && b[b.len() - 1] == b[0] {
        &v[1..v.len() - 1]
    } else {
        v
    }
}

/// Split an `environment=` value on the commas that sit outside quotes, as
/// supervisor's own parser does.
fn parse_env(value: &str) -> Result<Vec<EnvItem>, String> {
    let mut segs = Vec::new();
    let mut cur = String::new();
    let mut quote: Option<char> = None;
    for c in value.chars() {
        match quote {
            Some(q) => {
                cur.push(c);
                if c == q {
                    quote = None;
                }
            }
            None => match c {
                '"' | '\'' => {
                    quote = Some(c);
                    cur.push(c);
                }
                ',' => segs.push(std::mem::take(&mut cur)),
                _ => cur.push(c),
            },
        }
    }
    if quote.is_some() {
        return Err(format!("unterminated quote in environment={value}"));
    }
    segs.push(cur);
    segs.into_iter()
        .map(|seg| {
            let (k, v) = seg
                .split_once('=')
                .ok_or_else(|| format!("environment item {seg:?} has no '='"))?;
            Ok(EnvItem {
                key: k.trim().to_string(),
                value: unquote(v.trim()).to_string(),
                raw: seg.clone(),
            })
        })
        .collect()
}

fn set_env(items: &mut Vec<EnvItem>, key: &str, value: &str) {
    let raw = format!("{key}=\"{value}\"");
    let item = EnvItem {
        key: key.to_string(),
        value: value.to_string(),
        raw,
    };
    match items.iter_mut().find(|i| i.key == key) {
        Some(slot) => *slot = item,
        None => items.push(item),
    }
}

fn render_env(items: &[EnvItem]) -> String {
    items
        .iter()
        .map(|i| i.raw.as_str())
        .collect::<Vec<_>>()
        .join(",")
}

// ─── the transform ───────────────────────────────────────────────────────────

/// A `key=value` line of an INI section: the key and the value, trimmed.
fn ini_kv(line: &str) -> Option<(&str, &str)> {
    let l = line.trim_start();
    if l.starts_with(';') || l.starts_with('#') || l.starts_with('[') {
        return None;
    }
    let (k, v) = l.split_once('=')?;
    Some((k.trim(), v.trim_end_matches(['\n', '\r']).trim()))
}

fn program_header(line: &str) -> Option<&str> {
    line.trim()
        .strip_prefix("[program:")
        .and_then(|s| s.strip_suffix(']'))
}

struct Section {
    program: String,
    user_line: Option<usize>,
    env_line: Option<usize>,
}

/// The isolated config and the delivery plan, both as text.
pub struct Isolated {
    pub conf: String,
    pub plan: String,
    pub isolated_programs: Vec<String>,
}

/// Derive `supervisord.roles.conf` and the delivery plan from today's config.
pub fn isolate(t: &Table, conf: &str) -> Result<Isolated, String> {
    let mut lines: Vec<String> = conf.split_inclusive('\n').map(str::to_string).collect();

    let mut sections: Vec<Section> = Vec::new();
    for (i, line) in lines.iter().enumerate() {
        if line.trim_start().starts_with('[') {
            if let Some(p) = program_header(line) {
                sections.push(Section {
                    program: p.to_string(),
                    user_line: None,
                    env_line: None,
                });
            } else {
                sections.push(Section {
                    program: String::new(),
                    user_line: None,
                    env_line: None,
                });
            }
            continue;
        }
        let Some(sec) = sections.last_mut() else {
            continue;
        };
        if let Some((k, _)) = ini_kv(line) {
            match k {
                "user" => sec.user_line = Some(i),
                "environment" => sec.env_line = Some(i),
                _ => {}
            }
        }
    }

    let mut errs = Vec::new();
    let mut seen = BTreeSet::new();
    for s in sections.iter().filter(|s| !s.program.is_empty()) {
        if !seen.insert(s.program.as_str()) {
            errs.push(format!("[program:{}] appears twice", s.program));
        }
        if t.is_secret_bearing(&s.program) && t.role_for_program(&s.program).is_none() {
            errs.push(format!(
                "[program:{}] is secret-bearing but no role in config/role-accounts.json runs it; add one (ADR-2122)",
                s.program
            ));
        }
    }
    if !errs.is_empty() {
        return Err(format!(
            "role-accounts isolate:\n  - {}",
            errs.join("\n  - ")
        ));
    }

    // role name -> (secret file -> at-rest source path), from rendered programs.
    let mut sources: BTreeMap<String, BTreeMap<String, String>> = BTreeMap::new();
    let mut isolated_programs = Vec::new();
    // Insertions shift later indices; apply them last, from the bottom up.
    let mut inserts: Vec<(usize, String)> = Vec::new();

    for s in &sections {
        let Some(role) = t.role_for_program(&s.program) else {
            continue;
        };
        let prog = &s.program;
        let user_idx = s.user_line.ok_or_else(|| {
            format!(
                "[program:{prog}] has no user= line; a role program must start as {DEVUSER} today"
            )
        })?;
        let user = ini_kv(&lines[user_idx]).map(|(_, v)| v).unwrap_or("");
        if user != DEVUSER {
            return Err(format!(
                "[program:{prog}] runs as {user:?}; only a user={DEVUSER} program may be given a role"
            ));
        }
        let eol = if lines[user_idx].ends_with('\n') {
            "\n"
        } else {
            ""
        };
        lines[user_idx] = format!("user={}{eol}", role.name);

        let mut items = match s.env_line {
            Some(i) => {
                let v = ini_kv(&lines[i]).map(|(_, v)| v).unwrap_or("");
                parse_env(v).map_err(|e| format!("[program:{prog}] {e}"))?
            }
            None => Vec::new(),
        };
        let dir = t.role_dir(role);
        set_env(&mut items, "HOME", &t.role_home(role));
        for sec in &role.secrets {
            let dest = format!("{dir}/{}", sec.file);
            if let Some(src) = &sec.source {
                let var = sec.env.as_deref().unwrap_or_default();
                let from_program = items.iter().find(|i| i.key == var).map(|i| i.value.clone());
                let src = from_program.unwrap_or_else(|| src.clone());
                if !is_plain_abs_path(&src) {
                    return Err(format!(
                        "[program:{prog}] {var}={src:?}: a secret source must be a literal absolute path"
                    ));
                }
                let by_file = sources.entry(role.name.clone()).or_default();
                if let Some(prev) = by_file.insert(sec.file.clone(), src.clone()) {
                    if prev != src {
                        return Err(format!(
                            "role {}: secret {} has two sources ({prev}, {src}) across its programs",
                            role.name, sec.file
                        ));
                    }
                }
            }
            if let Some(var) = &sec.env {
                set_env(&mut items, var, &dest);
            }
        }
        set_env(&mut items, "AGENTBOX_SECRETS_DIR", &dir);
        for g in t.groups.iter().filter(|g| g.owner == role.name) {
            set_env(&mut items, &g.env, &g.gid.to_string());
        }
        let env_line = format!("environment={}\n", render_env(&items));
        match s.env_line {
            Some(i) => lines[i] = env_line,
            None => inserts.push((user_idx + 1, env_line)),
        }
        isolated_programs.push(prog.clone());
    }
    inserts.sort_by_key(|&(at, _)| std::cmp::Reverse(at));
    for (at, line) in inserts {
        lines.insert(at, line);
    }

    let mut plan = String::from(
        "# agentbox role-secrets plan (ADR-2122). Generated by `agentbox-manifest role-accounts isolate`; do not edit.\n\
         # role <name> <uid> <gid>       create <secrets_root>/<name> (0500) and its home (0700), owned by the role\n\
         # file <name> <file> <source>   copy an at-rest file to <secrets_root>/<name>/<file>, 0400\n\
         # env  <name> <file> <VAR>      write PID 1's $VAR to <secrets_root>/<name>/<file>, 0400, then unset it\n\
         # sockdir <group> <uid> <gid>   create <secrets_root>/<group> (0750) owned by <uid>, group <gid>\n\
         # dir  <path> <uid>:<gid> <mode> create or re-own <path> outside secrets_root\n",
    );
    plan.push_str(&format!("root\t{}\n", t.secrets_root));
    for r in &t.roles {
        plan.push_str(&format!("role\t{}\t{}\t{}\n", r.name, r.uid, r.uid));
        for sec in &r.secrets {
            if let Some(var) = &sec.from_env {
                plan.push_str(&format!("env\t{}\t{}\t{var}\n", r.name, sec.file));
            } else if let Some(src) = sources.get(&r.name).and_then(|m| m.get(&sec.file)) {
                plan.push_str(&format!("file\t{}\t{}\t{src}\n", r.name, sec.file));
            }
        }
    }

    for g in &t.groups {
        let owner = t.user_id(&g.owner).unwrap_or_default();
        plan.push_str(&format!("sockdir\t{}\t{owner}\t{}\n", g.name, g.gid));
    }
    for d in &t.dirs {
        let (u, g) = (
            t.user_id(&d.owner).unwrap_or_default(),
            t.group_id(&d.group).unwrap_or_default(),
        );
        plan.push_str(&format!("dir\t{}\t{u}:{g}\t{}\n", d.path, d.mode));
    }

    Ok(Isolated {
        conf: lines.concat(),
        plan,
        isolated_programs,
    })
}

/// `role-accounts isolate`: write both outputs, or nothing.
pub fn run_isolate(table: &Path, conf: &Path, out: &Path, plan: &Path) -> Result<(), String> {
    let t = load(table)?;
    let text = std::fs::read_to_string(conf)
        .map_err(|e| format!("role-accounts: cannot read {}: {e}", conf.display()))?;
    let iso = isolate(&t, &text)?;
    std::fs::write(out, &iso.conf)
        .map_err(|e| format!("role-accounts: cannot write {}: {e}", out.display()))?;
    std::fs::write(plan, &iso.plan)
        .map_err(|e| format!("role-accounts: cannot write {}: {e}", plan.display()))?;
    println!(
        "role-accounts: {} program(s) isolated: {}",
        iso.isolated_programs.len(),
        iso.isolated_programs.join(" ")
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn table() -> Table {
        let p = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../config/role-accounts.json");
        load(&p).expect("the repository table validates")
    }

    fn tiny(json: &str) -> Result<(), String> {
        let t: Table = serde_json::from_str(json).map_err(|e| e.to_string())?;
        validate(&t)
    }

    const BASE: &str = r#""schema":"agentbox.role-accounts/1","uid_range":[960,979],
        "reserved_ids":{"965":"docker"},"secrets_root":"/run/secrets",
        "secret_bearing_programs":["p","q*"]"#;

    #[test]
    fn repository_table_is_valid_and_keeps_out_of_the_docker_gid() {
        let t = table();
        assert!(t.roles.iter().all(|r| r.uid != 965));
        assert!(t
            .roles
            .iter()
            .any(|r| r.name == "ab-identity" && r.uid == 960));
    }

    #[test]
    fn passwd_and_group_lines_have_no_members_and_role_homes() {
        let t = table();
        let g = group_lines(&t);
        for line in g.lines().take(t.roles.len()) {
            assert!(line.ends_with(':'), "role group line has members: {line}");
            assert!(!line.contains("devuser"));
        }
        assert_eq!(g.lines().count(), t.roles.len() + t.groups.len());
        let p = passwd_lines(&t);
        assert!(p.contains(
            "ab-identity:x:960:960:agentbox role ab-identity:/run/secrets/ab-identity/home:/sbin/nologin\n"
        ));
        assert_eq!(p.lines().count(), t.roles.len());
    }

    #[test]
    fn reserved_and_duplicate_uids_are_refused() {
        let e = tiny(&format!(
            r#"{{{BASE},"roles":[{{"name":"ab-a","uid":965}},{{"name":"ab-b","uid":961}},{{"name":"ab-c","uid":961}}]}}"#
        ))
        .unwrap_err();
        assert!(e.contains("uid 965 is reserved"), "{e}");
        assert!(e.contains("uid 961 is already taken"), "{e}");
    }

    #[test]
    fn out_of_range_and_bad_names_are_refused() {
        let e = tiny(&format!(
            r#"{{{BASE},"roles":[{{"name":"devuser","uid":1000}},{{"name":"ab-X","uid":959}}]}}"#
        ))
        .unwrap_err();
        assert!(e.contains("outside uid_range"), "{e}");
        assert!(e.contains("\"devuser\": names are"), "{e}");
        assert!(e.contains("\"ab-X\": names are"), "{e}");
    }

    #[test]
    fn a_secret_needs_exactly_one_source_and_one_holder() {
        let e = tiny(&format!(
            r#"{{{BASE},"roles":[
              {{"name":"ab-a","uid":960,"programs":["p"],"secrets":[
                {{"file":"k","env":"K","source":"/v/k","from_env":"K2"}},
                {{"file":"j"}},
                {{"file":"x","from_env":"SHARED"}}]}},
              {{"name":"ab-b","uid":961,"secrets":[{{"file":"y","from_env":"SHARED"}}]}}]}}"#
        ))
        .unwrap_err();
        assert!(e.contains("not both"), "{e}");
        assert!(e.contains("needs `source` or `from_env`"), "{e}");
        assert!(e.contains("SHARED already belongs to role ab-a"), "{e}");
    }

    #[test]
    fn a_mapped_program_must_be_declared_secret_bearing() {
        let e = tiny(&format!(
            r#"{{{BASE},"roles":[{{"name":"ab-a","uid":960,"programs":["other"]}}]}}"#
        ))
        .unwrap_err();
        assert!(e.contains("not listed in secret_bearing_programs"), "{e}");
    }

    #[test]
    fn env_values_split_outside_quotes_and_round_trip() {
        let v =
            r#"HOME="/home/devuser",PATH="/a:/b",X="a,b",URL="http://127.0.0.1:%(ENV_P)s",BARE=1"#;
        let items = parse_env(v).unwrap();
        assert_eq!(items.len(), 5);
        assert_eq!(items[2].value, "a,b");
        assert_eq!(items[4].value, "1");
        assert_eq!(render_env(&items), v);
        assert!(parse_env(r#"A="x"#).is_err());
    }

    const CONF: &str = "[supervisord]\nnodaemon=true\n\n\
[program:p]\ncommand=/bin/p\nuser=devuser\nenvironment=HOME=\"/home/devuser\",K=\"/vol/k\"\npriority=1\n\n\
[program:q-one]\ncommand=/bin/q\nuser=devuser\npriority=2\n\n\
[program:plain]\ncommand=/bin/plain\nuser=devuser\nenvironment=HOME=\"/home/devuser\"\n";

    fn small_table() -> Table {
        serde_json::from_str(&format!(
            r#"{{{BASE},"roles":[
              {{"name":"ab-a","uid":960,"programs":["p"],"secrets":[
                {{"file":"k.key","env":"K","source":"/default/k"}},
                {{"file":"tok","from_env":"TOKEN","env":"TOKEN_FILE"}}]}},
              {{"name":"ab-b","uid":961,"programs":["q-one"],"secrets":[
                {{"file":"c","env":"C","source":"/default/c"}}]}},
              {{"name":"ab-idle","uid":962,"programs":[],"secrets":[]}}]}}"#
        ))
        .unwrap()
    }

    #[test]
    fn isolate_changes_only_user_and_environment_lines() {
        let t = small_table();
        validate(&t).unwrap();
        let iso = isolate(&t, CONF).unwrap();
        let strip = |s: &str| {
            s.lines()
                .filter(|l| !l.starts_with("user=") && !l.starts_with("environment="))
                .collect::<Vec<_>>()
                .join("\n")
        };
        assert_eq!(strip(CONF), strip(&iso.conf));
        assert!(iso.conf.contains("[program:plain]\ncommand=/bin/plain\nuser=devuser\nenvironment=HOME=\"/home/devuser\"\n"));
        assert!(iso.conf.contains(
            "user=ab-a\nenvironment=HOME=\"/run/secrets/ab-a/home\",K=\"/run/secrets/ab-a/k.key\",TOKEN_FILE=\"/run/secrets/ab-a/tok\",AGENTBOX_SECRETS_DIR=\"/run/secrets/ab-a\"\n"
        ));
        // q-one had no environment= line: one is inserted right after user=.
        assert!(iso.conf.contains(
            "user=ab-b\nenvironment=HOME=\"/run/secrets/ab-b/home\",C=\"/run/secrets/ab-b/c\",AGENTBOX_SECRETS_DIR=\"/run/secrets/ab-b\"\npriority=2\n"
        ));
        assert_eq!(iso.isolated_programs, vec!["p", "q-one"]);
    }

    #[test]
    fn the_programs_own_value_is_the_source_and_the_plan_covers_every_role() {
        let iso = isolate(&small_table(), CONF).unwrap();
        let rows: Vec<&str> = iso.plan.lines().filter(|l| !l.starts_with('#')).collect();
        assert_eq!(
            rows,
            vec![
                "root\t/run/secrets",
                "role\tab-a\t960\t960",
                "file\tab-a\tk.key\t/vol/k",
                "env\tab-a\ttok\tTOKEN",
                "role\tab-b\t961\t961",
                "file\tab-b\tc\t/default/c",
                "role\tab-idle\t962\t962",
            ]
        );
    }

    #[test]
    fn an_unmapped_secret_bearing_program_fails_the_build() {
        let conf = format!("{CONF}\n[program:q-two]\ncommand=/bin/q\nuser=devuser\n");
        let e = isolate(&small_table(), &conf).err().unwrap();
        assert!(
            e.contains("[program:q-two] is secret-bearing but no role"),
            "{e}"
        );
    }

    #[test]
    fn a_root_program_or_an_interpolated_source_is_refused() {
        let conf = CONF.replace(
            "[program:q-one]\ncommand=/bin/q\nuser=devuser\n",
            "[program:q-one]\ncommand=/bin/q\n",
        );
        assert!(isolate(&small_table(), &conf)
            .err()
            .unwrap()
            .contains("has no user= line"));
        let conf = CONF.replace("K=\"/vol/k\"", "K=\"%(ENV_K)s\"");
        assert!(isolate(&small_table(), &conf)
            .err()
            .unwrap()
            .contains("literal absolute path"));
    }

    #[test]
    fn a_program_not_rendered_contributes_no_file_rows() {
        let conf = CONF.replace("[program:q-one]", "[program:unrelated]");
        let iso = isolate(&small_table(), &conf).unwrap();
        assert!(!iso.plan.contains("file\tab-b"));
        assert!(iso.plan.contains("role\tab-b\t961\t961"));
    }

    #[test]
    fn the_identity_port_group_is_baked_exported_and_planned() {
        let t = table();
        let g = t
            .groups
            .iter()
            .find(|g| g.name == "ab-identity-port")
            .expect("the repository table declares the identity port's group");
        assert_eq!(g.owner, "ab-identity");
        assert_ne!(g.gid, 965);
        assert!(group_lines(&t).contains(&format!(
            "ab-identity-port:x:{}:{}\n",
            g.gid,
            g.members.join(",")
        )));
        let conf = "[program:serve-identity]\ncommand=x\nuser=devuser\nenvironment=HOME=\"/home/devuser\"\n\n[program:other]\ncommand=y\nuser=devuser\n";
        let iso = isolate(&t, conf).unwrap();
        assert!(iso.conf.contains("user=ab-identity\n"));
        assert!(iso
            .conf
            .contains(&format!("AGENTBOX_IDENTITY_SOCK_GID=\"{}\"", g.gid)));
        assert!(iso.conf.contains("AGENTBOX_SECRETS_DIR=\"/run/secrets/ab-identity\""));
        assert!(iso
            .plan
            .contains(&format!("sockdir\tab-identity-port\t960\t{}\n", g.gid)));
        assert!(iso
            .plan
            .contains("dir\t/var/lib/agentbox/events/sign\t960:1000\t2750\n"));
    }

    #[test]
    fn group_and_dir_rules_are_enforced() {
        let e = tiny(&format!(
            r#"{{{BASE},"roles":[{{"name":"ab-a","uid":960}}],
            "groups":[{{"name":"ab-g","gid":965,"members":["ab-a","eve"],"owner":"ab-a","env":"HOME"}},
                      {{"name":"ab-h","gid":960,"members":[],"owner":"ab-z","env":"G"}}],
            "dirs":[{{"path":"/run/secrets/x","owner":"eve","group":"nobody","mode":"0777"}}]}}"#
        ))
        .unwrap_err();
        for want in [
            "gid 965 is reserved",
            "member \"eve\" is neither devuser nor a role",
            "env \"HOME\" is not a free environment name",
            "gid 960 is already taken",
            "owner \"ab-z\" is not a role",
            "secrets_root is the delivery's own",
            "owner \"eve\" is not root",
            "group \"nobody\" is not",
            "not world-writable",
        ] {
            assert!(e.contains(want), "missing {want:?} in {e}");
        }
        tiny(&format!(
            r#"{{{BASE},"roles":[{{"name":"ab-a","uid":960}}],
            "groups":[{{"name":"ab-g","gid":969,"members":["devuser","ab-a"],"owner":"ab-a","env":"G_GID"}}],
            "dirs":[{{"path":"/var/lib/x","owner":"ab-a","group":"ab-g","mode":"2750"}}]}}"#
        ))
        .expect("a well-formed group and dir validate");
    }
}
