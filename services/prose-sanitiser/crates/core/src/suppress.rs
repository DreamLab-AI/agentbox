//! Inline suppression through HTML comments, in the shape Vale uses.
//!
//! A writer needs a way to say "this one is deliberate" without editing a
//! configuration file, and the marker must survive every renderer that will
//! ever see the document. HTML comments do: Markdown, MDX, HTML and reST all
//! pass them through without rendering anything.
//!
//! # Directives
//!
//! | Directive | Effect |
//! |---|---|
//! | `<!-- prose-sanitiser-disable -->` | Suppress every rule from here on |
//! | `<!-- prose-sanitiser-disable rule-a rule-b -->` | Suppress only those rules from here on |
//! | `<!-- prose-sanitiser-enable -->` | Resume every rule |
//! | `<!-- prose-sanitiser-enable rule-a -->` | Resume only that rule |
//! | `<!-- prose-sanitiser-disable-line rule -->` | Suppress on the line the comment sits on |
//! | `<!-- prose-sanitiser-disable-next-line rule -->` | Suppress on the following line |
//!
//! The Vale spellings are accepted as aliases, so a project already carrying
//! Vale markers needs no rewriting: `<!-- prose-sanitiser off -->` and
//! `<!-- prose-sanitiser on -->` behave as bare disable and enable, and
//! `<!-- prose-sanitiser:ignore RULE -->` behaves as `disable-line`.
//!
//! Naming no rule means every rule. An unterminated block runs to the end of
//! the document, which is the forgiving reading: a writer who disables a rule
//! and forgets to re-enable it gets silence, not a wall of findings.
//!
//! # Examples
//!
//! ```
//! use prose_sanitiser_core::Suppressions;
//!
//! let document = "\
//! An em-dash — here.
//! <!-- prose-sanitiser-disable em-dash-density -->
//! Another em-dash — here.
//! ";
//! let suppressions = Suppressions::parse(document);
//! assert!(!suppressions.is_suppressed("em-dash-density", 0));
//! assert!(suppressions.is_suppressed("em-dash-density", document.len() - 3));
//! // A different rule is untouched.
//! assert!(!suppressions.is_suppressed("tier1-vocab", document.len() - 3));
//! ```

use crate::finding::{Finding, Span};

/// The comment marker every directive starts with.
const MARKER: &str = "prose-sanitiser";

/// One suppressed region of a document.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Region {
    /// The byte range the suppression covers.
    span: Span,
    /// The rules it covers. `None` means every rule.
    rules: Option<Vec<String>>,
}

impl Region {
    fn covers(&self, rule_id: &str, offset: usize) -> bool {
        if offset < self.span.start || offset >= self.span.end {
            return false;
        }
        match &self.rules {
            None => true,
            Some(rules) => rules.iter().any(|id| id == rule_id),
        }
    }
}

/// Every suppression directive found in one document.
///
/// Parsing is a single linear pass and allocates only for the directives it
/// finds, so it is cheap enough to run on every keystroke in an editor.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Suppressions {
    regions: Vec<Region>,
}

impl Suppressions {
    /// An empty set: nothing is suppressed.
    pub fn new() -> Self {
        Self::default()
    }

    /// Whether the document carries no directives at all.
    pub fn is_empty(&self) -> bool {
        self.regions.is_empty()
    }

    /// Read every directive out of `document`.
    pub fn parse(document: &str) -> Self {
        let mut regions: Vec<Region> = Vec::new();
        // Open blocks awaiting an `enable`, as (rules, start offset).
        let mut open: Vec<(Option<Vec<String>>, usize)> = Vec::new();

        for comment in comments(document) {
            let Some(directive) = Directive::parse(comment.body) else {
                continue;
            };
            match directive.kind {
                Kind::Disable => open.push((directive.rules, comment.end)),
                Kind::Enable => {
                    close_matching(&mut open, &mut regions, &directive.rules, comment.start)
                }
                Kind::DisableLine => {
                    regions.push(Region {
                        span: line_span(document, comment.start),
                        rules: directive.rules,
                    });
                }
                Kind::DisableNextLine => {
                    let this_line = line_span(document, comment.start);
                    let next_start = (this_line.end + 1).min(document.len());
                    regions.push(Region {
                        span: line_span(document, next_start),
                        rules: directive.rules,
                    });
                }
            }
        }

        // An unterminated block runs to the end of the document.
        for (rules, start) in open {
            regions.push(Region {
                span: Span::new(start, document.len()),
                rules,
            });
        }

        Self { regions }
    }

    /// Whether `rule_id` is suppressed at byte `offset`.
    pub fn is_suppressed(&self, rule_id: &str, offset: usize) -> bool {
        self.regions
            .iter()
            .any(|region| region.covers(rule_id, offset))
    }

    /// Whether `rule_id` is suppressed anywhere `span` touches.
    ///
    /// A finding is dropped when its start is suppressed; testing the start
    /// alone keeps the answer stable for multi-line findings whose tail falls
    /// past an `enable`.
    pub fn suppresses(&self, rule_id: &str, span: Span) -> bool {
        self.is_suppressed(rule_id, span.start)
    }

    /// Drop every finding this set suppresses.
    pub fn filter(&self, findings: Vec<Finding>) -> Vec<Finding> {
        if self.regions.is_empty() {
            return findings;
        }
        findings
            .into_iter()
            .filter(|finding| !self.suppresses(&finding.rule_id, finding.span))
            .collect()
    }
}

