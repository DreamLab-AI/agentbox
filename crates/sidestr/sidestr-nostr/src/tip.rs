//! The signer's tip announcement, kind 33333 (SPEC 11; `siding/lib/announce.mjs`).
//!
//! In Melvin Carvalho's words, adapted from `announce.mjs`: a NIP-333 event,
//! addressable by `d` = chain id, content the last twelve headers, `u` tags
//! naming mirrors that serve the block file. A client that knows only a chain
//! id asks a relay for this, takes a mirror from it, reads that mirror's
//! `chain.json`, and accepts the mirror when the document's signer is the
//! event's author. A mirror is then held to the announcement: same tip hash,
//! or it is behind or lying. The `t` = `sidestr` tag is what a directory
//! filters on: relays index single-letter tags only.
//!
//! And the caveat SPEC 11 adds: **a chain id is a name, not a proof.** With
//! only the id, the newest announcement wins, so a client shows the signer it
//! ended up with; one that already knows the signer passes it to [`newest`]
//! and takes no other's.
//!
//! # Both header families
//!
//! The header format follows the parent (SPEC 3): 80 bytes beside a stock
//! Bitcoin parent, 164 beside a Knots BLAKE2b one. The content is those
//! headers as hex, joined, so it is a multiple of 160 or of 328 characters.
//! Before spec 0.0.3, upstream's `parseTip` accepted only `% 328`, which
//! rejected every announcement of a stock-family chain — including the live
//! `sidestr:dreamlab` one, whose single genesis header is 160 characters
//! (`fixtures/live-33333.json`). sidestr/spec PR #7 (merged 2026-09-22)
//! made `announce.mjs headerWidth` read the width from the content, then
//! upstream bounded it to `TIP_HEADERS` headers of hex and refused non-hex
//! before slicing. This port does the same: [`parse_tip`] infers the family
//! from the length within that bound and [`parse_tip_as`] takes it from the
//! chain's parent, which is the right answer when the chain document is at
//! hand.
//!
//! # Pure
//!
//! Nothing here opens a socket. [`newest`] is the selection rule of
//! `fetchLatestTip` over events the caller already fetched;
//! [`choose_mirror`] takes a closure that fetches `chain.json`, so an async
//! caller pre-fetches and answers from a map (as `announce-test.mjs` does).
//! The relay messages are in [`crate::relay`].
//!
//! ```
//! use sidestr_nostr::event::SecretKeySigner;
//! use sidestr_nostr::tip::{judge_mirror, parse_tip, sign_tip, TipTemplate, Verdict};
//! use sidestr_core::parents::Family;
//!
//! let signer = SecretKeySigner::from_hex(&"07".repeat(32)).unwrap();
//! let h = |i: u8| format!("{i:02x}").repeat(80);          // three stock headers
//! let t = TipTemplate::new("sidestr:example", 12, vec![h(1), h(2), h(3)], vec!["https://m.example/siding/".into()]).unwrap();
//! let ev = sign_tip(&signer, &t, 1_790_100_000).unwrap();
//!
//! let tip = parse_tip(&ev).unwrap();                       // verify() first in real use
//! assert_eq!((tip.tip, tip.family, tip.first_height()), (12, Some(Family::Stock), Some(10)));
//! assert_eq!(tip.mirrors, ["https://m.example/siding"]);   // trailing slash dropped
//!
//! assert_eq!(judge_mirror(Some(&tip), 12, Some(&h(3))), Verdict::Matches { height: 12 });
//! assert_eq!(judge_mirror(Some(&tip), 11, Some(&h(2))), Verdict::Behind { blocks: 1 });
//! assert!(!judge_mirror(Some(&tip), 12, Some(&h(9))).ok().unwrap());
//! ```

use serde::{Deserialize, Serialize};
use sidestr_core::parents::Family;

