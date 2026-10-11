#!/usr/bin/env bash
# Opt-in scanner interoperability check; never scans a live image.
set -euo pipefail
tools=${1:?Usage: vex-grype.integration.sh SECURITY_TOOLS_OUTPUT [OUTPUT_DIR]}
output=${2:-$(mktemp -d)}
mkdir -p -- "$output"
output=$(cd -- "$output" && pwd)
for tool in jq syft grype; do test -x "$tools/bin/$tool"; done
jq="$tools/bin/jq"
syft="$tools/bin/syft"
grype="$tools/bin/grype"
subject="sha256:$(printf 'a%.0s' {1..64})"
other="sha256:$(printf 'b%.0s' {1..64})"
printf '{}\n' > "$output/grype.config.yaml"

# Old OpenSSL ensures that a current vulnerability DB has a real match.
# All packages are synthetic fixtures; the statement below is not an
# assessment of any distributed package or actual image.
"$jq" -n --arg subject "$subject" '{
  bomFormat:"CycloneDX",specVersion:"1.4",version:1,
  metadata:{component:{type:"container","bom-ref":"agentbox-image",
    name:"agentbox",version:$subject,purl:("pkg:generic/agentbox@"+$subject)}},
  components:[
    {type:"library","bom-ref":"openssh",name:"openssh",version:"10.3p1",
      purl:"pkg:nix/openssh@10.3p1"},
    {type:"library","bom-ref":"openssl",name:"openssl",version:"1.0.1e",
      purl:"pkg:nix/openssl@1.0.1e"}
  ]
}' > "$output/fixture.cyclonedx.json"
"$syft" convert "$output/fixture.cyclonedx.json" \
  -o "syft-json=$output/fixture.converted.json"
"$jq" --arg subject "$subject" '.source={id:$subject,name:"agentbox",
  version:$subject,type:"directory",metadata:{path:"agentbox"}}' \
  "$output/fixture.converted.json" > "$output/fixture.scoped.json"
"$jq" -e '.artifacts | any(.type == "nix" and .purl == "pkg:nix/openssh@10.3p1")
  and any(.type == "nix" and .purl == "pkg:nix/openssl@1.0.1e")' \
  "$output/fixture.scoped.json" > /dev/null

scan() {
  env -u GRYPE_IGNORE_UNFIXED -u GRYPE_ONLY_FIXED -u GRYPE_IGNORE_WONTFIX \
    "$grype" "sbom:$output/fixture.scoped.json" \
    --config "$output/grype.config.yaml" --add-cpes-if-none --output json "$@"
}
scan > "$output/raw.json"
"$jq" -e 'any(.matches[]; .artifact.name == "openssl" and (.artifact.cpes | length) > 0)' \
  "$output/raw.json" > /dev/null
vulnerability=$("$jq" -er '[.matches[] | select(.artifact.purl == "pkg:nix/openssl@1.0.1e"
  and (.vulnerability.id | startswith("CVE-")))][0].vulnerability.id' "$output/raw.json")

document() {
  local image_subject=$1 package_purl=$2
  "$jq" -n --arg subject "$image_subject" --arg purl "$package_purl" \
    --arg cve "$vulnerability" '{
    "@context":"https://openvex.dev/ns/v0.2.0",
    "@id":"https://example.invalid/agentbox/scanner-interoperability-fixture",
    author:"Agentbox test fixture",timestamp:"2026-10-11T00:00:00Z",version:1,
    statements:[{vulnerability:{name:$cve},
      products:[{"@id":("pkg:generic/agentbox@"+$subject),
        subcomponents:[{"@id":$purl}]}],status:"not_affected",
      justification:"vulnerable_code_not_present",
      impact_statement:"Synthetic matcher fixture only; no distributed product assessment."}]
  }'
}
document "$subject" "pkg:nix/openssl@1.0.1e" > "$output/matching.openvex.json"
document "$other" "pkg:nix/openssl@1.0.1e" > "$output/wrong-image.openvex.json"
document "$subject" "pkg:nix/openssl@0.0.0" > "$output/wrong-component.openvex.json"

# Reuse the downloaded DB. Matching and withdrawal checks are offline.
export GRYPE_DB_AUTO_UPDATE=false
scan --vex "$output/matching.openvex.json" > "$output/filtered.json"
scan --vex "$output/wrong-image.openvex.json" > "$output/wrong-image.json"
scan --vex "$output/wrong-component.openvex.json" > "$output/wrong-component.json"
"$jq" -e --arg cve "$vulnerability" '
  any(.ignoredMatches[]; .vulnerability.id == $cve and
    .artifact.purl == "pkg:nix/openssl@1.0.1e" and
    any(.appliedIgnoreRules[]; .namespace == "vex")) and
  all(.matches[]; .vulnerability.id != $cve or
    .artifact.purl != "pkg:nix/openssl@1.0.1e")' "$output/filtered.json" > /dev/null
"$jq" -s -e '
  def keys: [.matches[] | [.vulnerability.id,.artifact.purl]] | sort;
  (.[0]|keys) == (.[1]|keys) and (.[0]|keys) == (.[2]|keys)' \
  "$output/raw.json" "$output/wrong-image.json" "$output/wrong-component.json" > /dev/null
"$jq" -s -e --arg cve "$vulnerability" '
  def unrelated: [.matches[] | select(.vulnerability.id != $cve or
    .artifact.purl != "pkg:nix/openssl@1.0.1e") |
    [.vulnerability.id,.artifact.purl]] | sort;
  (.[0]|unrelated) == (.[1]|unrelated)' \
  "$output/raw.json" "$output/filtered.json" > /dev/null
printf 'PASS: pinned scanner product/subcomponent matching and withdrawal; reports: %s\n' "$output"