/// Close every open block whose rule set `rules` releases.
fn close_matching(
    open: &mut Vec<(Option<Vec<String>>, usize)>,
    regions: &mut Vec<Region>,
    rules: &Option<Vec<String>>,
    at: usize,
) {
    let mut still_open = Vec::with_capacity(open.len());
    for (block_rules, start) in open.drain(..) {
        let released = match (rules, &block_rules) {
            // A bare `enable` closes everything.
            (None, _) => true,
            // A named `enable` cannot close a blanket block; that would let one
            // rule name silently re-enable every other rule.
            (Some(_), None) => false,
            (Some(wanted), Some(held)) => held.iter().any(|id| wanted.contains(id)),
        };
        if released {
            regions.push(Region {
                span: Span::new(start.min(at), at),
                rules: block_rules,
            });
        } else {
            still_open.push((block_rules, start));
        }
    }
    *open = still_open;
}

/// The byte range of the line containing `offset`, excluding its newline.
fn line_span(document: &str, offset: usize) -> Span {
    if offset >= document.len() {
        return Span::new(document.len(), document.len());
    }
    let start = document[..offset]
        .rfind('\n')
        .map(|index| index + 1)
        .unwrap_or(0);
    let end = document[offset..]
        .find('\n')
        .map(|index| offset + index)
        .unwrap_or(document.len());
    Span::new(start, end)
}

/// One HTML comment: its inner text and the byte range of the whole comment.
struct Comment<'a> {
    body: &'a str,
    start: usize,
    end: usize,
}

/// Every `<!-- ... -->` in `document` that is NOT inside a fenced code block,
/// in source order.
///
/// A directive inside a fenced code block is an example or generated code, not
/// a policy instruction. Recognising it would let a code sample's commentary
/// silence findings in the prose that follows it.
fn comments(document: &str) -> Vec<Comment<'_>> {
    let fenced = fenced_code_ranges(document);
    let mut out = Vec::new();
    let bytes = document.as_bytes();
    let mut cursor = 0usize;
    while cursor < bytes.len() {
        let Some(relative) = document[cursor..].find("<!--") else {
            break;
        };
        let start = cursor + relative;
        let body_start = start + 4;
        let Some(close) = document[body_start..].find("-->") else {
            break;
        };
        let body_end = body_start + close;
        let end = body_end + 3;
        if !inside_fenced(&fenced, start) {
            out.push(Comment {
                body: &document[body_start..body_end],
                start,
                end,
            });
        }
        cursor = end;
    }
    out
}

/// Byte ranges of fenced code blocks (` ``` ` or `~~~`), fence lines included.
fn fenced_code_ranges(document: &str) -> Vec<(usize, usize)> {
    let mut ranges = Vec::new();
    let mut open: Option<(usize, &str)> = None;
    let mut offset = 0usize;
    for line in document.split_inclusive('\n') {
        let stripped = line.trim_end_matches(['\n', '\r']).trim_start();
        if let Some((start, marker)) = &open {
            // A closing fence is the same marker (possibly with trailing spaces)
            // and nothing else on the line.
            if stripped.starts_with(marker)
                && stripped[marker.len()..].chars().all(char::is_whitespace)
            {
                ranges.push((*start, offset + line.len()));
                open = None;
            }
        } else if stripped.starts_with("```") {
            open = Some((offset, "```"));
        } else if stripped.starts_with("~~~") {
            open = Some((offset, "~~~"));
        }
        offset += line.len();
    }
    if let Some((start, _)) = open {
        ranges.push((start, document.len()));
    }
    ranges
}

/// Whether `offset` falls inside any fenced code range.
fn inside_fenced(ranges: &[(usize, usize)], offset: usize) -> bool {
    ranges
        .iter()
        .any(|(start, end)| offset >= *start && offset < *end)
}

/// What a directive asks for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Kind {
    Disable,
    Enable,
    DisableLine,
    DisableNextLine,
}

/// A parsed directive: the action and the rules it names.
struct Directive {
    kind: Kind,
    rules: Option<Vec<String>>,
}

impl Directive {
    /// Parse the inside of an HTML comment, or `None` if it is not a directive.
    fn parse(body: &str) -> Option<Self> {
        let text = body.trim();
        let rest = text.strip_prefix(MARKER)?;
        // Either `prose-sanitiser-<verb>` or the Vale-style `prose-sanitiser <verb>`
        // and `prose-sanitiser:ignore`.
        let rest = rest
            .strip_prefix('-')
            .or_else(|| rest.strip_prefix(':'))
            .unwrap_or(rest)
            .trim_start();

        let mut words = rest.split_whitespace();
        let verb = words.next()?.trim_end_matches(':');
        let kind = match verb {
            "disable" | "off" => Kind::Disable,
            "enable" | "on" => Kind::Enable,
            "disable-line" | "ignore" => Kind::DisableLine,
            "disable-next-line" => Kind::DisableNextLine,
            _ => return None,
        };

        let rules: Vec<String> = words
            .flat_map(|word| word.split(','))
            .map(|word| word.trim().trim_end_matches(',').to_string())
            .filter(|word| !word.is_empty())
            .collect();

        Some(Self {
            kind,
            rules: if rules.is_empty() { None } else { Some(rules) },
        })
    }
}

#[cfg(test)]
mod tests;
