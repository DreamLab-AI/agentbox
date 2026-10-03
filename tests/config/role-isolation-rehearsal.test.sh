#!/usr/bin/env bash
# X-1 step 1 (custody design §4, W6a): the role-isolation rehearsal decides correctly.
#
# The property under test: scripts/activation/role-isolation-rehearsal.sh exits 0 only when every
# isolation row holds with the flag on, 2 with the flag off, and 1 when any single check (a)-(f)
# fails or a required probe could not be made; its receipt conforms to
# docs/estate-closeout/schema/x1-rehearsal.schema.json and never carries a secret value.
#
# The rehearsal runs against a scratch root (RH_ROOT) with a fake /proc, fake supervisorctl,
# stat, docker, sudo and curl, and a fake identity-port client. The client signs with throwaway
# keys generated per run through the estate's own NostrBridge.buildNip98Header / nostr-tools,
# so check (c) exercises the real verifier (NostrBridge.verifyNip98). No live process, socket,
# relay or key is touched.
#
# Cases:
#   1. everything isolated, flag on                 -> 0 PASS, schema-valid
#   2. flag absent                                  -> 2 STAGED, every row not_applicable
#   3. (a) the identity secret is devuser-readable  -> 1, only (a) fails
#   4. (b) nostr-relay runs under a non-role uid    -> 1, only (b) fails
#   5. (c) the port signs NIP-98 with the wrong key -> 1, only (c) fails
#   6. (d) the newest block is 1300 s old (> 2x600) -> 1, only (d) fails
#   7. (e) a devuser process carries AGENTBOX_NSEC  -> 1, only (e) fails; the value is nowhere
#   8. (f) devuser is in group 0                    -> 1, only (f) fails
#   9. required but skipped: the port socket absent -> 1, (c) fails "not attempted"
#  10. required but skipped: a role program not baked in the roles config -> 1, (b) fails
#  11. no receipt from any case carries a fixture secret value
#  13. no /etc/agentbox/role-accounts.json -> 1 (no derived numbering); 14. no role-secrets.tsv -> 1
#  15. a role at a reserved id (965, the host docker group) -> 1; 16. --print-registry shape
#  12. host half refuses to run inside a container; flags a host uid in 960-979; passes a clean host
# Run: bash tests/config/role-isolation-rehearsal.test.sh
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
SCRIPT="$REPO/scripts/activation/role-isolation-rehearsal.sh"
HOST_SCRIPT="$REPO/scripts/activation/role-isolation-rehearsal.host.sh"
SCHEMA="$REPO/docs/estate-closeout/schema/x1-rehearsal.schema.json"
VERIFIER="$REPO/mcp/servers/nostr-bridge.js"
AJV_DIR="$REPO/management-api/node_modules/ajv"

pass=0; fail=0
ok()  { pass=$((pass+1)); printf '  ok   %s\n' "$1"; }
bad() { fail=$((fail+1)); printf '  FAIL %s\n    %s\n' "$1" "${2:-}"; }

if [ "$(id -u)" = 0 ]; then
  echo "role-isolation-rehearsal.test: must run unprivileged (EACCES fixtures rely on file modes)" >&2
  exit 1
fi
for need in jq node python3; do command -v "$need" >/dev/null || { echo "needs $need" >&2; exit 1; }; done
[ -r "$VERIFIER" ] || { echo "needs $VERIFIER (estate NIP-98 verifier)" >&2; exit 1; }

ROOT="$(mktemp -d "${TMPDIR:-/tmp}/x1-rehearsal-test.XXXXXX")"
cleanup() { chmod -R u+rwX "$ROOT" 2>/dev/null; rm -rf "$ROOT"; }
trap cleanup EXIT
ME="$(id -u)"
NOW="$(date -u +%s)"
SENTINEL="x1-fixture-secret-value-7f3a"

# ── shared fakes ───────────────────────────────────────────────────────────────────────────
BIN="$ROOT/bin"; mkdir -p "$BIN"
cat >"$BIN/stat" <<'SH'
#!/usr/bin/env bash
# fake stat: "<path>\t<uid gid mode dev>" overrides from $FAKE_STAT_TABLE, else the real stat.
p="${*: -1}"
if [ -r "${FAKE_STAT_TABLE:-}" ]; then
  line="$(awk -F'\t' -v p="$p" '$1 == p {print $2; exit}' "$FAKE_STAT_TABLE")"
  [ -n "$line" ] && { echo "$line"; exit 0; }
