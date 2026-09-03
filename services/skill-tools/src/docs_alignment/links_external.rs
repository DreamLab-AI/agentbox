//! External-URL HEAD-check pass for `--check-external`
//! (`validate_links.py`'s `requests.head(target, timeout=5, allow_redirects=True)`,
//! ported to an async `reqwest::Client`).
//!
//! `reqwest`'s default client follows redirects (up to its default policy
//! limit), matching `allow_redirects=True`; the method is HEAD, matching
//! Python, and the request timeout is 5 seconds as in the original.

use std::time::Duration;

use super::models::LinkInfo;

/// Send a HEAD request to every `external`-typed link and mark it invalid on
/// a >=400 status or a request error, mirroring `LinkValidator.validate_link`'s
/// external branch exactly.
pub async fn validate_external_links(links: &mut [LinkInfo]) {
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            // Mirrors Python falling back to "REQUESTS_AVAILABLE = False": if we
            // cannot even build a client, leave every external link as-is
            // (is_valid stays true, matching the "check skipped" behaviour).
            eprintln!("Warning: could not build HTTP client for --check-external: {e}");
            return;
        }
    };

    for link in links.iter_mut() {
        if link.link_type != "external" {
            continue;
        }

        match client.head(&link.link_target).send().await {
            Ok(resp) => {
                let status = resp.status().as_u16();
                if status >= 400 {
                    link.is_valid = false;
                    link.error_message = Some(format!("HTTP {status}"));
                }
            }
            Err(e) => {
                link.is_valid = false;
                link.error_message = Some(e.to_string());
            }
        }
    }
}
