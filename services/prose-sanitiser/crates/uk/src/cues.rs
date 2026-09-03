//! Context words that tell one VarCon sense from another.
//!
//! Each table row is keyed on VarCon's **own** usage gloss, verbatim, so adding
//! support for a new sense-dependent pair means adding cues rather than writing
//! code. If a gloss has no row, senses carrying it score zero and the word ends
//! up reported as an unresolved judgement call, which is the safe outcome.
//!
//! Cues are matched case-insensitively against the word tokens of the sentence
//! containing the occurrence. One pseudo-cue exists: [`NUMERIC_CUE`] matches
//! when the occurrence is immediately preceded by a number, which is the single
//! strongest signal that *meter* is the unit and not the instrument.
//!
//! The table is `rustfmt::skip`ed on purpose. It is data, and a word list reads
//! far better packed than exploded one entry to a line.

/// Pseudo-cue: the occurrence is directly preceded by a numeral.
pub const NUMERIC_CUE: &str = "#num";

/// Glosses that win when nothing else in the sentence discriminates.
///
/// Some sense pairs are not a coin toss. *Check* means "verify" far more often
/// than it means a bank instrument; *story* is a narrative far more often than
/// a floor of a building; *draft* is a document far more often than a current
/// of air. Without a prior, every unremarkable use of those words is reported
/// as an unresolved judgement call, which on a real corpus buries the findings
/// that matter under the ones that do not. Measured over 414,000 words of
/// British technical prose, the prior removes 210 reports of *check* alone.
///
/// The prior is deliberately weak: one point, beaten by a single cue word for a
/// competing sense, so "she wrote a check to the bank" still resolves the other
/// way. It breaks ties; it does not overrule evidence.
pub const DEFAULT_GLOSSES: &[&str] = &["verify", "book", "writing"];

/// The score a gloss in [`DEFAULT_GLOSSES`] starts with.
pub const DEFAULT_GLOSS_BONUS: i32 = 1;

/// Whether `gloss` is the dominant reading of its word.
pub fn is_default_gloss(gloss: &str) -> bool {
    DEFAULT_GLOSSES.contains(&gloss)
}

