//! URL policy for the website audit: scheme, origin and public-address checks.
//!
//! The audit fetches attacker-nominated URLs, so every hop is validated before
//! a socket is opened: only http(s), no credentials, same-origin (plus the
//! ordinary http→https upgrade), and only globally routable addresses. Pinning
//! the connection to the addresses validated here is what stops a DNS rebind
//! between the check and the connect.

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, ToSocketAddrs};

/// A normalised `(scheme, host, port)` origin.
pub type UrlOrigin = (String, String, u16);

/// Split a URL into scheme, host, port, and request target.
///
/// Deliberately minimal rather than a full URL crate: the audit only ever
/// handles absolute http(s) URLs, and anything it cannot parse confidently is
/// rejected instead of guessed at.
pub struct ParsedUrl {
    pub scheme: String,
    pub host: String,
    pub port: u16,
    pub path: String,
    pub query: Option<String>,
    pub has_credentials: bool,
}

/// Parse an absolute http(s) URL.
pub fn parse_url(url: &str) -> Result<ParsedUrl, String> {
    let (scheme, rest) = url
        .split_once("://")
        .ok_or_else(|| format!("unsupported URL scheme: {}", scheme_of(url)))?;
    let scheme = scheme.to_lowercase();

    let (authority, tail) = match rest.find(['/', '?', '#']) {
        Some(index) => (&rest[..index], &rest[index..]),
        None => (rest, ""),
    };

    let (credentials, hostport) = match authority.rsplit_once('@') {
        Some((credentials, hostport)) => (Some(credentials), hostport),
        None => (None, authority),
    };

    let (host, port_text) = if let Some(stripped) = hostport.strip_prefix('[') {
        // IPv6 literal.
        let (host, tail) = stripped
            .split_once(']')
            .ok_or_else(|| "invalid URL port: unterminated IPv6 literal".to_string())?;
        (host.to_string(), tail.strip_prefix(':').map(str::to_string))
    } else {
        match hostport.rsplit_once(':') {
            Some((host, port)) => (host.to_string(), Some(port.to_string())),
            None => (hostport.to_string(), None),
        }
    };

    let port = match port_text {
        Some(text) if text.is_empty() => default_port(&scheme),
        Some(text) => text
            .parse::<u16>()
            .map_err(|error| format!("invalid URL port: {error}"))?,
        None => default_port(&scheme),
    };

    let (path_part, fragmentless) = match tail.split_once('#') {
        Some((head, _)) => (head, true),
        None => (tail, false),
    };
    let _ = fragmentless;
    let (path, query) = match path_part.split_once('?') {
        Some((path, query)) => (path.to_string(), Some(query.to_string())),
        None => (path_part.to_string(), None),
    };

    Ok(ParsedUrl {
        scheme,
        host: host.trim_end_matches('.').to_lowercase(),
        port,
        path: if path.is_empty() {
            "/".to_string()
        } else {
            path
        },
        query,
        has_credentials: credentials.is_some(),
    })
}

fn scheme_of(url: &str) -> String {
    match url.split_once(':') {
        Some((scheme, _)) if !scheme.is_empty() => scheme.to_lowercase(),
        _ => "(missing)".to_string(),
    }
}

fn default_port(scheme: &str) -> u16 {
    if scheme == "https" {
        443
    } else {
        80
    }
}

/// Return a normalised HTTP(S) origin, or reject an unsafe URL form.
pub fn url_origin(url: &str) -> Result<UrlOrigin, String> {
    let parsed = parse_url(url)?;
    if parsed.scheme != "http" && parsed.scheme != "https" {
        return Err(format!("unsupported URL scheme: {}", parsed.scheme));
    }
    if parsed.has_credentials {
        return Err("credentials in URLs are not allowed".to_string());
    }
    if parsed.host.is_empty() {
        return Err("URL has no hostname".to_string());
    }
    Ok((parsed.scheme, parsed.host, parsed.port))
}

/// Allow same-origin URLs plus a normal HTTP-to-HTTPS upgrade.
pub fn origin_allowed(candidate: &UrlOrigin, expected: &UrlOrigin) -> bool {
    if candidate == expected {
        return true;
    }
    expected.0 == "http"
        && expected.2 == 80
        && candidate.0 == "https"
        && candidate.2 == 443
        && candidate.1 == expected.1
}