fi
exec stat "$@"
SH
cat >"$BIN/supervisorctl" <<'SH'
#!/usr/bin/env bash
cat "$FAKE_SUP"
SH
cat >"$BIN/docker" <<'SH'
#!/usr/bin/env bash
echo "permission denied while trying to connect to the docker API" >&2; exit 1
SH
cat >"$BIN/sudo" <<'SH'
#!/usr/bin/env bash
exit 1
SH
cat >"$BIN/curl" <<'SH'
#!/usr/bin/env bash
cat "$FAKE_TIP"
SH
# The fake identity port client: the sign-request contract of the design §2.5.
cat >"$BIN/sign-client.cjs" <<'JS'
const fs = require('fs');
const tools = require(process.env.FAKE_NOSTR_TOOLS);
const { NostrBridge } = require(process.env.FAKE_VERIFIER);
const keys = JSON.parse(fs.readFileSync(process.env.FAKE_KEYS, 'utf8'));
const sk = (id) => Uint8Array.from(Buffer.from(keys[id], 'hex'));
const op = process.argv[2];
const req = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
const receipt = (decision) => fs.appendFileSync(process.env.FAKE_RECEIPTS, JSON.stringify({ op, key: req.key || null, decision }) + '\n');
const refuse = (why) => { receipt('refuse'); process.stdout.write(JSON.stringify({ refused: { op, reason: why } })); process.exit(1); };
const reply = (o) => { receipt('admit'); process.stdout.write(JSON.stringify(o)); };
const signer = (id) => ({ sign: async (ev) => tools.finalizeEvent(ev, sk(id)) });
(async () => {
  switch (op) {
    case 'pubkey': return reply({ pubkey: tools.getPublicKey(sk(req.key)) });
    case 'nip98':
      if (!String(req.url).startsWith('https://pods.example.test/')) return refuse('url not allowlisted');
      return reply({ header: await NostrBridge.buildNip98Header(signer(process.env.FAKE_WRONG_KEY ? 'junkiejarvis' : req.key), req.method, req.url) });
    case 'forum_event':
      return reply({ event: tools.finalizeEvent({ kind: req.kind, created_at: Math.floor(Date.now() / 1000), tags: [], content: req.content }, sk('junkiejarvis')) });
    case 'nip42_auth':
      return reply({ event: tools.finalizeEvent({ kind: 22242, created_at: Math.floor(Date.now() / 1000), tags: [['relay', req.relay], ['challenge', req.challenge]], content: '' }, sk('core')) });
    case 'dm_unwrap': return refuse('dm_unwrap is ab-gateway only');
    default: return refuse('unknown op');
  }
})();
JS
printf '#!/usr/bin/env bash\nexec node "%s/sign-client.cjs" "$@"\n' "$BIN" >"$BIN/sign-client"
# The fake relay: takes the challenge it would issue, asks the port, verifies the AUTH event.
cat >"$BIN/relay-auth" <<'SH'
#!/usr/bin/env bash
ev="$(printf '{"key":"core","relay":"%s","challenge":"x1-challenge"}' "$1" | $RH_SIGN_CLIENT nip42_auth)" || { echo '{"accepted":false,"reason":"port refused"}'; exit 1; }
node -e '
const t = require(process.env.FAKE_NOSTR_TOOLS); const ev = JSON.parse(process.argv[1]).event;
const ok = t.verifyEvent(ev) && ev.kind === 22242 && ev.tags.some((x) => x[0] === "challenge" && x[1] === "x1-challenge");
process.stdout.write(JSON.stringify({ accepted: ok, event_id: ev.id, reason: ok ? null : "bad auth" })); process.exit(ok ? 0 : 1);' "$ev"
SH
chmod +x "$BIN"/*
NOSTR_TOOLS="$(cd "$REPO/mcp" && node -p 'require.resolve("nostr-tools")')"
node -e '
const t = require(process.argv[1]); const hex = (b) => Buffer.from(b).toString("hex");
process.stdout.write(JSON.stringify({ core: hex(t.generateSecretKey()), junkiejarvis: hex(t.generateSecretKey()) }));' "$NOSTR_TOOLS" >"$ROOT/keys.json"
CORE_PUB="$(node -e 'const t=require(process.argv[1]);const k=require(process.argv[2]);process.stdout.write(t.getPublicKey(Uint8Array.from(Buffer.from(k.core,"hex"))))' "$NOSTR_TOOLS" "$ROOT/keys.json")"
JJ_PUB="$(node -e 'const t=require(process.argv[1]);const k=require(process.argv[2]);process.stdout.write(t.getPublicKey(Uint8Array.from(Buffer.from(k.junkiejarvis,"hex"))))' "$NOSTR_TOOLS" "$ROOT/keys.json")"

# ── the PASS fixture ───────────────────────────────────────────────────────────────────────
# fixture <dir>: a scratch root where every isolation property holds.
fixture() {
  local F="$1"
  mkdir -p "$F"/{etc/agentbox,run/agentbox,var/log,var/lib/agentbox/events/sign,var/lib/agentbox/identities,var/lib/agentbox/secrets}
  cat >"$F/etc/agentbox.toml" <<'TOML'
[security]
audit_acknowledged = true
role_isolation = true

[integrations.solid_pod_rs]
base_url = "https://pods.example.test"

[sidechain]
enabled = true
faucet = true
faucet_key_file = "/home/devuser/workspace/sidestr/agents/treasury.key"
TOML
  {
    for p in nostr-relay serve-identity nostr-gateway nip98-proxy sidestr-producer sidestr-faucet management-api; do
      printf '[program:%s]\ncommand=/nix/store/x-%s/bin/run\nenvironment=HOME="/var/lib/agentbox/home/%s",PATH="/nix/store/x/bin"\n\n' "$p" "$p" "$p"
    done
  } >"$F/etc/supervisord.roles.conf"
  cp "$F/etc/supervisord.roles.conf" "$F/etc/supervisord.conf"
  # W1's table as the image bakes it, and the plan `role-accounts isolate` resolves from it for
  # this config (dreamlab on, dreamlab-txbt4 off: its roles get no rows).
  cp "$REPO/config/role-accounts.json" "$F/etc/agentbox/role-accounts.json"
  {
    printf '# agentbox role-secrets plan (ADR-2122). Generated by `agentbox-manifest role-accounts isolate`; do not edit.\n'
    printf 'root\t/run/secrets\n'
    printf 'role\tab-identity\t960\t960\n'
    printf 'env\tab-identity\tnostr.key\tAGENTBOX_BRIDGE_SK\n'
    for v in AGENTBOX_PRIVKEY_HEX AGENTBOX_NSEC JUNKIEJARVIS_PRIVKEY_HEX CONCIERGE_PRIVKEY_HEX; do printf 'env\tab-identity\t%s\t%s\n' "$v" "$v"; done
    printf 'role\tab-gateway\t961\t961\nrole\tab-ingress\t962\t962\n'
    for v in NIP98_PROXY_ALLOW_BEARER NIP98_PROXY_SESSION_SECRET; do printf 'env\tab-ingress\t%s\t%s\n' "$v" "$v"; done
    printf 'role\tab-spend\t963\t963\nrole\tab-sidestr-dreamlab\t964\t964\n'
    printf 'file\tab-sidestr-dreamlab\tsigner.key\t/var/lib/agentbox/secrets/sidestr-dreamlab.key\n'
    printf 'file\tab-sidestr-dreamlab\tparent.credential\t/var/lib/agentbox/secrets/sidestr-tbtc4.cookie\n'
    printf 'role\tab-faucet-dreamlab\t966\t966\n'
    printf 'file\tab-faucet-dreamlab\ttreasury.key\t/home/devuser/workspace/sidestr/agents/treasury.key\n'
    printf 'role\tab-sidestr-dreamlab-txbt4\t967\t967\nrole\tab-faucet-dreamlab-txbt4\t968\t968\n'
  } >"$F/etc/agentbox/role-secrets.tsv"
  cat >"$F/sup" <<SUP
management-api                   RUNNING   pid 200, uptime 1:00:00
nip98-proxy                      RUNNING   pid 103, uptime 1:00:00
nostr-gateway                    RUNNING   pid 102, uptime 1:00:00
nostr-relay                      RUNNING   pid 101, uptime 1:00:00
serve-identity                   RUNNING   pid 106, uptime 1:00:00
sidestr-faucet                   RUNNING   pid 105, uptime 1:00:00
sidestr-producer                 RUNNING   pid 104, uptime 1:00:00
SUP
  mkproc() { # <pid> <uid> <cmdline-with-|-separators> <environ-with-|-separators> <environ-mode>
    mkdir -p "$F/proc/$1"
    printf 'Name:\tx\nUid:\t%s\t%s\t%s\t%s\nGid:\t0\t0\t0\t0\n' "$2" "$2" "$2" "$2" >"$F/proc/$1/status"
    printf '%s' "$3" | tr '|' '\0' >"$F/proc/$1/cmdline"
    printf '%s' "$4" | tr '|' '\0' >"$F/proc/$1/environ"; chmod "$5" "$F/proc/$1/environ"
  }
  mkproc 1   0    'supervisord|-c|/etc/supervisord.roles.conf|' 'PATH=/bin|' 000
  mkproc 101 960  'nostr-pod-bridge|serve|' 'HOME=/var/lib/agentbox/home/ab-identity|' 000
  mkproc 106 960  'nostr-pod-bridge|serve-identity|' 'AGENTBOX_SECRETS_DIR=/run/secrets/ab-identity|' 000
  mkproc 102 961  'node|gateway.cjs|' 'HOME=/x|' 000
  mkproc 103 962  'node|proxy.mjs|' 'HOME=/x|' 000
  mkproc 104 964  'node|siding.mjs|produce|--key-file|/run/secrets/ab-sidestr-dreamlab/signer.key|' 'HOME=/x|' 000
  mkproc 105 966  'sidestr-agent|--key-file|/run/secrets/ab-faucet-dreamlab/treasury.key|' 'HOME=/x|' 000
  mkproc 200 "$ME" 'node|server.js|' 'PATH=/bin|BRIDGE_TOKEN=devuser-class|MANAGEMENT_API_KEY=devuser-class|' 600
  # Secrets: the role dirs are untraversable to the runner (as to devuser); stat reports the role.
  for d in ab-identity:nostr.key ab-identity:AGENTBOX_PRIVKEY_HEX ab-identity:AGENTBOX_NSEC ab-identity:JUNKIEJARVIS_PRIVKEY_HEX ab-identity:CONCIERGE_PRIVKEY_HEX ab-sidestr-dreamlab:signer.key ab-sidestr-dreamlab:parent.credential ab-faucet-dreamlab:treasury.key; do
    mkdir -p "$F/run/secrets/${d%%:*}"; printf 'not-a-secret-%s' "$SENTINEL" >"$F/run/secrets/${d%%:*}/${d#*:}"
  done
  mkdir -p "$F/run/secrets/ab-gateway" "$F/run/secrets/ab-ingress" "$F/run/secrets/ab-identity-port"
  printf 'not-a-secret-%s' "$SENTINEL" >"$F/var/lib/agentbox/identities/agentbox-core.json"
  for f in sidestr-dreamlab.key sidestr-tbtc4.cookie; do printf 'not-a-secret' >"$F/var/lib/agentbox/secrets/$f"; done
  python3 -c 'import socket,sys; socket.socket(socket.AF_UNIX).bind(sys.argv[1])' "$F/run/secrets/ab-identity-port/identity.sock"
  printf 'export AGENTBOX_NPUB=npub1x\nexport AGENTBOX_X_ONLY_PUBKEY_HEX=%s\n' "$CORE_PUB" >"$F/run/agentbox/identity.env"
  printf '[bootstrap] role custody: 6 roles populated\n' >"$F/var/log/bootstrap.log"
  printf '{"height":42,"hash":"00","time":%s}\n' "$((NOW - 100))" >"$F/tip"
  printf '/run\t1000 1000 755 1\n/run/secrets\t0 0 711 2\n/var/run/docker.sock\t0 0 660 1\n' >"$F/stat-table"
  printf '/run/secrets/ab-identity\t960 960 500 2\n/run/secrets/ab-gateway\t961 961 500 2\n/run/secrets/ab-ingress\t962 962 500 2\n' >>"$F/stat-table"
  printf '/run/secrets/ab-sidestr-dreamlab\t964 964 500 2\n/run/secrets/ab-faucet-dreamlab\t966 966 500 2\n' >>"$F/stat-table"
  sed -i "s#^/#$F/#" "$F/stat-table"
  echo "1000 998" >"$F/groups"
  lock "$F"
}
# lock <dir>: apply the modes that stand in for other owners. The port's socket dir
# stays traversable: devuser reaches it as a member of ab-identity-port.
lock() {
  local d
  for d in "$1"/run/secrets/ab-*; do [ "${d##*/}" = ab-identity-port ] || chmod 000 "$d"; done
  chmod 000 "$1/var/lib/agentbox/identities" "$1/var/lib/agentbox/secrets"
}

