#!/usr/bin/env bash
# Build-scoped Nix SBOM/VEX evidence and digest-bound vulnerability scans.
set -euo pipefail
repo=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
usage() {
  cat <<'EOF'
Usage: security-scan.sh report [--variant runtime] [--evidence DIR] [--tools DIR]
                               [--output DIR] [--subject sha256:DIGEST]
       security-scan.sh scan --image REPOSITORY@sha256:DIGEST [--report DIR]
                             [--variant runtime] [--tools DIR] [--output DIR]
                             [--fail-on high|critical|medium|low|negligible|none]
Report builds the exact Nix payload SBOM and a conservative OpenVEX assessment.
Scan verifies the registry image against that build before applying VEX. Without
--report, scan builds local evidence; it never applies evidence to a different image.
Exit 2 means the severity gate failed; reports are retained. Other errors fail hard.
EOF
}
command=${1:-help}; shift || true
case "$command" in help|--help|-h) usage; exit 0 ;; esac
variant=runtime evidence= tools= output= subject= image= report= fail_on=high
while (($#)); do
  case "$1" in
    --help|-h) usage; exit 0 ;;
    --variant|--evidence|--tools|--output|--subject|--image|--report|--fail-on)
      (($# >= 2)) || { echo "Missing value for $1" >&2; exit 1; }
      option=${1#--}; option=${option//-/_}; printf -v "$option" '%s' "$2"; shift 2 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done
[[ $command == report || $command == scan ]] || { usage; [[ $command == help ]]; exit; }
[[ $variant =~ ^[a-z][a-z0-9-]*$ ]] || { echo 'Invalid variant' >&2; exit 1; }
[[ $fail_on =~ ^(high|critical|medium|low|negligible|none)$ ]] || { echo 'Invalid severity' >&2; exit 1; }
if [[ $command == scan ]]; then
  [[ $image =~ ^[^[:space:]@]+@sha256:[0-9a-f]{64}$ ]] || { echo 'Scan requires an immutable repository@sha256:DIGEST image' >&2; exit 1; }
  subject=${image##*@}
fi
if [[ -n $subject && ! $subject =~ ^sha256:[0-9a-f]{64}$ ]]; then echo 'Invalid subject digest' >&2; exit 1; fi
if [[ $command == report ]]; then
  output=${output:-"$repo/.agentbox-build/security/$variant"}
else
  output=${output:-"$repo/.agentbox-build/security/$variant-scan"}
fi
mkdir -p -- "$output"
output=$(cd -- "$output" && pwd)
scratch=$(mktemp -d)
trap 'rm -rf -- "$scratch"' EXIT

# A report already contains its payload evidence; scanning it only builds tools.
need_evidence=false
[[ $command == report || -z $report ]] && need_evidence=true
if [[ -z $tools || ($need_evidence == true && -z $evidence) ]]; then
  attrs=()
  [[ -n $tools ]] || attrs+=(".#security-tools")
  [[ $need_evidence != true || -n $evidence ]] || attrs+=(".#$variant.securityEvidence")
  (cd -- "$repo" && nix build "${attrs[@]}" --no-link --json --print-build-logs) > "$scratch/build.json"
  while IFS= read -r built; do
    [[ ! -x $built/bin/agentbox-vex ]] || tools=$built
    [[ ! -f $built/metadata.json ]] || evidence=$built
  done < <(jq -r '.[].outputs.out' "$scratch/build.json")
fi
[[ -n $tools && -x $tools/bin/agentbox-vex ]] || { echo 'Missing pinned security-tools output' >&2; exit 1; }
tool() { "$tools/bin/$@"; }
make_report() {
  local destination=$1
  [[ -f $evidence/metadata.json && -f $evidence/image.json && -d $evidence/payload ]] || { echo 'Incomplete build evidence' >&2; exit 1; }
  mkdir -p -- "$destination"
  # This real output contains only the unique shipped paths, not build-tool closure.
  tool sbomnix "$(readlink -f -- "$evidence/payload")" --exclude-meta --exclude-cpe-matching \
    --cdx "$scratch/sbom.nix.cyclonedx.json" --spdx "$scratch/sbomnix.raw.spdx.json" --csv "$destination/sbomnix.raw.csv"
  local args=(report --evidence "$evidence" --sbom "$scratch/sbom.nix.cyclonedx.json" --output "$destination" --syft "$tools/bin/syft")
  [[ -z $subject || $command == scan ]] || args+=(--subject "$subject")
  tool agentbox-vex "${args[@]}"
}
if [[ $command == report ]]; then make_report "$output"; exit 0; fi
if [[ -z $report ]]; then report="$output/build-report"; make_report "$report"; fi
report=$(cd -- "$report" && pwd)
[[ $report != "$output/evidence" ]] || { echo 'Scan output must differ from its input report' >&2; exit 1; }
report_subject=$(tool jq -er '.subject' "$report/bundle.json")
tool agentbox-vex verify --bundle "$report" --subject "$report_subject"
tool skopeo inspect --raw "docker://$image" > "$output/image.manifest.json"
tool skopeo inspect --config --raw "docker://$image" > "$output/image.config.json"
tool agentbox-vex check-image --bundle "$report" --manifest "$output/image.manifest.json" \
  --config "$output/image.config.json" --subject "$subject"
tool agentbox-vex bind --bundle "$report" --subject "$subject" --output "$output/evidence" \
  --manifest "$output/image.manifest.json" --config "$output/image.config.json" --syft "$tools/bin/syft"
tool agentbox-vex verify --bundle "$output/evidence" --subject "$subject"
printf '{}\n' > "$output/grype.config.yaml"
printf '%s\n' "$image" > "$output/image-ref.txt"
grype_scan() {
  # Keep database/cache settings; drop ambient filters, VEX, output and policy
  # overrides so the raw scan really is raw and the gate is the explicit one.
  local name
  local clean_env=()
  while IFS= read -r name; do
    if [[ $name == GRYPE_* && $name != GRYPE_DB_* ]]; then clean_env+=(-u "$name"); fi
  done < <(compgen -e)
  env "${clean_env[@]}" GRYPE_CHECK_FOR_APP_UPDATE=false \
    "$tools/bin/grype" "sbom:$output/evidence/sbom.nix.syft.json" \
    --config "$output/grype.config.yaml" --add-cpes-if-none --output json "$@"
}
grype_scan > "$output/grype.raw.json"
gate=(); [[ $fail_on == none ]] || gate=(--fail-on "$fail_on")
set +e
grype_scan --vex "$output/evidence/vex.openvex.json" "${gate[@]}" > "$output/grype.filtered.json"
status=$?
set -e
printf '%s\n' "$status" > "$output/grype.exit-code.txt"
# Render the saved results without another database query or scan.
if [[ $status == 0 || $status == 2 ]]; then
  tool jq -r '(["NAME","INSTALLED","VULNERABILITY","SEVERITY"]),
    (.matches[] | [.artifact.name,.artifact.version,.vulnerability.id,.vulnerability.severity]) | @tsv' \
    "$output/grype.filtered.json" > "$output/grype.filtered.txt"
fi
exit "$status"
