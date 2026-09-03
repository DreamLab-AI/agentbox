//! Organisation and proper names that keep their American spelling.
//!
//! A name is a name. The World Health Organization is spelled with a `z` by
//! charter, the Australian Labor Party dropped the `u` in 1912, and Pearl
//! Harbor is a place. Correcting any of them is not enforcing a house style, it
//! is getting a fact wrong, so gazetteer matches are excluded from every rule
//! before anything else runs.
//!
//! The built-in list is deliberately short and defensible: names that actually
//! collide with a dialect pair and that a British writer plausibly uses. It is
//! not an attempt to enumerate the world's institutions. Callers extend it
//! through [`UkOptions::with_organisations`](crate::UkOptions::with_organisations),
//! which is the supported route for a house list.
//!
//! Matching is **case-sensitive** and bounded by word edges. That is the point:
//! *World Health Organization* is protected, while a lowercase *organization*
//! in running prose is still a finding.

/// Names whose American spelling is correct because it is their name.
///
/// Longer names are listed alongside the shorter forms they contain, and
/// matching prefers the longest, so *International Labour Organization* is
/// recognised as one name rather than as a stray *Organization*.
pub const ORGANISATIONS: &[&str] = &[
    // Health, standards and the UN system.
    "World Health Organization",
    "Pan American Health Organization",
    "Food and Agriculture Organization",
    "International Labour Organization",
    "International Labor Organization",
    "International Maritime Organization",
    "International Civil Aviation Organization",
    "World Meteorological Organization",
    "World Intellectual Property Organization",
    "International Organization for Standardization",
    "United Nations Educational, Scientific and Cultural Organization",
    "Organization of American States",
    "Organization for Economic Co-operation and Development",
    "North Atlantic Treaty Organization",
    "World Trade Organization",
    // United States government.
    "Department of Defense",
    "Secretary of Defense",
    "Defense Advanced Research Projects Agency",
    "Defense Intelligence Agency",
    "Department of Labor",
    "Bureau of Labor Statistics",
    "Centers for Disease Control and Prevention",
    "Center for Disease Control",
    "National Center for Health Statistics",
    "Federal Reserve Center",
    // Politics.
    "Australian Labor Party",
    "Labor Party",
    "Labor Day",
    // Places and institutions.
    "Pearl Harbor",
    "Rockefeller Center",
    "Lincoln Center",
    "World Trade Center",
    "Kennedy Center",
    "Center for Strategic and International Studies",
    "Johnson Space Center",
    "Smithsonian Center",
    // Titles and works.
    "The Color Purple",
    "Color Purple",
    "American Theater Wing",
    // Technology terms of art that read as names.
    "Program Files",
    "Color Management Module",
];

/// A resolved gazetteer: the built-in names plus any the caller added.
///
/// Build one with [`Gazetteer::new`] and keep it for the life of a check;
/// construction sorts the names so the longest match wins.
#[derive(Debug, Clone)]
pub struct Gazetteer {
    names: Vec<String>,
}

impl Default for Gazetteer {
    fn default() -> Self {
        Self::new(&[] as &[String])
    }
}

impl Gazetteer {
    /// Combine the built-in names with `extra`.
    ///
    /// Duplicates are dropped, and names are ordered longest first so that a
    /// name containing another is matched whole.
    pub fn new<S: AsRef<str>>(extra: &[S]) -> Self {
        let mut names: Vec<String> = ORGANISATIONS
            .iter()
            .map(|name| (*name).to_string())
            .chain(extra.iter().map(|name| name.as_ref().to_string()))
            .filter(|name| !name.trim().is_empty())
            .collect();
        names.sort_unstable();
        names.dedup();
        names.sort_by(|a, b| b.len().cmp(&a.len()).then_with(|| a.cmp(b)));
        Self { names }
    }

    /// How many names the gazetteer holds.
    pub fn len(&self) -> usize {
        self.names.len()
    }

    /// Whether the gazetteer holds no names at all.
    pub fn is_empty(&self) -> bool {
        self.names.is_empty()
    }

    /// Byte ranges in `document` covered by a gazetteer name.
    ///
    /// Ranges may be returned in any order and may abut; the caller merges
    /// them along with the other exclusion sources.
    ///
    /// # Examples
    ///
    /// ```
    /// use prose_sanitiser_uk::gazetteer::Gazetteer;
    ///
    /// let gazetteer = Gazetteer::default();
    /// let text = "The World Health Organization met to discuss color.";
    /// let spans = gazetteer.spans(text);
    /// assert_eq!(spans.len(), 1);
    /// assert_eq!(&text[spans[0].0..spans[0].1], "World Health Organization");
    /// ```
    pub fn spans(&self, document: &str) -> Vec<(usize, usize)> {
        let mut spans: Vec<(usize, usize)> = Vec::new();
        for name in &self.names {
            let mut from = 0usize;
            while let Some(offset) = document[from..].find(name.as_str()) {
                let start = from + offset;
                let end = start + name.len();
                if is_word_bounded(document, start, end) {
                    spans.push((start, end));
                }
                from = start + 1;
                if from >= document.len() {
                    break;
                }
            }
        }
        spans
    }
}

/// Whether `start..end` is bounded by non-word characters on both sides.
fn is_word_bounded(document: &str, start: usize, end: usize) -> bool {
    let before = document[..start].chars().next_back();
    let after = document[end..].chars().next();
    let is_word = |c: char| c.is_alphanumeric() || c == '_';
    !before.is_some_and(is_word) && !after.is_some_and(is_word)
}