# rehearse <dir> [VAR=value ...]: run the rehearsal; sets $rc $out $receipt
rehearse() {
  local F="$1"; shift
  rm -rf "$F/receipts"
  out="$(env RH_ROOT="$F" RH_STAT="$BIN/stat" FAKE_STAT_TABLE="$F/stat-table" \
    RH_SUPERVISORCTL="$BIN/supervisorctl" FAKE_SUP="$F/sup" RH_DOCKER="$BIN/docker" RH_SUDO="$BIN/sudo" \
    RH_CURL="$BIN/curl" FAKE_TIP="$F/tip" RH_GROUPS="$(cat "$F/groups")" RH_DEVUSER_UID="$ME" RH_NOW="$NOW" \
    RH_SIGN_CLIENT="$BIN/sign-client" RH_RELAY_AUTH="$BIN/relay-auth" RH_NIP98_VERIFIER="$VERIFIER" \
    FAKE_NOSTR_TOOLS="$NOSTR_TOOLS" FAKE_VERIFIER="$VERIFIER" FAKE_KEYS="$ROOT/keys.json" \
    FAKE_RECEIPTS="$F/var/lib/agentbox/events/sign/receipts.jsonl" \
    RH_EXPECT_CORE_PUBKEY="$CORE_PUB" RH_EXPECT_JJ_PUBKEY="$JJ_PUB" RH_IMAGE_ID="sha256:fixture" \
    AGENTBOX_X_ONLY_PUBKEY_HEX= JUNKIEJARVIS_PUBKEY= "$@" \
    bash "$SCRIPT" --receipt-dir "$F/receipts" 2>&1)"; rc=$?
  receipt="$(find "$F/receipts" -name 'x1-rehearsal-*.json' 2>/dev/null | head -1)"
  [ -n "$receipt" ] && cp "$receipt" "$(mktemp "$ROOT/all-receipts.XXXXXX.json")"
}
field() { jq -r "$1" "$receipt" 2>/dev/null; }
failed() { field '.summary.failed_checks | join(",")'; }
valid() {
  node -e '
const Ajv = require(process.argv[1] + "/dist/2020").default; const fs = require("fs");
const ajv = new Ajv({ allErrors: true, strict: false });
const v = ajv.compile(JSON.parse(fs.readFileSync(process.argv[2], "utf8")));
if (!v(JSON.parse(fs.readFileSync(process.argv[3], "utf8")))) { console.error(JSON.stringify(v.errors.slice(0, 3))); process.exit(1); }' "$AJV_DIR" "$SCHEMA" "$receipt"
}
# expect_fail <label> <check> : rc 1, verdict FAIL, exactly <check> failed, schema-valid
expect_fail() {
  if [ "$rc" = 1 ] && [ "$(field .verdict)" = FAIL ] && [ "$(failed)" = "$2" ] && valid 2>/dev/null; then ok "$1"
  else bad "$1" "rc=$rc verdict=$(field .verdict) failed=$(failed) out=$(grep -E 'FAIL|rehearsal:' <<<"$out" | head -5)"; fi
}
fresh() { local F="$ROOT/case-$1"; fixture "$F"; echo "$F"; }

