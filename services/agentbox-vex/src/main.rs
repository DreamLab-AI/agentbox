//! Project-specific, digest-scoped OpenVEX and build-evidence tooling.
//!
//! Assessments concern immutable shipped files. They do not describe a host's
//! kernel, mounted configuration, sidecars or software installed after boot.

use clap::{Parser, Subcommand};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::error::Error;
use std::fs;
use std::path::{Path, PathBuf};

type Result<T> = std::result::Result<T, Box<dyn Error>>;
const CVE: &str = "CVE-2007-2768";
const REVIEWED_NIXPKGS: &str = "9ae611a455b90cf061d8f332b977e387bda8e1ca";
const REVIEWED_OPENSSH: &str = "10.3p1";
const BUNDLE_FILES: &[&str] = &[
    "image.json",
    "build-evidence.json",
    "assessment.json",
    "sbom.nix.cyclonedx.json",
    "vex.openvex.json",
];

#[derive(Parser)]
#[command(
    version,
    about = "Generate and verify Agentbox image-scoped OpenVEX evidence"
)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Evaluate reviewed rules against the complete shipped payload and SBOM.
    Report {
        #[arg(long)]
        evidence: PathBuf,
        #[arg(long)]
        sbom: PathBuf,
        #[arg(long)]
        subject: Option<String>,
        #[arg(long)]
        output: PathBuf,
        /// Pinned Syft binary for scoped SPDX and native scanner exports.
        #[arg(long)]
        syft: Option<PathBuf>,
    },
    /// Verify subject and all required artefact hashes before applying VEX.
    Verify {
        #[arg(long)]
        bundle: PathBuf,
        #[arg(long)]
        subject: String,
    },
    /// Re-scope a verified assessment to a published image's manifest digest.
    Bind {
        #[arg(long)]
        bundle: PathBuf,
        #[arg(long)]
        subject: String,
        #[arg(long)]
        manifest: PathBuf,
        #[arg(long)]
        config: PathBuf,
        #[arg(long)]
        output: PathBuf,
        /// Required when rebinding a report containing scoped SPDX exports.
        #[arg(long)]
        syft: Option<PathBuf>,
    },
    /// Prove that a published manifest/config represents the assessed image.
    CheckImage {
        #[arg(long)]
        bundle: PathBuf,
        #[arg(long)]
        manifest: PathBuf,
        #[arg(long)]
        config: PathBuf,
        #[arg(long)]
        subject: String,
    },
}

fn read_json(path: &Path) -> Result<Value> {
    Ok(serde_json::from_slice(&fs::read(path)?)?)
}

fn write_json(path: &Path, value: &Value) -> Result<()> {
    let mut bytes = serde_json::to_vec_pretty(value)?;
    bytes.push(b'\n');
    fs::write(path, bytes)?;
    Ok(())
}

fn hash(bytes: &[u8]) -> String {
    format!("sha256:{}", hex::encode(Sha256::digest(bytes)))
}

fn valid_subject(subject: &str) -> Result<()> {
    let h = subject
        .strip_prefix("sha256:")
        .ok_or("Subject must be sha256:64-lowercase-hex")?;
    if h.len() != 64
        || !h
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return Err("Subject must be sha256:64-lowercase-hex".into());
    }
    Ok(())
}

fn required_str<'a>(value: &'a Value, key: &str) -> Result<&'a str> {
    value
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("Missing string {key}").into())
}

fn shipped_paths(image: &Value) -> Result<BTreeSet<String>> {
    if image["version"] != 1 || !matches!(image["arch"].as_str(), Some("amd64" | "arm64")) {
        return Err("Unsupported nix2container image version or architecture".into());
    }
    let layers = image["layers"]
        .as_array()
        .ok_or("Image has no layer list")?;
    let mut paths = BTreeSet::new();
    for layer in layers {
        valid_subject(required_str(layer, "digest")?)?;
        valid_subject(required_str(layer, "diff_ids")?)?;
        for entry in layer["paths"]
            .as_array()
            .ok_or("Layer has no payload paths")?
        {
            let path = required_str(entry, "path")?;
            let suffix = path
                .strip_prefix("/nix/store/")
                .ok_or("Payload is outside /nix/store")?;
            if suffix.len() < 34
                || suffix.as_bytes()[32] != b'-'
                || suffix.contains('/')
                || !suffix.as_bytes()[..32]
                    .iter()
                    .all(u8::is_ascii_alphanumeric)
            {
                return Err("Malformed Nix payload path".into());
            }
            paths.insert(path.to_string());
        }
    }
    if paths.is_empty() {
        return Err("Empty image payload".into());
    }
    Ok(paths)
}