/// Is this address globally routable? Mirrors Python's `ip_address.is_global`.
///
/// Rust's own `is_global` is still unstable, so the ranges are spelled out.
pub fn is_global(address: IpAddr) -> bool {
    match address {
        IpAddr::V4(v4) => is_global_v4(v4),
        IpAddr::V6(v6) => {
            if let Some(mapped) = v6.to_ipv4_mapped() {
                return is_global_v4(mapped);
            }
            is_global_v6(v6)
        }
    }
}

fn is_global_v4(address: Ipv4Addr) -> bool {
    let octets = address.octets();
    !(address.is_unspecified()
        || address.is_loopback()
        || address.is_private()
        || address.is_link_local()
        || address.is_broadcast()
        || address.is_documentation()
        || address.is_multicast()
        // 100.64.0.0/10 carrier-grade NAT (shared address space).
        || (octets[0] == 100 && (64..128).contains(&octets[1]))
        // 192.0.0.0/24 IETF protocol assignments.
        || (octets[0] == 192 && octets[1] == 0 && octets[2] == 0)
        // 198.18.0.0/15 benchmarking.
        || (octets[0] == 198 && (octets[1] == 18 || octets[1] == 19))
        // 240.0.0.0/4 reserved.
        || octets[0] >= 240)
}

fn is_global_v6(address: Ipv6Addr) -> bool {
    let segments = address.segments();
    !(address.is_unspecified()
        || address.is_loopback()
        || address.is_multicast()
        // fc00::/7 unique local.
        || (segments[0] & 0xFE00) == 0xFC00
        // fe80::/10 link local.
        || (segments[0] & 0xFFC0) == 0xFE80
        // 2001:db8::/32 documentation.
        || (segments[0] == 0x2001 && segments[1] == 0x0DB8)
        // 100::/64 discard-only.
        || (segments[0] == 0x0100 && segments[1..4].iter().all(|part| *part == 0)))
}

/// Resolve an origin to validated public numeric addresses.
///
/// A hostname that resolves to *any* non-public address is refused outright,
/// not merely filtered: a name with one private answer is not a name the audit
/// should be following.
pub fn resolve_public_addresses(origin: &UrlOrigin) -> Result<Vec<IpAddr>, String> {
    let (_scheme, host, port) = origin;
    let host_for_ip = host.split('%').next().unwrap_or(host);

    let raw: Vec<IpAddr> = match host_for_ip.parse::<IpAddr>() {
        Ok(address) => vec![address],
        Err(_) => (host.as_str(), *port)
            .to_socket_addrs()
            .map_err(|error| format!("cannot resolve hostname {host}: {error}"))?
            .map(|socket| socket.ip())
            .collect(),
    };

    let mut addresses: Vec<IpAddr> = Vec::new();
    for address in raw {
        let address = match address {
            IpAddr::V6(v6) => match v6.to_ipv4_mapped() {
                Some(mapped) => IpAddr::V4(mapped),
                None => IpAddr::V6(v6),
            },
            other => other,
        };
        if !is_global(address) {
            return Err(format!("refusing non-public address for {host}: {address}"));
        }
        if !addresses.contains(&address) {
            addresses.push(address);
        }
    }
    if addresses.is_empty() {
        return Err(format!("hostname resolved to no IP addresses: {host}"));
    }
    Ok(addresses)
}

/// Validate URL policy and bind it to numeric public IPs.
pub fn validated_target(
    url: &str,
    expected_origin: Option<&UrlOrigin>,
) -> Result<(UrlOrigin, Vec<IpAddr>), String> {
    let origin = url_origin(url)?;
    if let Some(expected) = expected_origin {
        if !origin_allowed(&origin, expected) {
            return Err(format!(
                "cross-origin URL is not allowed: {}://{}:{}",
                origin.0, origin.1, origin.2
            ));
        }
    }
    let addresses = resolve_public_addresses(&origin)?;
    Ok((origin, addresses))
}