/// Cue words per VarCon usage gloss.
///
/// The glosses are quoted exactly as VarCon writes them, including the odd ones
/// (`":1"`, `"otherwise, most uses"`), because an exact key is the only key that
/// cannot silently stop matching when the data is updated.
#[rustfmt::skip]
pub const CUES: &[(&str, &[&str])] = &[
    // meter / metre: the trap that ruins every naive rule.
    ("measuring device", &[
        "gas", "water", "electric", "electricity", "parking", "taxi", "smart", "light", "flow",
        "power", "volt", "voltage", "reading", "readings", "reads", "read", "utility",
        "prepayment", "billing", "installed", "installer", "dial", "ammeter", "wattmeter",
    ]),
    ("metric meter, rhythmic pattern", &[
        NUMERIC_CUE, "square", "cubic", "per", "metres", "metre", "kilometre", "kilometres",
        "centimetre", "millimetre", "wide", "long", "tall", "deep", "high", "height", "width",
        "depth", "distance", "above", "below", "sea", "level", "iambic", "trochaic", "verse",
        "poem", "poetry", "rhythm", "stanza", "sprint", "freestyle",
    ]),

    // micrometer / micrometre.
    ("gauge", &[
        "gauge", "calliper", "caliper", "screw", "machinist", "workshop", "thimble", "spindle",
        "anvil", "measure", "measuring", "tool", "lathe",
    ]),
    ("metric meter", &[
        NUMERIC_CUE, "wavelength", "diameter", "thickness", "particle", "particles", "micron",
        "microns", "nanometre", "resolution", "aerosol", "filter", "per",
    ]),

    // program / programme.
    ("computer program", &[
        "computer", "software", "code", "source", "binary", "executable", "compile", "compiled",
        "compiler", "run", "runs", "install", "installed", "script", "scripts", "application",
        "app", "python", "rust", "java", "javascript", "debug", "debugger", "algorithm",
        "memory", "bug", "bugs", "developer", "programming", "library", "function", "api",
        "kernel", "terminal", "shell", "daemon", "service", "process", "supervisor", "systemd",
    ]),

    // story / storey.
    ("book", &[
        "book", "books", "novel", "tale", "tales", "told", "tell", "telling", "short", "news",
        "article", "writer", "character", "characters", "plot", "fiction", "bedtime",
        "narrative", "anecdote", "headline", "reporter", "cover", "user", "epic", "backlog",
        "sprint", "acceptance",
    ]),
    ("level of building", &[
        NUMERIC_CUE, "building", "buildings", "floor", "floors", "storey", "storeys", "tall",
        "high", "block", "house", "upper", "lower", "top", "ground", "flat", "apartment",
        "terrace", "tower", "lift", "staircase", "roof",
    ]),

    // tire / tyre.
    ("exhausted", &[
        "never", "quickly", "easily", "soon", "grew", "grow", "growing", "weary", "bored",
        "eventually", "readers", "audience",
    ]),
    ("wheel", &[
        "car", "cars", "bike", "bicycle", "wheel", "wheels", "flat", "puncture", "punctured",
        "spare", "pressure", "rubber", "tread", "vehicle", "truck", "lorry", "van", "garage",
        "inflate", "inflated", "blowout", "axle", "rim", "winter",
    ]),

    // check / cheque.
    ("bank", &[
        "bank", "banks", "cash", "cashed", "wrote", "write", "writing", "pay", "paid",
        "payment", "deposit", "deposited", "endorse", "endorsed", "blank", "signed", "sign",
        "cheque", "chequebook", "account", "payee", "bounced", "posted", "mailed",
    ]),
    ("verify", &[
        "verify", "verified", "validate", "validation", "confirm", "ensure", "test", "tests",
        "health", "sanity", "status", "gate", "gates", "pass", "passes", "fail", "fails",
        "failed", "error", "errors", "lint", "run", "runs", "script", "whether", "before",
        "again", "quick", "double", "cross", "spot", "list", "box", "boxes", "guard", "assert",
        "audit", "review", "inspect", "compliance", "safety", "integrity", "consistency",
        "preflight",
    ]),
    ("pattern", &["pattern", "patterned", "board", "cloth", "tile", "tiles", "flag", "tablecloth"]),

    // curb / kerb.
    ("restrain", &[
        "enthusiasm", "spending", "inflation", "appetite", "growth", "emissions", "behaviour",
        "excess", "excesses", "ambition", "urge", "immigration", "costs", "abuse",
        "speculation", "instinct", "temper",
    ]),
    ("street edge", &[
        "street", "road", "pavement", "sidewalk", "kerb", "gutter", "stone", "parked",
        "crossing", "crawl", "wheel", "tyre", "verge", "drain", "stepped", "stumbled",
    ]),

    // draft / draught.
    ("current of air", &[
        "air", "cold", "cool", "chimney", "window", "door", "excluder", "beer", "ale", "pint",
        "cask", "keg", "tap", "horse", "horses", "breeze", "chilly", "proof",
    ]),
    ("writing", &[
        "document", "documents", "first", "second", "final", "version", "paper", "bill",
        "manuscript", "email", "letter", "revise", "revised", "edit", "chapter", "report",
        "proposal", "text", "wrote", "write", "writing", "circulated", "comments", "adr",
        "record", "records", "spec", "plan", "note", "notes", "section", "initial", "rough",
        "working", "outline", "prd", "doc", "docs",
    ]),

    // analog / analogue.
    ("analogous", &[
        "analogous", "counterpart", "equivalent", "similar", "parallel", "corresponds",
        "biological", "structural", "chemical", "synthetic",
    ]),
    ("vs. digital", &[
        "digital", "signal", "signals", "audio", "circuit", "circuits", "electronics",
        "synthesizer", "synth", "converter", "waveform", "voltage", "tape", "vinyl",
        "oscilloscope", "modem", "sampling",
    ]),

    // prize / prise.
    ("reward", &[
        "won", "win", "winner", "winners", "award", "awarded", "money", "competition",
        "coveted", "valuable", "cherish", "cherished", "nobel", "booker", "first",
    ]),
    ("otherwise", &["open", "apart", "lid", "crowbar", "loose", "free", "off", "hinge", "levered"]),

    // groin / groyne.
    ("body part", &["injury", "strain", "strained", "muscle", "pain", "pulled", "injured", "hernia"]),
    ("wall", &["sea", "beach", "coastal", "shore", "erosion", "breakwater", "timber", "shingle"]),

    // jibe / gybe.
    ("agree", &["agree", "agrees", "statement", "statements", "facts", "account", "testimony"]),
    ("sailing", &["sail", "sailing", "boat", "yacht", "wind", "boom", "tack", "helm", "downwind"]),

    // ass / arse, lupine / lupin, mat / matt, sake / saki.
    ("donkey", &["donkey", "mule", "animal", "beast", "farm", "cart", "burden"]),
    ("plant", &["garden", "flower", "flowers", "plant", "plants", "seeds", "border", "bloom"]),
    ("wolfish", &["wolf", "wolves", "predatory", "feral", "howl", "grin"]),
    ("make matte", &["matte", "finish", "paint", "varnish", "surface", "emulsion", "sheen"]),
    ("otherwise, most uses", &["floor", "door", "welcome", "yoga", "exercise", "rug", "beer"]),
    (":1", &["for", "goodness", "heaven", "argument", "own", "god", "old", "times"]),
    (":2", &["rice", "wine", "drink", "japanese", "warm", "bottle", "brewery", "cup"]),
    ("trademark", &["trademark", "brand", "registered", "device"]),
];

/// The cue list for a VarCon gloss, empty when the gloss has no row.
pub fn cues_for(gloss: &str) -> &'static [&'static str] {
    CUES.iter()
        .find(|(key, _)| *key == gloss)
        .map_or(&[] as &[&str], |(_, cues)| *cues)
}