fn output_paths(component: &Value) -> BTreeSet<String> {
    component["properties"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|p| p["name"] == "nix:output_path")
        .filter_map(|p| p["value"].as_str().map(str::to_owned))
        .collect()
}

// sbomnix groups derivation outputs. Keep only components with an actually
// shipped output, and trim unshipped output properties and synthetic roots.
fn scope_sbom(mut sbom: Value, shipped: &BTreeSet<String>, subject: &str) -> Result<Value> {
    if sbom["bomFormat"] != "CycloneDX" {
        return Err("Expected a CycloneDX SBOM".into());
    }
    let components = sbom["components"]
        .as_array_mut()
        .ok_or("SBOM has no components")?;
    components.retain(|c| !output_paths(c).is_disjoint(shipped));
    for component in components.iter_mut() {
        if let Some(properties) = component["properties"].as_array_mut() {
            properties.retain(|p| {
                p["name"] != "nix:output_path"
                    || p["value"].as_str().is_some_and(|v| shipped.contains(v))
            });
        }
    }
    if components.is_empty() {
        return Err("SBOM contains no shipped components".into());
    }
    // A missing inventory entry is an error, not evidence of absence. Store
    // paths with no derivation (e.g. copied sources) can be absent from sbomnix;
    // retain their complete inventory separately and never assess them.
    let refs: BTreeSet<String> = components
        .iter()
        .filter_map(|c| c["bom-ref"].as_str().map(str::to_owned))
        .collect();
    let root_ref = "agentbox-image";
    if let Some(deps) = sbom["dependencies"].as_array_mut() {
        deps.retain(|d| d["ref"].as_str().is_some_and(|r| refs.contains(r)));
        for dep in deps.iter_mut() {
            if let Some(children) = dep["dependsOn"].as_array_mut() {
                children.retain(|v| v.as_str().is_some_and(|r| refs.contains(r)));
            }
        }
        deps.push(json!({"ref":root_ref,"dependsOn":refs}));
    } else {
        sbom["dependencies"] = json!([{"ref":root_ref,"dependsOn":refs}]);
    }
    sbom["metadata"]["component"] = json!({
        "type":"container", "bom-ref":root_ref, "name":"agentbox",
        "version":subject, "purl":format!("pkg:generic/agentbox@{subject}"),
    });
    Ok(sbom)
}

fn opie_name(name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    let name = if name.len() > 33 && name.as_bytes()[32] == b'-' {
        &name[33..]
    } else {
        &name
    };
    name == "opie"
        || name.starts_with("opie-")
        || name.starts_with("opie.")
        || name.starts_with("pam_opie")
        || name.starts_with("libopie")
        || matches!(name, "opiekey" | "opiepasswd" | "opiesu")
}

fn find_opie(roots: &BTreeSet<String>) -> Result<Vec<String>> {
    let mut findings = Vec::new();
    let mut stack: Vec<PathBuf> = roots.iter().map(PathBuf::from).collect();
    while let Some(path) = stack.pop() {
        if path
            .file_name()
            .is_some_and(|s| opie_name(&s.to_string_lossy()))
        {
            findings.push(path.to_string_lossy().into_owned());
        }
        // Never follow symlinks into mutable mounts or the host. Nix targets
        // are already independent roots in the recorded image payload.
        let metadata = fs::symlink_metadata(&path)?;
        if metadata.is_dir() {
            for entry in fs::read_dir(&path)? {
                stack.push(entry?.path());
            }
        }
    }
    findings.sort();
    Ok(findings)
}

