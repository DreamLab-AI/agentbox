#!/usr/bin/env bash
# Post-build CVE-009 gate. Run inside the candidate Agentbox container.
# Both curl (OpenSSL bundle) and Node (forced to that bundle through
# NODE_OPTIONS=--use-openssl-ca) must reject both non-CT eMudhra chains.
set -uo pipefail

URLS=(
  "https://dv-g3b-noct-emudhra.we-have-a-problem.com/"
  "https://dv-g3b-aaa-noct-emudhra.we-have-a-problem.com/"
)

fail=0

probe_curl() {
  local url="$1" output rc
  output=$(curl --silent --show-error --connect-timeout 10 --max-time 15 \
    --output /dev/null "$url" 2>&1)
  rc=$?
  if [[ $rc -eq 60 ]]; then
    printf 'PASS curl rejected %s\n' "$url"
  else
    printf 'FAIL curl %s (wanted certificate rejection rc=60, got rc=%d): %s\n' \
      "$url" "$rc" "$output" >&2
    fail=1
  fi
}

probe_node() {
  local url="$1" output rc
  output=$(node -e '
    const https = require("node:https");
    const request = https.get(process.argv[1], response => {
      response.resume();
      console.error(`UNEXPECTED_HTTP_${response.statusCode}`);
      process.exitCode = 2;
    });
    request.setTimeout(15000, () => request.destroy(new Error("PROBE_TIMEOUT")));
    request.on("error", error => {
      const code = error.code || "NO_CODE";
      if (/CERT|ISSUER|SIGNATURE|SELF_SIGNED/.test(code)) {
        console.log(`CERT_REJECTED:${code}`);
      } else {
        console.error(`NETWORK_ERROR:${code}:${error.message}`);
        process.exitCode = 3;
      }
    });
  ' "$url" 2>&1)
  rc=$?
  if [[ $rc -eq 0 && "$output" == CERT_REJECTED:* ]]; then
    printf 'PASS node rejected %s (%s)\n' "$url" "${output#CERT_REJECTED:}"
  else
    printf 'FAIL node %s (wanted certificate rejection, got rc=%d): %s\n' \
      "$url" "$rc" "$output" >&2
    fail=1
  fi
}

if [[ " ${NODE_OPTIONS:-} " != *" --use-openssl-ca "* ]]; then
  printf 'FAIL NODE_OPTIONS does not contain --use-openssl-ca\n' >&2
  fail=1
fi
if [[ -z "${SSL_CERT_FILE:-}" || ! -r "${SSL_CERT_FILE:-}" ]]; then
  printf 'FAIL SSL_CERT_FILE is not a readable bundle\n' >&2
  fail=1
fi

for url in "${URLS[@]}"; do
  probe_curl "$url"
  probe_node "$url"
done

exit "$fail"