use crate::error::{any_hex, Error, Result};
use crate::event::{sign, Event, Signer, UnsignedEvent};
use crate::kinds::{expect_kind, KIND_TIP};
use crate::tags::{
    all, first, height_tag, required, tag, MARKER_MIRROR, TAG_ALT, TAG_D, TAG_N, TAG_T, TAG_TIP,
    TAG_U, TOPIC_SIDESTR,
};

/// How many headers an announcement carries: the last twelve
/// (`announce.mjs TIP_HEADERS`).
pub const TIP_HEADERS: usize = 12;

/// The hex length of one header of a family: 160 (stock, 80 bytes) or 328
/// (Knots v2, 164 bytes).
pub fn header_hex_len(family: Family) -> usize {
    match family {
        Family::Stock => 160,
        Family::Blake2b => 328,
    }
}

/// What a producer announces: the chain, its height, the trailing headers
/// and the mirrors it vouches for.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TipTemplate {
    /// The chain id, `sidestr:<name>`.
    pub chain_id: String,
    /// The tip height.
    pub tip: u32,
    /// The last headers, ascending, ending at the tip, each one header of one
    /// family as lowercase hex.
    pub headers_hex: Vec<String>,
    /// Mirror base URLs, as given; the parser drops trailing slashes.
    pub mirrors: Vec<String>,
}

impl TipTemplate {
    /// Check the shape: every header hex, all the same length, that length one
    /// of the two families', at most [`TIP_HEADERS`], and not more headers
    /// than heights below the tip.
    pub fn new(
        chain_id: impl Into<String>,
        tip: u32,
        headers_hex: Vec<String>,
        mirrors: Vec<String>,
    ) -> Result<Self> {
        let chain_id = chain_id.into();
        if chain_id.is_empty() {
            return Err(Error::Chain("empty chain id".into()));
        }
        let mut headers = Vec::with_capacity(headers_hex.len());
        for h in &headers_hex {
            headers.push(any_hex("header", h)?);
        }
        if let Some(f) = headers.first() {
            if headers.iter().any(|h| h.len() != f.len()) {
                return Err(Error::Family("headers are not all the same length".into()));
            }
            if f.len() != header_hex_len(Family::Stock)
                && f.len() != header_hex_len(Family::Blake2b)
            {
                return Err(Error::Family(format!(
                    "{} hex characters is neither an 80-byte stock header nor a 164-byte v2 header",
                    f.len()
                )));
            }
        }
        if headers.len() > TIP_HEADERS {
            return Err(Error::Family(format!(
                "{} headers: an announcement carries at most {TIP_HEADERS}",
                headers.len()
            )));
        }
        if headers.len() > tip as usize + 1 {
            return Err(Error::Family(format!(
                "{} headers but the tip is {tip}",
                headers.len()
            )));
        }
        Ok(Self {
            chain_id,
            tip,
            headers_hex: headers,
            mirrors,
        })
    }

    /// The height of the first header carried.
    pub fn first_height(&self) -> u32 {
        self.tip + 1 - self.headers_hex.len() as u32
    }
}

/// The unsigned event for a template (`announce.mjs tipEvent`): tags `d` and
/// `n` = chain id, `t` = `sidestr`, `tip` = height, `alt` = "sidestr headers
/// `<from>`-`<tip>` of `<chain id>`", one `u` per mirror with the `mirror`
/// marker; content the headers joined. `pubkey` is filled by the signer.
pub fn tip_event(t: &TipTemplate, created_at: u64) -> UnsignedEvent {
    let mut tags = vec![
        tag(TAG_D, &t.chain_id),
        tag(TAG_N, &t.chain_id),
        tag(TAG_T, TOPIC_SIDESTR),
        tag(TAG_TIP, t.tip.to_string()),
        tag(
            TAG_ALT,
            format!(
                "sidestr headers {}-{} of {}",
                t.first_height(),
                t.tip,
                t.chain_id
            ),
        ),
    ];
    for m in &t.mirrors {
        tags.push(vec![TAG_U.into(), m.clone(), MARKER_MIRROR.into()]);
    }
    UnsignedEvent {
        pubkey: String::new(),
        created_at,
        kind: KIND_TIP,
        tags,
        content: t.headers_hex.concat(),
    }
}