echo "X-1 role-isolation rehearsal (custody design §4)"

F="$(fresh 1)"; rehearse "$F"
if [ "$rc" = 0 ] && [ "$(field .verdict)" = PASS ] && [ "$(field .summary.fail)" = 0 ] && [ "$(field '.checks | map(.check) | unique | join("")')" = abcdef ] && valid; then
  ok "everything isolated, flag on: exit 0 PASS, every check (a)-(f) present, receipt schema-valid"
else bad "everything isolated, flag on: exit 0 PASS" "rc=$rc verdict=$(field .verdict) failed=$(failed) out=$(grep -E 'FAIL|rehearsal:' <<<"$out" | head -8)"; fi

F="$(fresh 2)"; sed -i '/^role_isolation/d' "$F/etc/agentbox.toml"; rehearse "$F"
if [ "$rc" = 2 ] && [ "$(field .verdict)" = STAGED ] && [ "$(field .flag.source)" = absent-default-false ] \
   && [ "$(field '[.checks[] | select(.status != "not_applicable" or .reason != "flag off")] | length')" = 0 ] && [ "$(field .summary.would_fail)" = 0 ] && valid; then
  ok "flag absent: exit 2 STAGED, every row 'not_applicable: flag off', would_pass recorded"
else bad "flag absent: exit 2 STAGED" "rc=$rc verdict=$(field .verdict) src=$(field .flag.source)"; fi

