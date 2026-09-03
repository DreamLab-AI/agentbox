//! Single-file safety: which references a diagram may carry.
//!
//! Everything is inert text here. No URL is resolved, fetched or opened; the
//! rules only decide whether a reference is local, an inline image, or the one
//! approved remote stylesheet.

struct Url {
    scheme: String,
    host: Option<String>,
    port: Option<String>,
    path: String,
    fragment: String,
}

/// A `urllib.parse.urlparse` subset: enough to answer the Google Fonts test.
fn parse_url(value: &str) -> Option<Url> {
    let (without_fragment, fragment) = match value.split_once('#') {
        Some((head, tail)) => (head, tail.to_string()),
        None => (value, String::new()),
    };
    let without_query = without_fragment
        .split_once('?')
        .map(|(head, _)| head)
        .unwrap_or(without_fragment);
    let (scheme, rest) = match without_query.find(':') {
        Some(index)
            if index > 0
                && without_query[..index]
                    .chars()
                    .next()
                    .map(|ch| ch.is_ascii_alphabetic())
                    .unwrap_or(false)
                && without_query[..index]
                    .chars()
                    .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '+' | '-' | '.')) =>
        {
            (
                without_query[..index].to_lowercase(),
                &without_query[index + 1..],
            )
        }
        _ => (String::new(), without_query),
    };
    let (host, port, path) = if let Some(authority) = rest.strip_prefix("//") {
        let end = authority.find(['/', '?', '#']).unwrap_or(authority.len());
        let (netloc, path) = authority.split_at(end);
        let netloc = netloc
            .rsplit_once('@')
            .map(|(_, tail)| tail)
            .unwrap_or(netloc);
        let (host, port) = match netloc.rsplit_once(':') {
            Some((host, port)) if !host.contains(']') || netloc.ends_with(']') => {
                (host.to_string(), Some(port.to_string()))
            }
            _ => (netloc.to_string(), None),
        };
        (Some(host), port, path.to_string())
    } else {
        (None, None, rest.to_string())
    };
    Some(Url {
        scheme,
        host,
        port,
        path,
        fragment,
    })
}

/// `is_approved_google_fonts_stylesheet`.
pub fn is_approved_google_fonts_stylesheet(value: &str) -> bool {
    let Some(url) = parse_url(value) else {
        return false;
    };
    // `parsed.port is None` — any explicit port disqualifies the URL.
    if url.port.is_some() {
        return false;
    }
    url.scheme == "https"
        && url
            .host
            .as_ref()
            .map(|host| host.to_lowercase() == "fonts.googleapis.com")
            .unwrap_or(false)
        && url.path == "/css2"
        && url.fragment.is_empty()
}

fn first_80(value: &str) -> String {
    value.chars().take(80).collect()
}

/// `reference_error`.
pub fn reference_error(tag: &str, rel: &str, value: &str) -> Option<String> {
    let stripped = value.trim();
    let lowered = stripped.to_lowercase();
    if stripped.is_empty() || stripped.starts_with('#') {
        return None;
    }
    if lowered.starts_with("javascript:") || lowered.starts_with("data:text/html") {
        return Some(format!("executable URL on <{tag}>: {}", first_80(stripped)));
    }
    let scheme_like = stripped
        .split_once('/')
        .map(|(head, _)| head)
        .unwrap_or(stripped)
        .contains(':');
    let remote = lowered.starts_with("http://")
        || lowered.starts_with("https://")
        || lowered.starts_with("//")
        || (scheme_like && !lowered.starts_with("data:"));
    if !remote {
        if lowered.starts_with("data:") && !lowered.starts_with("data:image/") {
            return Some(format!(
                "non-image data URL on <{tag}>: {}",
                first_80(stripped)
            ));
        }
        return None;
    }
    if tag == "link"
        && rel
            .to_lowercase()
            .split_whitespace()
            .any(|token| token == "stylesheet")
    {
        if is_approved_google_fonts_stylesheet(stripped) {
            return None;
        }
        return Some(format!(
            "remote stylesheet is not the approved Google Fonts /css2 URL: {}",
            first_80(stripped)
        ));
    }
    Some(format!(
        "remote reference on <{tag}>: {}",
        first_80(stripped)
    ))
}