/// Sign a tip announcement with the chain's signer.
pub fn sign_tip(signer: &dyn Signer, t: &TipTemplate, created_at: u64) -> Result<Event> {
    sign(signer, tip_event(t, created_at))
}

/// A parsed announcement (`announce.mjs parseTip`), plus which family the
/// headers are.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Tip {
    /// The chain id from `d`.
    pub chain_id: String,
    /// The announced height.
    pub tip: u32,
    /// Mirror base URLs, trailing slashes removed.
    pub mirrors: Vec<String>,
    /// The headers, ascending, ending at the tip.
    pub headers_hex: Vec<String>,
    /// The header family, `None` only when no headers were carried.
    pub family: Option<Family>,
    /// The announcer.
    pub pubkey: String,
    /// When it was made.
    pub created_at: u64,
    /// The event id.
    pub id: String,
}

impl Tip {
    /// The height of the first carried header, `None` with no headers.
    pub fn first_height(&self) -> Option<u32> {
        (!self.headers_hex.is_empty()).then(|| self.tip + 1 - self.headers_hex.len() as u32)
    }

    /// The announced header at a height, if it is inside the window.
    pub fn header_at(&self, height: u32) -> Option<&str> {
        let first = self.first_height()?;
        if height < first || height > self.tip {
            return None;
        }
        self.headers_hex
            .get((height - first) as usize)
            .map(String::as_str)
    }
}

fn parse_with(ev: &Event, family: Option<Family>) -> Result<Tip> {
    expect_kind(ev.kind, KIND_TIP, "tip")?;
    let chain_id = required(&ev.tags, TAG_D)?.to_string();
    let tip = height_tag(&ev.tags, TAG_TIP)?;
    let content = ev.content.trim();
    let (headers_hex, family) = if content.is_empty() {
        (vec![], family)
    } else {
        let content = any_hex("headers", content)?;
        let family = match family {
            Some(f) => f,
            None => {
                let stock = content.len() % header_hex_len(Family::Stock) == 0;
                let v2 = content.len() % header_hex_len(Family::Blake2b) == 0;
                match (stock, v2) {
                    (true, false) => Family::Stock,
                    (false, true) => Family::Blake2b,
                    (true, true) => {
                        return Err(Error::Family(format!(
                            "{} hex characters fits both header families; parse with the chain's parent family",
                            content.len()
                        )))
                    }
                    (false, false) => {
                        return Err(Error::Family(format!(
                            "{} hex characters is not a whole number of headers of either family",
                            content.len()
                        )))
                    }
                }
            }
        };
        let len = header_hex_len(family);
        if content.len() % len != 0 {
            return Err(Error::Family(format!(
                "{} hex characters is not a whole number of {len}-character {family:?} headers",
                content.len()
            )));
        }
        // at most TIP_HEADERS headers, judged before any slicing: the width
        // inference above holds only within that bound, and relay content is
        // untrusted (announce.mjs headerWidth, spec 0.0.3)
        if content.len() / len > TIP_HEADERS {
            return Err(Error::Family(format!(
                "{} headers: an announcement carries at most {TIP_HEADERS}",
                content.len() / len
            )));
        }
        let headers: Vec<String> = content
            .as_bytes()
            .chunks(len)
            .map(|c| String::from_utf8(c.to_vec()).expect("ascii hex"))
            .collect();
        if headers.len() > tip as usize + 1 {
            return Err(Error::Family(format!(
                "{} headers but the tip is {tip}",
                headers.len()
            )));
        }
        (headers, Some(family))
    };
    Ok(Tip {
        chain_id,
        tip,
        mirrors: all(&ev.tags, TAG_U)
            .into_iter()
            .map(|u| u.trim_end_matches('/').to_string())
            .collect(),
        headers_hex,
        family,
        pubkey: ev.pubkey.clone(),
        created_at: ev.created_at,
        id: ev.id.clone(),
    })
}