fn assess(metadata: &Value, sbom: &Value, shipped: &BTreeSet<String>, opie: &[String]) -> Value {
    let expected = format!("pkg:nix/openssh@{REVIEWED_OPENSSH}");
    let openssh: Vec<&Value> = sbom["components"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|c| c["name"].as_str().is_some_and(|n| n.starts_with("openssh")))
        .collect();
    let accepted: BTreeSet<String> = metadata["openssh"]["output_paths"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|v| v.as_str().map(str::to_owned))
        .collect();
    let flags = metadata["openssh"]["configure_flags"].as_array();
    let reviewed = metadata["nixpkgs_revision"] == REVIEWED_NIXPKGS
        && metadata["openssh"]["stock_build"] == true
        && metadata["openssh"]["version"] == REVIEWED_OPENSSH
        && flags.is_some_and(|f| {
            f.iter().any(|v| v == "--with-pam")
                && !f.iter().filter_map(Value::as_str).any(|v| {
                    v.to_ascii_lowercase().contains("opie")
                        || v.to_ascii_lowercase().contains("skey")
                })
        });
    let package_present = metadata["openssh"]["output_path"]
        .as_str()
        .is_some_and(|p| {
            shipped.contains(p) && openssh.iter().any(|c| output_paths(c).contains(p))
        });
    let matched = !openssh.is_empty()
        && openssh.iter().all(|c| {
            c["purl"] == expected
                && c["version"] == REVIEWED_OPENSSH
                && !output_paths(c).is_empty()
                && output_paths(c).is_subset(&accepted)
        });
    let (status, reason) = if !reviewed {
        (
            "under_investigation",
            "OpenSSH build identity has not been reviewed; no suppression emitted",
        )
    } else if !package_present || !matched {
        (
            "under_investigation",
            "Shipped OpenSSH and SBOM identities do not uniquely match the reviewed build",
        )
    } else if !opie.is_empty() {
        (
            "under_investigation",
            "OPIE evidence is present in the shipped payload; no suppression emitted",
        )
    } else {
        ("not_affected", "The reviewed stock OpenSSH build has no native OPIE/S-Key support and no OPIE package or PAM module is shipped")
    };
    json!({"rule":"openssh-no-opie-v1","vulnerability":CVE,"status":status,
        "reason":reason,"component_purl":expected,"opie_paths":opie,
        "scope":"immutable image payload only",
        "sources":["https://www.cve.org/CVERecord?id=CVE-2007-2768",
            format!("https://github.com/NixOS/nixpkgs/tree/{REVIEWED_NIXPKGS}/pkgs/tools/networking/openssh"),
            "https://github.com/datosh/nixos-vex"]})
}

fn vex(assessment: &Value, subject: &str, timestamp: &str, content_hash: &str) -> Value {
    let mut statements = Vec::new();
    // Unknown predicates are deliberately absent from the suppressing feed.
    if assessment["status"] == "not_affected" {
        statements.push(json!({
            "vulnerability":{"name":CVE,"@id":format!("https://www.cve.org/CVERecord?id={CVE}")},
            "products":[{"@id":format!("pkg:generic/agentbox@{subject}"),
                "subcomponents":[{"@id":assessment["component_purl"]}]}],
            "status":"not_affected", "justification":"vulnerable_code_not_present",
            "impact_statement":assessment["reason"],
            "status_notes":format!("Rule openssh-no-opie-v1; immutable image subject {subject}. Mounts, runtime changes, host kernel and sidecars are outside this assessment.")
        }));
    }
    json!({"@context":"https://openvex.dev/ns/v0.2.0",
        "@id":format!("https://github.com/DreamLab-AI/agentbox/vex/{content_hash}"),
        "author":"DreamLab-AI/agentbox", "timestamp":timestamp,"version":1,
        "statements":statements})
}

fn write_bundle(output: &Path, subject: &str) -> Result<()> {
    let mut files = BTreeMap::new();
    for file in BUNDLE_FILES {
        files.insert(*file, hash(&fs::read(output.join(file))?));
    }
    // Optional inventory exports are integrity-protected when supplied.
    for file in [
        "sbom.nix.spdx.json",
        "sbom.nix.syft.json",
        "sbomnix.raw.csv",
    ] {
        if output.join(file).exists() {
            files.insert(file, hash(&fs::read(output.join(file))?));
        }
    }
    write_json(
        &output.join("bundle.json"),
        &json!({"schema_version":1,"subject":subject,"files":files}),
    )
}

fn verify(bundle: &Path, subject: &str) -> Result<Value> {
    valid_subject(subject)?;
    let manifest = read_json(&bundle.join("bundle.json"))?;
    if manifest["schema_version"] != 1 || manifest["subject"] != subject {
        return Err("Bundle subject/schema mismatch".into());
    }
    let files = manifest["files"]
        .as_object()
        .ok_or("Bundle has no file hashes")?;
    for required in BUNDLE_FILES {
        if !files.contains_key(*required) {
            return Err(format!("Bundle missing {required}").into());
        }
    }
    for (name, digest) in files {
        if !BUNDLE_FILES.contains(&name.as_str())
            && !matches!(
                name.as_str(),
                "sbom.nix.spdx.json" | "sbom.nix.syft.json" | "sbomnix.raw.csv"
            )
        {
            return Err("Unexpected bundle file".into());
        }
        if hash(&fs::read(bundle.join(name))?) != digest.as_str().ok_or("Invalid file digest")? {
            return Err(format!("Bundle integrity failure: {name}").into());
        }
    }
    let sbom = read_json(&bundle.join("sbom.nix.cyclonedx.json"))?;
    if sbom["metadata"]["component"]["version"] != subject {
        return Err("SBOM subject mismatch".into());
    }
    if files.contains_key("sbom.nix.syft.json") {
        let native = read_json(&bundle.join("sbom.nix.syft.json"))?;
        if native["source"]["name"] != "agentbox"
            || native["source"]["version"] != subject
            || native["source"]["type"] != "directory"
        {
            return Err("Scanner SBOM subject mismatch".into());
        }
    }
    let evidence = read_json(&bundle.join("build-evidence.json"))?;
    if evidence["subject"] != subject {
        return Err("Evidence subject mismatch".into());
    }
    let assessment = read_json(&bundle.join("assessment.json"))?;
    let document = read_json(&bundle.join("vex.openvex.json"))?;
    let expected = vex(
        &assessment,
        subject,
        required_str(&document, "timestamp")?,
        required_str(&document, "@id")?
            .rsplit('/')
            .next()
            .ok_or("Bad VEX id")?,
    );
    if expected != document {
        return Err("VEX statements differ from the recorded assessment".into());
    }
    Ok(manifest)
}