F="$(fresh 3)"; chmod 755 "$F/run/secrets/ab-identity"; chmod 644 "$F/run/secrets/ab-identity"/*; rehearse "$F"
expect_fail "(a) identity secret readable by devuser: exit 1, only (a) fails" a

F="$(fresh 4)"; sed -i 's/^Uid:.*/Uid:\t4321\t4321\t4321\t4321/' "$F/proc/101/status"; rehearse "$F"
expect_fail "(b) nostr-relay running under a non-role uid: exit 1, only (b) fails" b

F="$(fresh 5)"; rehearse "$F" FAKE_WRONG_KEY=1
expect_fail "(c) port signs the pods NIP-98 with the wrong key: verifier catches it, only (c) fails" c
if [ "$(field '.checks[] | select(.target == "pods-nip98") | .evidence.verifier')" = NostrBridge.verifyNip98 ] \
   && [ "$(field '.checks[] | select(.target == "pods-nip98") | .observed')" = "valid=true pubkey_match=false" ]; then
  ok "(c) the header was really verified (valid signature, wrong signer)"
else bad "(c) the header was really verified" "$(field '.checks[] | select(.target == "pods-nip98")')"; fi

F="$(fresh 6)"; printf '{"height":42,"hash":"00","time":%s}\n' "$((NOW - 1300))" >"$F/tip"; rehearse "$F"
expect_fail "(d) newest block 1300 s old with a 600 s interval: exit 1, only (d) fails" d