/// Parse an announcement, inferring the header family from the content
/// length. Does **not** verify the signature: call [`Event::verify`] first,
/// as `fetchLatestTip` does before `parseTip`.
pub fn parse_tip(ev: &Event) -> Result<Tip> {
    parse_with(ev, None)
}

/// Parse an announcement whose header family is known from the chain's
/// parent (`sidestr_core::parents::resolve_parent(doc.parent)?.family`).
pub fn parse_tip_as(ev: &Event, family: Family) -> Result<Tip> {
    parse_with(ev, Some(family))
}

/// The selection rule of `announce.mjs fetchLatestTip` over already-fetched
/// events: verify each, keep those of kind 33333 for this chain (and from
/// `signer`, when the caller knows it), and take the highest tip, ties to the
/// newest `created_at`. Events that fail to verify or parse are dropped
/// silently, as upstream drops them.
pub fn newest<'a>(
    events: impl IntoIterator<Item = &'a Event>,
    chain_id: &str,
    signer: Option<&str>,
) -> Option<Tip> {
    let mut best: Option<Tip> = None;
    for ev in events {
        if ev.kind != KIND_TIP || ev.verify().is_err() {
            continue;
        }
        if let Some(s) = signer {
            if !ev.is_by(s) {
                continue;
            }
        }
        let Ok(p) = parse_tip(ev) else { continue };
        if p.chain_id != chain_id {
            continue;
        }
        let better = match &best {
            None => true,
            Some(b) => p.tip > b.tip || (p.tip == b.tip && p.created_at > b.created_at),
        };
        if better {
            best = Some(p);
        }
    }
    best
}

/// The part of a mirror's `chain.json` the trust rule reads: its id and its
/// signer. Everything else is `sidestr_core::document::ChainDocument`'s.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MirrorChain {
    /// The chain id the document claims.
    pub id: String,
    /// The signer the document names (level 1).
    #[serde(default)]
    pub signer: Option<String>,
}

/// A mirror the announcer vouches for.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChosenMirror {
    /// The mirror's base URL, without a trailing slash.
    pub mirror: String,
    /// What its `chain.json` said.
    pub chain: MirrorChain,
}

/// Where a mirror's chain document is.
pub fn chain_json_url(mirror: &str) -> String {
    format!("{}/chain.json", mirror.trim_end_matches('/'))
}

/// The trust rule (`announce.mjs chooseMirror`): the first mirror the
/// announcement names whose `chain.json` has this chain id **and** names the
/// announcer as its signer. `fetch` is asked for [`chain_json_url`] of each
/// mirror in turn and answers with the document or a message; the messages
/// end up in [`Error::NoMirror`] when none checks out.
pub fn choose_mirror(
    tip: &Tip,
    chain_id: &str,
    mut fetch: impl FnMut(&str) -> core::result::Result<MirrorChain, String>,
) -> Result<ChosenMirror> {
    let mut tried = Vec::new();
    for m in &tip.mirrors {
        match fetch(&chain_json_url(m)) {
            Ok(chain)
                if chain.id == chain_id && chain.signer.as_deref() == Some(tip.pubkey.as_str()) =>
            {
                return Ok(ChosenMirror {
                    mirror: m.clone(),
                    chain,
                })
            }
            Ok(chain) => tried.push(format!(
                "{m}: signer {}… is not the announcer {}…",
                short(chain.signer.as_deref().unwrap_or("undefined")),
                short(&tip.pubkey)
            )),
            Err(e) => tried.push(format!("{m}: {e}")),
        }
    }
    Err(Error::NoMirror {
        chain_id: chain_id.to_string(),
        tip: tip.tip,
        announcer: short(&tip.pubkey),
        tried: if tried.is_empty() {
            "no mirrors named".into()
        } else {
            tried.join("; ")
        },
    })
}

fn short(s: &str) -> String {
    s.chars().take(8).collect()
}