fn report(evidence: &Path, sbom_path: &Path, subject: Option<&str>, output: &Path) -> Result<()> {
    let image_bytes = fs::read(evidence.join("image.json"))?;
    let image: Value = serde_json::from_slice(&image_bytes)?;
    let metadata = read_json(&evidence.join("metadata.json"))?;
    if metadata["schema_version"] != 1 {
        return Err("Unsupported evidence schema".into());
    }
    let default_subject = hash(&image_bytes);
    let subject = subject.unwrap_or(&default_subject);
    valid_subject(subject)?;
    // A build report cannot invent a registry identity. Use check-image+bind
    // after publication to prove and record that identity.
    if subject != default_subject {
        return Err(
            "Report subject must hash image.json; use check-image then bind for a registry digest"
                .into(),
        );
    }
    let shipped = shipped_paths(&image)?;
    let sbom = scope_sbom(read_json(sbom_path)?, &shipped, subject)?;
    let opie = find_opie(&shipped)?;
    let assessment = assess(&metadata, &sbom, &shipped, &opie);
    let timestamp = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
    let content_hash = hash(&serde_json::to_vec(
        &json!({"subject":subject,"assessment":assessment,"timestamp":timestamp}),
    )?);
    let document = vex(
        &assessment,
        subject,
        &timestamp,
        content_hash.trim_start_matches("sha256:"),
    );
    fs::create_dir_all(output)?;
    fs::write(output.join("image.json"), image_bytes)?;
    write_json(&output.join("sbom.nix.cyclonedx.json"), &sbom)?;
    write_json(&output.join("assessment.json"), &assessment)?;
    write_json(&output.join("vex.openvex.json"), &document)?;
    write_json(
        &output.join("build-evidence.json"),
        &json!({"schema_version":1,
        "subject":subject,"build_subject":default_subject,"metadata":metadata,
        "shipped_paths":shipped,"timestamp":timestamp,"opie_inventory_complete":true}),
    )?;
    write_bundle(output, subject)?;
    Ok(())
}

fn bind(bundle: &Path, subject: &str, output: &Path) -> Result<()> {
    valid_subject(subject)?;
    let old = read_json(&bundle.join("bundle.json"))?;
    let old_subject = required_str(&old, "subject")?;
    verify(bundle, old_subject)?;
    fs::create_dir_all(output)?;
    for name in old["files"].as_object().ok_or("Invalid bundle")?.keys() {
        if bundle != output {
            fs::copy(bundle.join(name), output.join(name))?;
        }
    }
    let mut sbom = read_json(&output.join("sbom.nix.cyclonedx.json"))?;
    sbom["metadata"]["component"]["version"] = json!(subject);
    sbom["metadata"]["component"]["purl"] = json!(format!("pkg:generic/agentbox@{subject}"));
    let assessment = read_json(&output.join("assessment.json"))?;
    let old_vex = read_json(&output.join("vex.openvex.json"))?;
    let mut evidence = read_json(&output.join("build-evidence.json"))?;
    evidence["subject"] = json!(subject);
    let timestamp = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
    let h = hash(&serde_json::to_vec(
        &json!({"subject":subject,"assessment":assessment,"timestamp":timestamp,"previous":old_vex["@id"]}),
    )?);
    let document = vex(
        &assessment,
        subject,
        &timestamp,
        h.trim_start_matches("sha256:"),
    );
    write_json(&output.join("sbom.nix.cyclonedx.json"), &sbom)?;
    write_json(&output.join("build-evidence.json"), &evidence)?;
    write_json(&output.join("vex.openvex.json"), &document)?;
    write_bundle(output, subject)?;
    Ok(())
}