F="$(fresh 7)"; printf 'PATH=/bin\0AGENTBOX_NSEC=%s\0' "$SENTINEL" >"$F/proc/200/environ"; rehearse "$F"
expect_fail "(e) a devuser process carries AGENTBOX_NSEC: exit 1, only (e) fails" e
if [ "$(field '.checks[] | select(.target == "devuser-environ") | .evidence.by_name[0].name')" = AGENTBOX_NSEC ] \
   && ! grep -q "$SENTINEL" "$receipt" && ! grep -q "$SENTINEL" <<<"$out"; then
  ok "(e) the hit is named, the value appears in neither the receipt nor the output"
else bad "(e) the hit is named, the value appears nowhere" "$(field '.checks[] | select(.target == "devuser-environ") | .evidence')"; fi

F="$(fresh 8)"; echo "1000 0 998" >"$F/groups"; rehearse "$F"
expect_fail "(f) devuser in group 0: exit 1, only (f) fails" f

F="$(fresh 9)"; rm -f "$F/run/secrets/ab-identity-port/identity.sock"; rehearse "$F"
expect_fail "required but skipped: port socket absent fails (c), never passes" c
if [ "$(field '[.checks[] | select(.check == "c" and (.observed | startswith("not attempted")))] | length')" -ge 6 ]; then
  ok "required but skipped: each unattempted (c) row is a FAIL saying 'not attempted'"
else bad "required but skipped: each unattempted (c) row is a FAIL" "$(field '[.checks[] | select(.check == "c") | .observed]')"; fi

F="$(fresh 10)"; sed -i '/^\[program:nostr-gateway\]/,/^$/d' "$F/etc/supervisord.roles.conf"; rehearse "$F"
expect_fail "required but skipped: a role program missing from the roles config fails (b)" b