/// How a mirror stands against the announcement (`announce.mjs judgeMirror`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Verdict {
    /// No announcement to compare with: not a verdict.
    Undecided,
    /// The mirror is ahead of the signer's announcement: blocks the signer
    /// never announced.
    Ahead {
        /// The mirror's height.
        height: u32,
        /// The announced height.
        announced: u32,
    },
    /// The mirror's block at this height is not the one the signer announced.
    Contradicts {
        /// The height that differs.
        height: u32,
    },
    /// The mirror has not caught up; behind is not wrong.
    Behind {
        /// How many blocks behind.
        blocks: u32,
    },
    /// The mirror matches the announcement.
    Matches {
        /// The height that matched.
        height: u32,
    },
}

impl Verdict {
    /// Upstream's `ok`: `None` undecided, `Some(false)` for a lying or
    /// runaway mirror, `Some(true)` for matching or merely behind.
    pub fn ok(&self) -> Option<bool> {
        match self {
            Verdict::Undecided => None,
            Verdict::Ahead { .. } | Verdict::Contradicts { .. } => Some(false),
            Verdict::Behind { .. } | Verdict::Matches { .. } => Some(true),
        }
    }
}

impl core::fmt::Display for Verdict {
    /// Upstream's `note`, word for word.
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            Verdict::Undecided => write!(f, "no announcement to compare with"),
            Verdict::Ahead { height, announced } => write!(
                f,
                "the mirror is ahead of the signer's announcement ({height} > {announced})"
            ),
            Verdict::Contradicts { height } => write!(
                f,
                "the mirror's block {height} is not the one the signer announced"
            ),
            Verdict::Behind { blocks } => {
                write!(f, "the mirror is {blocks} block(s) behind the announcement")
            }
            Verdict::Matches { height } => write!(
                f,
                "the mirror matches the signer's announcement of {height}"
            ),
        }
    }
}

/// Judge a mirror by its tip height and that header's hex against the
/// announcement: matching, behind, or contradicting it — a different block,
/// or blocks the signer never announced. A mirror may be behind but never
/// ahead of the signer (SPEC 11). A height below the window is compared on
/// height alone, as upstream does.
pub fn judge_mirror(announced: Option<&Tip>, height: u32, header_hex: Option<&str>) -> Verdict {
    let Some(a) = announced else {
        return Verdict::Undecided;
    };
    if height > a.tip {
        return Verdict::Ahead {
            height,
            announced: a.tip,
        };
    }
    if let (Some(mine), Some(theirs)) = (header_hex, a.header_at(height)) {
        if !mine.trim().eq_ignore_ascii_case(theirs) {
            return Verdict::Contradicts { height };
        }
    }
    if height < a.tip {
        Verdict::Behind {
            blocks: a.tip - height,
        }
    } else {
        Verdict::Matches { height }
    }
}