// OCI serializers omit optional empty/null fields. Compare config after that
// normalisation, while retaining all non-empty settings, including env and
// entrypoint. An image with the same files but different config is rejected.
fn normalise(value: &Value) -> Value {
    match value {
        Value::Object(m) => Value::Object(
            m.iter()
                .filter_map(|(k, v)| {
                    let v = normalise(v);
                    if v.is_null()
                        || v.as_array().is_some_and(Vec::is_empty)
                        || v.as_object().is_some_and(serde_json::Map::is_empty)
                    {
                        None
                    } else {
                        Some((k.clone(), v))
                    }
                })
                .collect(),
        ),
        Value::Array(a) => Value::Array(a.iter().map(normalise).collect()),
        _ => value.clone(),
    }
}

fn check_image(
    bundle: &Path,
    manifest_path: &Path,
    config_path: &Path,
    subject: &str,
) -> Result<()> {
    valid_subject(subject)?;
    let bundle_manifest = read_json(&bundle.join("bundle.json"))?;
    verify(bundle, required_str(&bundle_manifest, "subject")?)?;
    let bytes = fs::read(manifest_path)?;
    if hash(&bytes) != subject {
        return Err("Registry manifest digest mismatch".into());
    }
    let manifest: Value = serde_json::from_slice(&bytes)?;
    let image = read_json(&bundle.join("image.json"))?;
    let config_bytes = fs::read(config_path)?;
    if hash(&config_bytes)
        != manifest["config"]["digest"]
            .as_str()
            .ok_or("Expected an architecture manifest, not an image index")?
    {
        return Err("Registry config digest mismatch".into());
    }
    let config: Value = serde_json::from_slice(&config_bytes)?;
    let expected_layers: Vec<&Value> = image["layers"]
        .as_array()
        .ok_or("Invalid layer list")?
        .iter()
        .map(|v| &v["digest"])
        .collect();
    let actual_layers: Vec<&Value> = manifest["layers"]
        .as_array()
        .ok_or("Registry reference is not an architecture manifest")?
        .iter()
        .map(|v| &v["digest"])
        .collect();
    let expected_diff: Vec<&Value> = image["layers"]
        .as_array()
        .ok_or("Invalid layers")?
        .iter()
        .map(|v| &v["diff_ids"])
        .collect();
    let actual_diff: Vec<&Value> = config["rootfs"]["diff_ids"]
        .as_array()
        .ok_or("No registry diff IDs")?
        .iter()
        .collect();
    if expected_layers != actual_layers
        || expected_diff != actual_diff
        || image["arch"] != config["architecture"]
        || config["os"] != "linux"
        || normalise(&image["image-config"]) != normalise(&config["config"])
    {
        return Err("Published image differs from assessed Nix payload/configuration".into());
    }
    Ok(())
}

fn convert_sbom(syft: &Path, input: &Path, format: &str) -> Result<Value> {
    let result = std::process::Command::new(syft)
        .arg("convert")
        .arg(input)
        .args(["-o", format])
        .output()?;
    if !result.status.success() {
        return Err(format!("Syft {format} conversion failed: {}", result.status).into());
    }
    Ok(serde_json::from_slice(&result.stdout)?)
}

fn scope_native(mut native: Value, scoped: &Value, subject: &str) -> Result<Value> {
    let components = scoped["components"].as_array().ok_or("Missing inventory")?;
    let artifacts = native["artifacts"]
        .as_array()
        .ok_or("Syft omitted inventory")?;
    // CycloneDX also inventories shipped configuration files. Syft's native
    // artifacts are software packages: its decoder omits type=file entries.
    // Keep those files in the authoritative CycloneDX/payload evidence, while
    // requiring every software component to survive the scanner conversion.
    let packages: Vec<&Value> = components.iter().filter(|c| c["type"] != "file").collect();
    let expected: BTreeSet<&str> = packages
        .iter()
        .filter_map(|c| c["purl"].as_str())
        .filter(|purl| !purl.is_empty())
        .collect();
    let actual: BTreeSet<&str> = artifacts
        .iter()
        .filter_map(|c| c["purl"].as_str())
        .filter(|purl| !purl.is_empty())
        .collect();
    if packages.len() != artifacts.len() || expected != actual {
        return Err("Syft conversion changed the scoped package inventory".into());
    }
    // Container roots lose repository identifiers in the CycloneDX decoder.
    // Explicit generic aliases survive the native decoder and match OpenVEX.
    native["source"] = json!({"id":subject,"name":"agentbox","version":subject,
        "type":"directory","metadata":{"path":"agentbox"}});
    Ok(native)
}