/// Resolve a possibly relative `Location` header against the current URL.
pub fn join_url(base: &str, location: &str) -> String {
    if location.contains("://") {
        return location.to_string();
    }
    let Ok(parsed) = parse_url(base) else {
        return location.to_string();
    };
    let authority = if (parsed.scheme == "http" && parsed.port == 80)
        || (parsed.scheme == "https" && parsed.port == 443)
    {
        parsed.host.clone()
    } else {
        format!("{}:{}", parsed.host, parsed.port)
    };
    if let Some(rest) = location.strip_prefix("//") {
        return format!("{}://{rest}", parsed.scheme);
    }
    if location.starts_with('/') {
        return format!("{}://{authority}{location}", parsed.scheme);
    }
    let base_dir = match parsed.path.rfind('/') {
        Some(index) => &parsed.path[..=index],
        None => "/",
    };
    format!("{}://{authority}{base_dir}{location}", parsed.scheme)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_hosts_ports_and_targets() {
        let parsed = parse_url("https://example.com/a/b?q=1#frag").unwrap();
        assert_eq!(parsed.scheme, "https");
        assert_eq!(parsed.host, "example.com");
        assert_eq!(parsed.port, 443);
        assert_eq!(parsed.path, "/a/b");
        assert_eq!(parsed.query.as_deref(), Some("q=1"));

        let bare = parse_url("http://example.com").unwrap();
        assert_eq!(bare.port, 80);
        assert_eq!(bare.path, "/");

        let explicit = parse_url("http://example.com:8080/x").unwrap();
        assert_eq!(explicit.port, 8080);

        let v6 = parse_url("http://[2001:4860:4860::8888]:8080/x").unwrap();
        assert_eq!(v6.host, "2001:4860:4860::8888");
        assert_eq!(v6.port, 8080);
    }

    #[test]
    fn rejects_unsafe_url_forms() {
        assert!(url_origin("file:///etc/passwd").is_err());
        assert!(url_origin("ftp://example.com/x").is_err());
        assert!(url_origin("https://user:pass@example.com/")
            .unwrap_err()
            .contains("credentials"));
        assert!(url_origin("http://example.com:notaport/").is_err());
    }

    #[test]
    fn the_trailing_dot_and_case_are_normalised() {
        assert_eq!(
            url_origin("https://Example.COM./x").unwrap(),
            ("https".to_string(), "example.com".to_string(), 443)
        );
    }

    #[test]
    fn same_origin_and_the_http_to_https_upgrade_are_allowed() {
        let http = ("http".to_string(), "example.com".to_string(), 80);
        let https = ("https".to_string(), "example.com".to_string(), 443);
        assert!(origin_allowed(&http, &http));
        assert!(origin_allowed(&https, &http), "the ordinary upgrade");
        // But not the downgrade, a different host, or a different port.
        assert!(!origin_allowed(&http, &https));
        assert!(!origin_allowed(
            &("https".to_string(), "evil.example".to_string(), 443),
            &https
        ));
        assert!(!origin_allowed(
            &("https".to_string(), "example.com".to_string(), 8443),
            &https
        ));
    }

    #[test]
    fn private_and_reserved_addresses_are_not_global() {
        for address in [
            "127.0.0.1",
            "10.0.0.1",
            "192.168.2.132",
            "172.16.0.1",
            "169.254.169.254", // the cloud metadata endpoint
            "100.64.0.1",      // carrier-grade NAT
            "0.0.0.0",
            "224.0.0.1",
            "240.0.0.1",
            "198.18.0.1",
            "::1",
            "fe80::1",
            "fc00::1",
            "::ffff:127.0.0.1", // IPv4-mapped loopback
        ] {
            assert!(
                !is_global(address.parse().unwrap()),
                "{address} must not be treated as public"
            );
        }
    }

    #[test]
    fn ordinary_public_addresses_are_global() {
        for address in [
            "8.8.8.8",
            "1.1.1.1",
            "93.184.216.34",
            "2001:4860:4860::8888",
        ] {
            assert!(is_global(address.parse().unwrap()), "{address} is public");
        }
    }

    #[test]
    fn resolving_a_private_literal_is_refused() {
        let origin = ("http".to_string(), "127.0.0.1".to_string(), 80);
        let error = resolve_public_addresses(&origin).unwrap_err();
        assert!(error.contains("refusing non-public address"));
    }

    #[test]
    fn a_cross_origin_hop_is_refused_before_any_lookup() {
        let expected = ("https".to_string(), "example.com".to_string(), 443);
        let error = validated_target("https://evil.example/x", Some(&expected)).unwrap_err();
        assert!(error.starts_with("cross-origin URL is not allowed"));
    }

    #[test]
    fn relative_locations_resolve_against_the_current_url() {
        assert_eq!(
            join_url("https://example.com/a/b", "/c"),
            "https://example.com/c"
        );
        assert_eq!(
            join_url("https://example.com/a/b", "c"),
            "https://example.com/a/c"
        );
        assert_eq!(
            join_url("https://example.com/a/b", "//other.example/x"),
            "https://other.example/x"
        );
        assert_eq!(
            join_url("https://example.com/a", "https://x.example/y"),
            "https://x.example/y"
        );
        assert_eq!(
            join_url("http://example.com:8080/a/b", "/c"),
            "http://example.com:8080/c"
        );
    }
}