/// The `d` tag a directory filters on: this announcement's, from the event.
pub fn chain_of(ev: &Event) -> Option<&str> {
    (ev.kind == KIND_TIP)
        .then(|| first(&ev.tags, TAG_D))
        .flatten()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::event::SecretKeySigner;

    fn signer() -> SecretKeySigner {
        SecretKeySigner::from_hex(&"07".repeat(32)).unwrap()
    }
    fn h(i: u8, bytes: usize) -> String {
        format!("{i:02x}").repeat(bytes)
    }
    fn v2() -> Event {
        let t = TipTemplate::new(
            "sidestr:t",
            12,
            vec![h(1, 164), h(2, 164), h(3, 164)],
            vec![
                "https://a.example/siding/".into(),
                "https://b.example/siding".into(),
            ],
        )
        .unwrap();
        sign_tip(&signer(), &t, 1_790_100_000).unwrap()
    }

    // siding/test/announce-test.mjs
    #[test]
    fn the_event_is_kind_33333_addressable_by_d_tagged_t_sidestr_and_verifies() {
        let ev = v2();
        assert_eq!(ev.kind, KIND_TIP);
        assert!(ev.tags.iter().any(|x| x[0] == "d" && x[1] == "sidestr:t"));
        assert!(ev.tags.iter().any(|x| x[0] == "t" && x[1] == "sidestr"));
        assert!(ev
            .tags
            .iter()
            .any(|x| x[0] == "alt" && x[1] == "sidestr headers 10-12 of sidestr:t"));
        assert!(ev
            .tags
            .iter()
            .any(|x| x == &vec!["u", "https://a.example/siding/", "mirror"]));
        ev.verify().unwrap();
        assert_eq!(chain_of(&ev), Some("sidestr:t"));
    }

    #[test]
    fn it_parses_back_tip_headers_mirrors_without_trailing_slashes() {
        let p = parse_tip(&v2()).unwrap();
        assert_eq!(p.tip, 12);
        assert_eq!(p.headers_hex.len(), 3);
        assert_eq!(p.headers_hex[2], h(3, 164));
        assert_eq!(
            p.mirrors,
            ["https://a.example/siding", "https://b.example/siding"]
        );
        assert_eq!(p.pubkey, signer().pubkey_hex_ok());
        assert_eq!(p.family, Some(Family::Blake2b));
        assert_eq!(p.header_at(10), Some(h(1, 164).as_str()));
        assert_eq!(p.header_at(9), None);
        assert_eq!(p.header_at(13), None);
    }

    #[test]
    fn a_malformed_content_is_rejected() {
        let mut ev = v2();
        ev.content = "abc".into();
        assert!(matches!(parse_tip(&ev), Err(Error::Hex { .. })));
        ev.content = "ab".repeat(100);
        assert!(matches!(parse_tip(&ev), Err(Error::Family(_))));
        ev.content = "zz".repeat(80);
        assert!(matches!(parse_tip(&ev), Err(Error::Hex { .. })));
        // 6560 hex characters divides by both 160 and 328: never guessed
        ev.content = "ab".repeat(3280);
        ev.tags.iter_mut().find(|t| t[0] == "tip").unwrap()[1] = "100".into();
        assert!(matches!(parse_tip(&ev), Err(Error::Family(m)) if m.contains("both")));
        // and with the family given, 41 or 20 headers still exceed TIP_HEADERS
        // (upstream bounds the count before slicing, spec 0.0.3)
        assert!(matches!(
            parse_tip_as(&ev, Family::Stock),
            Err(Error::Family(m)) if m.contains("at most")
        ));
        assert!(matches!(
            parse_tip_as(&ev, Family::Blake2b),
            Err(Error::Family(m)) if m.contains("at most")
        ));
        // more headers than heights
        let mut low = v2();
        low.tags.iter_mut().find(|t| t[0] == "tip").unwrap()[1] = "1".into();
        assert!(matches!(parse_tip(&low), Err(Error::Family(_))));
        let mut no_tip = v2();
        no_tip.tags.retain(|t| t[0] != "tip");
        assert!(matches!(parse_tip(&no_tip), Err(Error::MissingTag("tip"))));
        let mut wrong = v2();
        wrong.kind = 1;
        assert!(matches!(parse_tip(&wrong), Err(Error::Kind { .. })));
    }

    /// announce-test.mjs (spec 0.0.3): more than TIP_HEADERS headers, or
    /// non-hex content, is rejected before any slicing; exactly TIP_HEADERS
    /// parses. 13 stock headers (2080 hex) slipped under the old 12 x 328
    /// hex-length cap upstream; the cap is on the header count.
    #[test]
    fn header_count_is_bounded_before_slicing_as_upstream_bounds_it() {
        let mut ev = sign_tip(
            &signer(),
            &TipTemplate::new("sidestr:t", 100, vec![h(1, 80)], vec![]).unwrap(),
            1,
        )
        .unwrap();
        let one_stock = ev.content.clone();
        let one_v2 = "ab".repeat(164);
        ev.content = one_stock.repeat(13);
        assert!(matches!(parse_tip(&ev), Err(Error::Family(_))), "13 stock");
        ev.content = one_v2.repeat(13);
        assert!(matches!(parse_tip(&ev), Err(Error::Family(_))), "13 v2");
        ev.content = "zz".repeat(164);
        assert!(matches!(parse_tip(&ev), Err(Error::Hex { .. })), "non-hex");
        ev.content = one_stock.repeat(12);
        assert_eq!(parse_tip(&ev).unwrap().headers_hex.len(), 12);
        ev.content = one_v2.repeat(12);
        assert_eq!(parse_tip(&ev).unwrap().headers_hex.len(), 12);
    }

    #[test]
    fn stock_headers_parse_where_upstream_before_0_0_3_returned_null() {
        let t = TipTemplate::new("sidestr:t", 0, vec![h(9, 80)], vec![]).unwrap();
        let ev = sign_tip(&signer(), &t, 1).unwrap();
        assert_eq!(ev.content.len(), 160);
        assert_ne!(
            ev.content.len() % 328,
            0,
            "upstream before spec 0.0.3 rejected this"
        );
        let p = parse_tip(&ev).unwrap();
        assert_eq!(
            (p.family, p.first_height(), p.tip),
            (Some(Family::Stock), Some(0), 0)
        );
        assert_eq!(parse_tip_as(&ev, Family::Stock).unwrap(), p);
        assert!(matches!(
            parse_tip_as(&ev, Family::Blake2b),
            Err(Error::Family(_))
        ));
        // no headers at all: allowed, family unknown
        let empty = sign_tip(
            &signer(),
            &TipTemplate::new("sidestr:t", 5, vec![], vec![]).unwrap(),
            1,
        )
        .unwrap();
        let p = parse_tip(&empty).unwrap();
        assert_eq!((p.family, p.first_height()), (None, None));
    }

    #[test]
    fn the_template_refuses_what_cannot_be_announced() {
        assert!(TipTemplate::new("", 1, vec![], vec![]).is_err());
        assert!(TipTemplate::new("sidestr:t", 1, vec![h(1, 80), h(2, 164)], vec![]).is_err());
        assert!(TipTemplate::new("sidestr:t", 1, vec![h(1, 81)], vec![]).is_err());
        assert!(TipTemplate::new("sidestr:t", 1, vec![h(1, 80); 3], vec![]).is_err());
        assert!(TipTemplate::new("sidestr:t", 20, vec![h(1, 80); 13], vec![]).is_err());
        assert!(TipTemplate::new("sidestr:t", 20, vec![h(1, 80); 12], vec![]).is_ok());
        assert!(TipTemplate::new("sidestr:t", 1, vec!["xyz".into()], vec![]).is_err());
    }

    #[test]
    fn the_mirror_whose_chain_json_names_the_announcer_is_chosen_the_other_skipped() {
        let p = parse_tip(&v2()).unwrap();
        let pub_ = signer().pubkey_hex_ok();
        let docs = |u: &str| -> core::result::Result<MirrorChain, String> {
            match u {
                "https://a.example/siding/chain.json" => Ok(MirrorChain {
                    id: "sidestr:t".into(),
                    signer: Some("ff".repeat(32)),
                }),
                "https://b.example/siding/chain.json" => Ok(MirrorChain {
                    id: "sidestr:t".into(),
                    signer: Some(pub_.clone()),
                }),
                _ => Err("404".into()),
            }
        };
        let found = choose_mirror(&p, "sidestr:t", docs).unwrap();
        assert_eq!(found.mirror, "https://b.example/siding");
        assert_eq!(found.chain.signer.as_deref(), Some(pub_.as_str()));
    }

    #[test]
    fn no_mirror_vouched_for_by_the_announcer_is_a_clear_error() {
        let p = parse_tip(&v2()).unwrap();
        let e = choose_mirror(&p, "sidestr:t", |_| {
            Ok(MirrorChain {
                id: "sidestr:t".into(),
                signer: Some("ee".repeat(32)),
            })
        })
        .unwrap_err();
        assert!(
            e.to_string().contains("no mirror it names checks out"),
            "{e}"
        );
        assert!(
            e.to_string()
                .contains("signer eeeeeeee… is not the announcer"),
            "{e}"
        );
        let e = choose_mirror(&p, "sidestr:t", |_| Err("404".into())).unwrap_err();
        assert!(
            e.to_string()
                .contains("https://a.example/siding: 404; https://b.example/siding: 404"),
            "{e}"
        );
        // the right signer but another chain's document is not enough
        let e = choose_mirror(&p, "sidestr:t", |_| {
            Ok(MirrorChain {
                id: "sidestr:other".into(),
                signer: Some(signer().pubkey_hex_ok()),
            })
        })
        .unwrap_err();
        assert!(matches!(e, Error::NoMirror { .. }));
        let mut none = p.clone();
        none.mirrors.clear();
        assert!(choose_mirror(&none, "sidestr:t", |_| Err("x".into()))
            .unwrap_err()
            .to_string()
            .contains("no mirrors named"));
    }

    #[test]
    fn judging_a_mirror() {
        let p = parse_tip(&v2()).unwrap();
        let v = judge_mirror(Some(&p), 12, Some(&h(3, 164)));
        assert_eq!(
            (v.ok(), v.to_string().as_str()),
            (
                Some(true),
                "the mirror matches the signer's announcement of 12"
            )
        );
        let v = judge_mirror(Some(&p), 11, Some(&h(2, 164)));
        assert_eq!(
            (v.ok(), v.to_string().as_str()),
            (
                Some(true),
                "the mirror is 1 block(s) behind the announcement"
            )
        );
        let v = judge_mirror(Some(&p), 12, Some(&h(9, 164)));
        assert_eq!(
            (v.ok(), v.to_string().as_str()),
            (
                Some(false),
                "the mirror's block 12 is not the one the signer announced"
            )
        );
        let v = judge_mirror(Some(&p), 13, Some(&h(3, 164)));
        assert_eq!(
            (v.ok(), v.to_string().as_str()),
            (
                Some(false),
                "the mirror is ahead of the signer's announcement (13 > 12)"
            )
        );
        let v = judge_mirror(None, 12, Some(&h(3, 164)));
        assert_eq!(
            (v.ok(), v.to_string().as_str()),
            (None, "no announcement to compare with")
        );
        // below the window: height alone, as upstream (i < 0 skips the compare)
        assert_eq!(
            judge_mirror(Some(&p), 2, Some("ff")),
            Verdict::Behind { blocks: 10 }
        );
        assert_eq!(
            judge_mirror(Some(&p), 12, None),
            Verdict::Matches { height: 12 }
        );
    }

    #[test]
    fn newest_takes_the_highest_tip_then_the_latest_and_only_the_known_signer() {
        let mk = |tip: u32, at: u64, s: &SecretKeySigner| {
            sign_tip(
                s,
                &TipTemplate::new("sidestr:t", tip, vec![], vec![]).unwrap(),
                at,
            )
            .unwrap()
        };
        let other = SecretKeySigner::from_hex(&"09".repeat(32)).unwrap();
        let evs = vec![
            mk(5, 10, &signer()),
            mk(7, 5, &signer()),
            mk(7, 6, &signer()),
            mk(9, 1, &other),
        ];
        let b = newest(&evs, "sidestr:t", None).unwrap();
        assert_eq!(
            (b.tip, b.pubkey.as_str()),
            (9, other.pubkey_hex_ok().as_str())
        );
        let b = newest(&evs, "sidestr:t", Some(&signer().pubkey_hex_ok())).unwrap();
        assert_eq!((b.tip, b.created_at), (7, 6));
        assert!(newest(&evs, "sidestr:u", None).is_none());
        let mut forged = evs[3].clone();
        forged.tags.iter_mut().find(|t| t[0] == "tip").unwrap()[1] = "99".into();
        assert_eq!(newest(&[forged], "sidestr:t", None), None);
    }

    impl SecretKeySigner {
        fn pubkey_hex_ok(&self) -> String {
            self.pubkey_hex().unwrap()
        }
    }
}