fn export_sboms(output: &Path, subject: &str, syft: &Path) -> Result<()> {
    let scoped = read_json(&output.join("sbom.nix.cyclonedx.json"))?;
    let converted = convert_sbom(syft, &output.join("sbom.nix.cyclonedx.json"), "syft-json")?;
    let native = scope_native(converted, &scoped, subject)?;
    write_json(&output.join("sbom.nix.syft.json"), &native)?;
    let spdx = convert_sbom(syft, &output.join("sbom.nix.syft.json"), "spdx-json")?;
    if spdx["spdxVersion"] != "SPDX-2.3" {
        return Err("Unsupported SPDX export".into());
    }
    write_json(&output.join("sbom.nix.spdx.json"), &spdx)?;
    write_bundle(output, subject)
}

fn run(cli: Cli) -> Result<()> {
    match cli.command {
        Command::Report {
            evidence,
            sbom,
            subject,
            output,
            syft,
        } => {
            if syft.is_none()
                && (output.join("sbom.nix.spdx.json").exists()
                    || output.join("sbom.nix.syft.json").exists())
            {
                return Err("Refreshing exported SBOMs requires --syft".into());
            }
            report(&evidence, &sbom, subject.as_deref(), &output)?;
            if let Some(syft) = syft {
                let manifest = read_json(&output.join("bundle.json"))?;
                export_sboms(&output, required_str(&manifest, "subject")?, &syft)?;
            }
            Ok(())
        }
        Command::Verify { bundle, subject } => {
            verify(&bundle, &subject)?;
            Ok(())
        }
        Command::Bind {
            bundle,
            subject,
            manifest,
            config,
            output,
            syft,
        } => {
            if syft.is_none()
                && (bundle.join("sbom.nix.spdx.json").exists()
                    || bundle.join("sbom.nix.syft.json").exists())
            {
                return Err("Rebinding SPDX exports requires --syft".into());
            }
            check_image(&bundle, &manifest, &config, &subject)?;
            bind(&bundle, &subject, &output)?;
            if let Some(syft) = syft {
                export_sboms(&output, &subject, &syft)?;
            }
            Ok(())
        }
        Command::CheckImage {
            bundle,
            manifest,
            config,
            subject,
        } => check_image(&bundle, &manifest, &config, &subject),
    }
}