F="$(fresh 13)"; rm -f "$F/etc/agentbox/role-accounts.json"; rehearse "$F"
if [ "$rc" = 1 ] && grep -q 'role-accounts.json is missing' <<<"$out"; then ok "no role table: exit 1, no derived numbering"
else bad "no role table: exit 1, no derived numbering" "rc=$rc out=$(tail -3 <<<"$out")"; fi

F="$(fresh 14)"; rm -f "$F/etc/agentbox/role-secrets.tsv"; rehearse "$F"
if [ "$rc" = 1 ] && grep -q 'role-secrets.tsv is missing' <<<"$out"; then ok "a role table without its plan: exit 1"
else bad "a role table without its plan: exit 1" "rc=$rc out=$(tail -3 <<<"$out")"; fi

F="$(fresh 15)"; jq '(.roles[] | select(.name == "ab-faucet-dreamlab") | .uid) = 965' "$REPO/config/role-accounts.json" >"$F/etc/agentbox/role-accounts.json"; rehearse "$F"
if [ "$rc" = 1 ] && grep -q 'reserved' <<<"$out"; then ok "a role at uid 965 (host docker group, reserved_ids): exit 1"
else bad "a role at uid 965: exit 1" "rc=$rc out=$(tail -3 <<<"$out")"; fi

reg="$(RH_ROOT="$ROOT/case-1" bash "$SCRIPT" --print-registry 2>&1)"
if jq -e '
  (.roles | map(.name) | index("ab-faucet-dreamlab")) as $_
  | (.roles[] | select(.name == "ab-faucet-dreamlab") | .uid == 966 and .programs == ["sidestr-faucet"] and .files == ["treasury.key"])
  and (.roles[] | select(.name == "ab-sidestr-dreamlab") | .enabled and .chain == "dreamlab" and .interval == 600 and .files == ["signer.key","parent.credential"])
  and (.roles[] | select(.name == "ab-sidestr-dreamlab-txbt4") | (.enabled | not) and .programs == [] and .files == [])
  and (.roles[] | select(.name == "ab-identity") | (.env | index("AGENTBOX_NSEC")) != null and (.files | length) == 5)
  and (.roles[] | select(.name == "ab-identity") | (.env | index("AGENTBOX_AGENT_PRIVKEY_HEX")) != null and (.env | index("OPERATOR_NOSTR_PRIVKEY")) != null)
  and (.classified_root_env | map(.name) == ["TAILSCALE_AUTHKEY"])
  and (.roles[] | select(.name == "ab-spend") | .deferred != null)
  and ([.roles[].uid] | index(965) == null)' <<<"$reg" >/dev/null 2>&1; then
  ok "--print-registry reads W1's table, its plan and W2's ROLE class: faucet 966, txbt4 roles undelivered, ab-spend deferred, 965 unused"
else bad "--print-registry reads W1's table and plan" "$(head -c 600 <<<"$reg")"; fi

n_receipts="$(find "$ROOT" -maxdepth 1 -name 'all-receipts.*.json' | wc -l)"
if [ "$n_receipts" -ge 10 ] && ! grep -l -e "$SENTINEL" -e 'not-a-secret' "$ROOT"/all-receipts.*.json >/dev/null 2>&1; then
  ok "no receipt from any of the $n_receipts cases carries a fixture secret value"
else bad "no receipt carries a fixture secret value" "$(grep -l -e "$SENTINEL" -e 'not-a-secret' "$ROOT"/all-receipts.*.json)"; fi

# ── the host half ──────────────────────────────────────────────────────────────────────────
H="$ROOT/host"; mkdir -p "$H/bin" "$H/receipts"
cat >"$H/bin/docker" <<'SH'
#!/usr/bin/env bash
# fake host docker: inspect answers the image; exec runs the probe locally against the fixture.
case "$1" in
  inspect) case "$*" in *'.Image'*) echo "sha256:hostfixture" ;; *'.State.Running'*) echo true ;; *Env*) echo "PATH=/nix/store/x/bin:/home/devuser/workspace/.cargo/bin" ;; esac ;;
  exec) shift; user=0; while [ $# -gt 0 ]; do case "$1" in -u) user="$2"; shift 2 ;; -i) shift ;; -e) shift 2 ;; *) break ;; esac; done
        shift; # container name
        echo "$user" >>"$FAKE_EXEC_USERS"
        if [ "$*" = "/bin/bash -s" ]; then cat >/dev/null; cat "$FAKE_PROBE_OUT"
        else args=(); for x in "$@"; do if [ "${x#/}" != "$x" ] && [ -e "$RH_ROOT$x" ]; then args+=("$RH_ROOT$x"); else args+=("$x"); fi; done; "${args[@]}"; fi ;;
  *) exit 1 ;;