fn main() {
    if let Err(error) = run(Cli::parse()) {
        eprintln!("agentbox-vex: {error}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn subject() -> String {
        format!("sha256:{}", "a".repeat(64))
    }
    fn package_path() -> String {
        format!("/nix/store/{}-openssh-10.3p1", "a".repeat(32))
    }
    fn metadata() -> Value {
        json!({"nixpkgs_revision":REVIEWED_NIXPKGS,
        "openssh":{"version":REVIEWED_OPENSSH,"stock_build":true,
            "output_path":package_path(),"output_paths":[package_path()],"configure_flags":["--with-pam"]}})
    }
    fn sbom() -> Value {
        json!({"bomFormat":"CycloneDX","specVersion":"1.4",
        "metadata":{},"components":[{"type":"library","bom-ref":"ssh","name":"openssh","version":REVIEWED_OPENSSH,
            "purl":format!("pkg:nix/openssh@{REVIEWED_OPENSSH}"),
            "properties":[{"name":"nix:output_path","value":package_path()}]}]})
    }

    #[test]
    fn native_export_rejects_lost_or_changed_packages_and_uses_scoped_source() {
        let scoped = sbom();
        let purl = scoped["components"][0]["purl"].clone();
        let native = json!({"artifacts":[{"purl":purl}],"source":{"type":"image"}});
        let converted = scope_native(native.clone(), &scoped, &subject()).unwrap();
        assert_eq!(converted["source"]["type"], "directory");
        assert_eq!(converted["source"]["name"], "agentbox");
        assert_eq!(converted["source"]["version"], subject());
        assert_eq!(converted["artifacts"], native["artifacts"]);
        let mut missing = native.clone();
        missing["artifacts"] = json!([]);
        assert!(scope_native(missing, &scoped, &subject()).is_err());
        let mut changed = native;
        changed["artifacts"][0]["purl"] = json!("pkg:nix/openssh@other");
        assert!(scope_native(changed, &scoped, &subject()).is_err());
    }

    #[test]
    fn native_export_distinguishes_config_files_from_unversioned_packages() {
        let mut scoped = sbom();
        scoped["components"].as_array_mut().unwrap().extend([
            json!({"type":"file", "name":"fonts.conf", "version":"",
                "purl":"pkg:nix/fonts.conf"}),
            json!({"type":"library", "name":"source", "version":""}),
        ]);
        let native = json!({"artifacts":[
            {"purl":scoped["components"][0]["purl"]},
            {"name":"source", "version":"", "purl":""}
        ]});
        assert!(scope_native(native.clone(), &scoped, &subject()).is_ok());
        // A package without a PURL is still counted: dropping it must fail.
        let mut missing = native;
        missing["artifacts"].as_array_mut().unwrap().pop();
        assert!(scope_native(missing, &scoped, &subject()).is_err());
    }

    #[test]
    fn reviewed_rule_holds_only_for_present_stock_package_with_no_opie() {
        let paths = BTreeSet::from([package_path()]);
        assert_eq!(
            assess(&metadata(), &sbom(), &paths, &[])["status"],
            "not_affected"
        );
        assert_eq!(
            assess(&metadata(), &sbom(), &paths, &["pam_opie.so".into()])["status"],
            "under_investigation"
        );
        assert_eq!(
            assess(&metadata(), &sbom(), &BTreeSet::new(), &[])["status"],
            "under_investigation"
        );
        for pointer in [
            "/nixpkgs_revision",
            "/openssh/version",
            "/openssh/stock_build",
        ] {
            let mut m = metadata();
            *m.pointer_mut(pointer).unwrap() = Value::Null;
            assert_eq!(
                assess(&m, &sbom(), &paths, &[])["status"],
                "under_investigation"
            );
        }
        let mut b = sbom();
        b["components"][0]["properties"][0]["value"] = json!("/nix/store/other");
        assert_eq!(
            assess(&metadata(), &b, &paths, &[])["status"],
            "under_investigation"
        );
        // A matching manual-page output is insufficient when the executable
        // output is missing from the inventory used by the scanner.
        let mut m = metadata();
        m["openssh"]["output_paths"] = json!([package_path(), "/nix/store/ssh-man"]);
        let mut b = sbom();
        b["components"][0]["properties"][0]["value"] = json!("/nix/store/ssh-man");
        assert_eq!(assess(&m, &b, &paths, &[])["status"], "under_investigation");
    }

    #[test]
    fn ambiguous_versionless_or_alternate_builds_do_not_suppress() {
        let paths = BTreeSet::from([package_path()]);
        let mut b = sbom();
        b["components"][0]["purl"] = json!("pkg:nix/openssh");
        assert_eq!(
            assess(&metadata(), &b, &paths, &[])["status"],
            "under_investigation"
        );
        let mut b = sbom();
        let mut copy = b["components"][0].clone();
        copy["properties"][0]["value"] = json!("/nix/store/alternative-build");
        b["components"].as_array_mut().unwrap().push(copy);
        assert_eq!(
            assess(&metadata(), &b, &paths, &[])["status"],
            "under_investigation"
        );
    }

    #[test]
    fn unknown_status_withdraws_statement_and_scope_is_digest_specific() {
        let paths = BTreeSet::from([package_path()]);
        let a = assess(&metadata(), &sbom(), &paths, &[]);
        let v = vex(&a, &subject(), "2026-10-11T00:00:00Z", "abc");
        assert_eq!(
            v["statements"][0]["products"][0]["@id"],
            format!("pkg:generic/agentbox@{}", subject())
        );
        let a = assess(&Value::Null, &sbom(), &paths, &[]);
        assert_eq!(
            vex(&a, &subject(), "2026-10-11T00:00:00Z", "abc")["statements"],
            json!([])
        );
    }

    #[test]
    fn sbom_filters_builder_and_unshipped_outputs_and_repairs_root() {
        let mut b = sbom();
        b["components"][0]["properties"]
            .as_array_mut()
            .unwrap()
            .push(json!({"name":"nix:output_path","value":"/nix/store/unshipped-man"}));
        b["components"]
            .as_array_mut()
            .unwrap()
            .push(json!({"bom-ref":"builder","name":"builder","properties":[]}));
        b["dependencies"] = json!([{"ref":"ssh","dependsOn":["builder"]},{"ref":"builder"}]);
        let b = scope_sbom(b, &BTreeSet::from([package_path()]), &subject()).unwrap();
        assert_eq!(b["components"].as_array().unwrap().len(), 1);
        assert_eq!(
            output_paths(&b["components"][0]),
            BTreeSet::from([package_path()])
        );
        assert_eq!(b["dependencies"][0]["dependsOn"], json!([]));
        assert_eq!(b["metadata"]["component"]["version"], subject());
    }

    #[test]
    fn inventory_checks_names_case_insensitively_and_never_follows_mount_links() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir(dir.path().join("lib")).unwrap();
        fs::write(dir.path().join("lib/PAM_OPIE.so"), []).unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink("/absent-mutable-mount", dir.path().join("mounted")).unwrap();
        let paths = BTreeSet::from([dir.path().to_string_lossy().into_owned()]);
        assert_eq!(find_opie(&paths).unwrap().len(), 1);
        assert!(!opie_name("copies.txt"));
        assert!(opie_name(&format!("{}-opie-2.4", "a".repeat(32))));
        assert!(find_opie(&BTreeSet::from(["/absent-root".into()])).is_err());
    }

    fn bundle(dir: &Path) {
        let paths = BTreeSet::from([package_path()]);
        let a = assess(&metadata(), &sbom(), &paths, &[]);
        write_json(
            &dir.join("image.json"),
            &json!({"arch":"amd64","image-config":{"Env":["PATH=/bin"],"Entrypoint":["/entry"]},
            "layers":[{"digest":subject(),"diff_ids":subject()}]}),
        )
        .unwrap();
        write_json(&dir.join("assessment.json"), &a).unwrap();
        write_json(
            &dir.join("sbom.nix.cyclonedx.json"),
            &scope_sbom(sbom(), &paths, &subject()).unwrap(),
        )
        .unwrap();
        write_json(
            &dir.join("build-evidence.json"),
            &json!({"subject":subject()}),
        )
        .unwrap();
        write_json(
            &dir.join("vex.openvex.json"),
            &vex(&a, &subject(), "2026-10-11T00:00:00Z", "abc"),
        )
        .unwrap();
        write_bundle(dir, &subject()).unwrap();
    }

    #[test]
    fn bundle_verification_detects_corruption_wrong_subject_and_missing_files() {
        let dir = tempfile::tempdir().unwrap();
        bundle(dir.path());
        verify(dir.path(), &subject()).unwrap();
        assert!(verify(dir.path(), &format!("sha256:{}", "b".repeat(64))).is_err());
        fs::write(dir.path().join("assessment.json"), b"{}").unwrap();
        assert!(verify(dir.path(), &subject()).is_err());
        bundle(dir.path());
        fs::remove_file(dir.path().join("image.json")).unwrap();
        assert!(verify(dir.path(), &subject()).is_err());
    }

    #[test]
    fn rebinding_preserves_decision_and_updates_all_subjects() {
        let from = tempfile::tempdir().unwrap();
        let to = tempfile::tempdir().unwrap();
        bundle(from.path());
        let s = format!("sha256:{}", "b".repeat(64));
        bind(from.path(), &s, to.path()).unwrap();
        verify(to.path(), &s).unwrap();
        assert_eq!(
            read_json(&to.path().join("assessment.json")).unwrap(),
            read_json(&from.path().join("assessment.json")).unwrap()
        );
        assert_ne!(
            read_json(&to.path().join("vex.openvex.json")).unwrap()["@id"],
            read_json(&from.path().join("vex.openvex.json")).unwrap()["@id"]
        );
    }

    #[test]
    fn image_binding_rejects_layer_config_platform_or_raw_byte_drift() {
        let dir = tempfile::tempdir().unwrap();
        bundle(dir.path());
        let config = json!({"os":"linux","architecture":"amd64","config":{"Env":["PATH=/bin"],"Entrypoint":["/entry"],"Cmd":null},"rootfs":{"diff_ids":[subject()]}});
        let config_path = dir.path().join("config.json");
        write_json(&config_path, &config).unwrap();
        let manifest = json!({"config":{"digest":hash(&fs::read(&config_path).unwrap())},"layers":[{"digest":subject()}]});
        let manifest_path = dir.path().join("manifest.json");
        write_json(&manifest_path, &manifest).unwrap();
        let digest = hash(&fs::read(&manifest_path).unwrap());
        check_image(dir.path(), &manifest_path, &config_path, &digest).unwrap();
        assert!(check_image(dir.path(), &manifest_path, &config_path, &subject()).is_err());
        for pointer in [
            "/architecture",
            "/config/Entrypoint/0",
            "/rootfs/diff_ids/0",
        ] {
            let mut changed = config.clone();
            *changed.pointer_mut(pointer).unwrap() = json!("changed");
            write_json(&config_path, &changed).unwrap();
            let mut m = manifest.clone();
            m["config"]["digest"] = json!(hash(&fs::read(&config_path).unwrap()));
            write_json(&manifest_path, &m).unwrap();
            assert!(check_image(
                dir.path(),
                &manifest_path,
                &config_path,
                &hash(&fs::read(&manifest_path).unwrap())
            )
            .is_err());
        }
    }

    #[test]
    fn sha256_matches_published_vector_and_subject_validation_is_strict() {
        assert_eq!(
            hash(b"abc"),
            "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        for s in ["latest", "sha256:abc", "sha256:../x"] {
            assert!(valid_subject(s).is_err());
        }
    }
}