esac
SH
cat >"$H/bin/getent" <<'SH'
#!/usr/bin/env bash
awk -F: -v db="$1" -v id="$2" '$1 == db && $3 == id {print $2 ":x:" $3; f=1} END {exit !f}' "$FAKE_GETENT"
SH
chmod +x "$H/bin"/*
: >"$H/getent"
# The probe output a clean container gives (the host half's in-container root probe, pre-recorded).
jq -nc '{check:"a",target:"/run/secrets/ab-identity/nostr.key",expected:"role reads, devuser and other roles refused",observed:"role ok; devuser EACCES; ab-gateway EACCES",ok:true,evidence:{path:"/run/secrets/ab-identity/nostr.key",uid:960,mode:"400"}}' >"$H/probe-ok"
jq -nc '{check:"e",target:"all-environ",expected:"no classified name outside its role",observed:"0 hits",ok:true,evidence:{hits:[]}}' >>"$H/probe-ok"
host() { # host [VAR=value ...]: run the host half against the fakes; sets $rc $out $receipt
  rm -f "$H"/receipts/*
  out="$(env HR_TEST_ROOT="$H" HR_DOCKER="$H/bin/docker" HR_GETENT="$H/bin/getent" FAKE_GETENT="$H/getent" \
    FAKE_PROBE_OUT="$H/probe-ok" FAKE_EXEC_USERS="$H/exec-users" HR_HOST_SOCKET="$H/docker.sock" HR_STAT="$BIN/stat" \
    FAKE_STAT_TABLE="$H/stat-table" HR_REGISTRY="$(RH_ROOT="$ROOT/case-1" bash "$SCRIPT" --print-registry)" \
    "$@" bash "$HOST_SCRIPT" --receipt-dir "$H/receipts" --container agentbox-fixture 2>&1)"; rc=$?
  receipt="$(find "$H/receipts" -name 'x1-rehearsal-host-*.json' 2>/dev/null | head -1)"
}
printf '%s/docker.sock\t0 965 660 1\n' "$H" >"$H/stat-table"; : >"$H/docker.sock"

out="$(env -u HR_TEST_ROOT bash "$HOST_SCRIPT" 2>&1)"; rc=$?
if [ "$rc" = 1 ] && grep -q 'never from inside the container' <<<"$out"; then ok "host half refuses to run inside the container"
else bad "host half refuses to run inside the container" "rc=$rc out=$out"; fi

host RH_ROOT="$ROOT/case-1" RH_MANIFEST="$ROOT/case-1/etc/agentbox.toml"
if [ "$rc" = 0 ] && [ "$(field .half)" = host ] && [ "$(field .verdict)" = PASS ] && [ "$(field '.checks[] | select(.target == "/var/run/docker.sock (host)") | .status')" = recorded ] && valid; then
  ok "host half, clean host and container: exit 0 PASS, socket mode recorded, schema-valid"
else bad "host half, clean host: exit 0 PASS" "rc=$rc verdict=$(field .verdict) out=$(tail -5 <<<"$out")"; fi

printf 'passwd:alice:964\n' >"$H/getent"
host RH_ROOT="$ROOT/case-1" RH_MANIFEST="$ROOT/case-1/etc/agentbox.toml"
if [ "$rc" = 1 ] && [ "$(failed)" = h-uid-collision ] && [ "$(field '.uid_table.host_accounts[0].name')" = alice ] && valid; then
  ok "host half: a host account at uid 964 is a collision FAIL (§8.5), named in the receipt"
else bad "host half: a host account at uid 964 is a collision FAIL" "rc=$rc failed=$(failed) out=$(tail -5 <<<"$out")"; fi

echo
echo "passed $pass, failed $fail"
[ "$fail" -eq 0 ]
