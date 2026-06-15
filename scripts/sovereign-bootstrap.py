#!/usr/bin/env python3
import json
import os
import pathlib
import subprocess
import time
import tomllib
from ecdsa import SECP256k1, SigningKey


CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"


def _bech32_polymod(values):
    generator = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]
    chk = 1
    for value in values:
        top = chk >> 25
        chk = ((chk & 0x1FFFFFF) << 5) ^ value
        for i in range(5):
            chk ^= generator[i] if ((top >> i) & 1) else 0
    return chk


def _bech32_hrp_expand(hrp):
    return [ord(x) >> 5 for x in hrp] + [0] + [ord(x) & 31 for x in hrp]


def _bech32_create_checksum(hrp, data):
    values = _bech32_hrp_expand(hrp) + data
    polymod = _bech32_polymod(values + [0, 0, 0, 0, 0, 0]) ^ 1
    return [(polymod >> 5 * (5 - i)) & 31 for i in range(6)]


def _convertbits(data, frombits, tobits, pad=True):
    acc = 0
    bits = 0
    result = []
    maxv = (1 << tobits) - 1
    for value in data:
        acc = (acc << frombits) | value
        bits += frombits
        while bits >= tobits:
            bits -= tobits
            result.append((acc >> bits) & maxv)
    if pad and bits:
        result.append((acc << (tobits - bits)) & maxv)
    return result


def bech32_encode(hrp, payload):
    data = _convertbits(payload, 8, 5)
    combined = data + _bech32_create_checksum(hrp, data)
    return hrp + "1" + "".join(CHARSET[d] for d in combined)


def bech32_decode(bech):
    bech = bech.lower().strip()
    pos = bech.rfind("1")
    if pos < 1 or pos + 7 > len(bech):
        return None, None
    hrp = bech[:pos]
    data = [CHARSET.find(c) for c in bech[pos + 1:]]
    if any(d == -1 for d in data):
        return None, None
    decoded = _convertbits(data[:-6], 5, 8, False)
    if decoded is None:
        return None, None
    return hrp, bytes(decoded)


def load_config(path):
    with open(path, "rb") as fh:
        return tomllib.load(fh)


def write_json(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def _x_only_pubkey_with_even_y(signing_key):
    """Return the BIP-340 x-only pubkey (32 bytes) and force even-y by negating
    the secret key when the derived public key has odd y.

    NIP-19 npub MUST encode the 32-byte x-only pubkey, not the 64-byte SEC1
    uncompressed form. BIP-340 §3.1 (lift_x) requires even y; clients comparing
    pubkeys treat odd-y and even-y as the same identity, but signers must hold
    the secret whose corresponding pubkey has even y. Returns (x_only_bytes,
    canonical_signing_key) where canonical_signing_key has guaranteed even-y.
    """
    verifying_key = signing_key.get_verifying_key()
    public_bytes = verifying_key.to_string()  # 64-byte SEC1 (X || Y)
    y_bytes = public_bytes[32:]
    # secp256k1 group order; lift_x requires y even (per BIP-340).
    if y_bytes[-1] & 0x01:
        n = SECP256k1.order
        d = int.from_bytes(signing_key.to_string(), "big")
        d_neg = (n - d) % n
        signing_key = SigningKey.from_string(
            d_neg.to_bytes(32, "big"), curve=SECP256k1
        )
        verifying_key = signing_key.get_verifying_key()
        public_bytes = verifying_key.to_string()
    x_only = public_bytes[:32]
    return x_only, signing_key, public_bytes


def _keypair_from_privkey_hex(privkey_hex):
    signing_key = SigningKey.from_string(bytes.fromhex(privkey_hex), curve=SECP256k1)
    x_only, signing_key, public_bytes = _x_only_pubkey_with_even_y(signing_key)
    private_bytes = signing_key.to_string()
    return {
        "private_key_hex": private_bytes.hex(),
        "public_key_hex": public_bytes.hex(),
        "x_only_pubkey_hex": x_only.hex(),
        "nsec": bech32_encode("nsec", private_bytes),
        # NIP-19 §npub: bech32 encodes the BIP-340 x-only pubkey (32 bytes),
        # not the SEC1 uncompressed encoding. Encoding the 64-byte form
        # produces an npub whose decoded payload no Nostr relay or client
        # can verify against an event signature.
        "npub": bech32_encode("npub", x_only),
    }


def ensure_identity(agent_id, identity_root):
    identity_file = identity_root / f"{agent_id}.json"

    # Env-supplied key takes priority — set AGENTBOX_NSEC (bech32 nsec1…) or
    # AGENTBOX_PRIVKEY_HEX (64-char hex) in .env to use a stable signing identity.
    # Written to the identity file so all downstream consumers see it consistently.
    privkey_hex = os.getenv("AGENTBOX_PRIVKEY_HEX", "").strip().lower()
    if not privkey_hex:
        nsec_env = os.getenv("AGENTBOX_NSEC", "").strip()
        if nsec_env:
            hrp, privkey_bytes = bech32_decode(nsec_env)
            if hrp == "nsec" and privkey_bytes and len(privkey_bytes) == 32:
                privkey_hex = privkey_bytes.hex()

    if privkey_hex:
        keypair = _keypair_from_privkey_hex(privkey_hex)
        identity = {"agent_id": agent_id, "created_at": int(time.time()), **keypair}
        write_json(identity_file, identity)
        return identity

    # No env key supplied — use persisted identity or generate one on first boot.
    if identity_file.exists():
        identity = json.loads(identity_file.read_text(encoding="utf-8"))
        # Migration: identities written by older versions of this script
        # encoded npub from the 64-byte SEC1 pubkey instead of the 32-byte
        # BIP-340 x-only pubkey. Detect and correct in place. Existing
        # private keys are valid; we only need to re-derive the public
        # representation and re-encode npub. If the persisted private key
        # corresponds to an odd-y pubkey we negate it so the canonical
        # identity now satisfies BIP-340 even-y.
        needs_migration = (
            "x_only_pubkey_hex" not in identity
            or len(identity.get("x_only_pubkey_hex", "")) != 64
            or identity.get("npub", "").startswith("npub")
            and len(_convertbits(
                [CHARSET.find(c) for c in identity["npub"].split("1", 1)[1][:-6]],
                5, 8, False,
            )) != 32
        )
        if needs_migration and "private_key_hex" in identity:
            sk = SigningKey.from_string(
                bytes.fromhex(identity["private_key_hex"]), curve=SECP256k1
            )
            keypair = _keypair_from_privkey_hex(sk.to_string().hex())
            identity.update(keypair)
            identity["created_at"] = identity.get("created_at", int(time.time()))
            write_json(identity_file, identity)
        return identity

    signing_key = SigningKey.generate(curve=SECP256k1)
    keypair = _keypair_from_privkey_hex(signing_key.to_string().hex())
    identity = {
        "agent_id": agent_id,
        "created_at": int(time.time()),
        **keypair,
    }
    write_json(identity_file, identity)
    return identity


# did-nostr Multikey: f(base16-lower) ‖ e701(varint secp256k1-pub) ‖ 02(SEC1
# compressed even-y prefix) ‖ x-only hex. The `02` is load-bearing multicodec
# payload, not a separator — BIP-340 lift_x always yields even-y so it is
# invariantly `02`. publicKeyMultibase is a fixed 71 chars and round-trips to
# the identical key (ADR-033 I2). No key bytes change.
MULTIKEY_PREFIX = "fe70102"


def build_did_document(identity, also_known_as=None):
    """Build the canonical did-nostr CG single Multikey DID document.

    Ground truth: melvincarvalho/create-agent index.js,
    nostrcg.github.io/did-nostr. Supersedes the ADR-074 D2 2019 suite shape
    (ADR-033); ADR-074 D1 (x-only hex = canonical identity) stays.
    """
    x_only = identity["x_only_pubkey_hex"].lower()
    did = f"did:nostr:{x_only}"
    doc = {
        "@context": ["https://w3id.org/did", "https://w3id.org/nostr/context"],
        "id": did,
        "type": "DIDNostr",
        "verificationMethod": [
            {
                "id": f"{did}#key1",
                "type": "Multikey",
                "controller": did,
                "publicKeyMultibase": f"{MULTIKEY_PREFIX}{x_only}",
            }
        ],
        "authentication": ["#key1"],
        "assertionMethod": ["#key1"],
        # Canonical create-agent / did-nostr CG reference form is service: [].
        # alsoKnownAs (pod profile cross-reference) is an agentbox extension.
        "service": [],
    }
    if also_known_as:
        doc["alsoKnownAs"] = also_known_as
    return doc


def _git(repo_root, *args, check=True, capture=False):
    """Thin git wrapper scoped to a repo. Returns stdout (stripped) when
    capture=True, else None. Raises on non-zero only when check=True."""
    cmd = ["git", "-C", str(repo_root), *args]
    if capture:
        out = subprocess.run(
            cmd, check=check, stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL, text=True,
        )
        return (out.stdout or "").strip()
    subprocess.run(
        cmd, check=check, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    return None


def _ensure_pod_git(repo_root, identity):
    """Initialise the per-user pod as a full git repo if it is not one already
    (Melvin's create-agent layout: the pod IS a git repo). Idempotent. Sets a
    deterministic committer identity so commit SHAs are reproducible enough for
    the gitmark/blocktrails trail. Returns True if the repo is usable.
    """
    repo_root = pathlib.Path(repo_root)
    repo_root.mkdir(parents=True, exist_ok=True)
    try:
        if not (repo_root / ".git").exists():
            _git(repo_root, "init", "-q")
        # Repo-scoped committer identity (does not touch global config). The
        # agent commits as its own did:nostr — no human identity leaks in.
        did = f"did:nostr:{identity['x_only_pubkey_hex']}"
        _git(repo_root, "config", "user.name", identity["agent_id"], check=False)
        _git(repo_root, "config", "user.email", f"{did}@agentbox.local", check=False)
        return True
    except (OSError, subprocess.CalledProcessError):
        return False


def build_gitmark(identity, repo_root, genesis_sha, package="agentbox-pod"):
    """Canonical gitmark envelope — the 5-key create-agent ground-truth form
    (ADR-033 build-out note / ADR-124 §5). The verbatim ground-truth gitmark is
    exactly {@id, genesis, nick, package, repository}; @context/@type/commit/
    parent are NOT in the file — parent-linkage lives in blocktrails.json
    states[]/txo[]. @id is gitmark:<genesis-sha>:<vout=0>.
    """
    return {
        "@id": f"gitmark:{genesis_sha}:0",
        "genesis": genesis_sha,
        "nick": identity["agent_id"],
        "package": package,
        "repository": f"did:nostr:{identity['x_only_pubkey_hex']}",
    }


def build_blocktrail(genesis_sha, states, txo=None):
    """Reconstructed Blocktrail (webcontracts.org reference shape; NOT lifted
    from a fetchable create-agent artefact). profile=gitmark, BIP-341 single-
    use-seal chain. states[] = REAL pod commit SHAs; txo[] = the UTXO/seal
    chain (empty until an L1 single-use-seal is opened — honest-or-caught L0
    until then, per ADR-124 trust model)."""
    return {
        "@type": "Blocktrail",
        "profile": "gitmark",
        "genesis": genesis_sha,
        "states": list(states),
        "txo": list(txo or []),
    }


def wire_pod_contract_substrate(identity, repo_root):
    """ADR-124 build-out: anchor the 4-layer web-contract (reducer/state/ledger/
    trail) onto the REAL per-user pod git. Deploy ritual on the live surface:
    write agent.did.json + gitmark.json + blocktrails.json -> commit -> record
    the real commit SHA in blocktrails states[]. No stub: states[] holds actual
    pod commit SHAs.

    Honest-or-caught (L0): the trail tip is a real git commit, not yet a
    confirmed tx. The single-use-seal txo[] upgrade seam to trustless (RGB/DLC)
    is reserved but empty here (ADR-124 trust model). Changes no key bytes
    (ADR-033 I1); the did:nostr identity string is untouched.
    """
    repo_root = pathlib.Path(repo_root)
    # 1. edit: place the canonical Multikey DID doc + key at the pod-git root.
    write_json(repo_root / "agent.did.json", build_did_document(identity))
    try:
        _git(repo_root, "config", "nostr.privkey", identity["private_key_hex"])
    except (OSError, subprocess.CalledProcessError):
        pass  # non-fatal; identity.env remains the canonical key source.

    # 2. genesis commit: stage agent.did.json so the trail has a real anchor.
    try:
        _git(repo_root, "add", "agent.did.json")
        # Only commit if there is something staged (idempotent re-runs).
        staged = _git(repo_root, "diff", "--cached", "--name-only",
                      capture=True, check=False)
        if staged:
            _git(repo_root, "commit", "-q", "-m",
                 "chore(identity): publish did:nostr Multikey doc (ADR-033)")
        genesis_sha = _git(repo_root, "rev-parse", "HEAD", capture=True)
    except (OSError, subprocess.CalledProcessError):
        return  # no usable HEAD — leave identity.env as the source of truth.
    if not genesis_sha:
        return

    # 3. git-mark: write gitmark.json (5-key) + blocktrails.json (states[] = the
    #    genesis commit SHA, a REAL pod commit), then commit them. The follow-up
    #    commit SHA is appended to states[] so the trail tip is the live HEAD.
    write_json(repo_root / "gitmark.json", build_gitmark(identity, repo_root, genesis_sha))
    write_json(repo_root / "blocktrails.json",
               build_blocktrail(genesis_sha, states=[genesis_sha]))
    try:
        _git(repo_root, "add", "gitmark.json", "blocktrails.json")
        staged = _git(repo_root, "diff", "--cached", "--name-only",
                      capture=True, check=False)
        if staged:
            _git(repo_root, "commit", "-q", "-m",
                 "chore(contract): anchor gitmark + blocktrails (ADR-124)")
        tip_sha = _git(repo_root, "rev-parse", "HEAD", capture=True)
        if tip_sha and tip_sha != genesis_sha:
            # Advance the trail tip to the real contract-anchor commit SHA.
            write_json(repo_root / "blocktrails.json",
                       build_blocktrail(genesis_sha, states=[genesis_sha, tip_sha]))
            _git(repo_root, "add", "blocktrails.json")
            _git(repo_root, "commit", "-q", "-m",
                 "chore(contract): advance blocktrails tip to anchor SHA (ADR-124)")
    except (OSError, subprocess.CalledProcessError):
        pass  # contract anchoring is best-effort; identity write already landed.


def write_agent_repo_identity(identity, repo_root):
    """DreamLab convention (inspired by create-agent's key/document separation,
    NOT create-agent's layout — create-agent takes --privkey on the CLI and
    writes the DID doc to stdout; it neither sets git config nor writes a
    repo-root DID file). Greenfield/additive to identity.env; changes no key
    bytes (ADR-033 I1).

    The pod IS a full git repo (Melvin's create-agent layout). This initialises
    it if needed, writes agent.did.json (the Multikey DID document) into the
    repo root, sets `git config nostr.privkey <hex>`, and wires the ADR-124
    gitmark/blocktrails contract substrate onto the live pod git with REAL
    commit SHAs in blocktrails states[].
    """
    if not _ensure_pod_git(repo_root, identity):
        return  # git unavailable — identity.env remains the source of truth.
    wire_pod_contract_substrate(identity, repo_root)


def ensure_acl(pod_root, identity):
    pod_dir = pod_root / identity["npub"]
    for relative in [
        "memory/episodic",
        "memory/semantic",
        "system/adrs",
        "system/prds",
        "events/inbox",
        "events/outbox",
    ]:
        (pod_dir / relative).mkdir(parents=True, exist_ok=True)

    # ADR-010 Sprint 6 absorption: WAC subject is the did:nostr DID, not the
    # raw npub. ADR-013 mandates did:nostr:<hex-pubkey> (BIP-340 x-only,
    # 64 lowercase hex chars) rather than bech32 npub so that non-Nostr
    # DID resolvers and W3C VC verifiers don't need a bech32 decoder.
    did = f"did:nostr:{identity['x_only_pubkey_hex']}"
    acl = {
        "@context": "http://www.w3.org/ns/auth/acl#",
        "owner": did,
        "rules": [
            {
                "@type": "Authorization",
                "agent": did,
                "mode": ["Read", "Write", "Append", "Control"],
                "accessTo": "./",
                "default": "./",
            }
        ],
    }
    write_json(pod_dir / ".acl.json", acl)
    write_json(
        pod_dir / "profile.json",
        {
            "@context": "https://www.w3.org/ns/solid/terms#",
            "id": did,
            "webId": f"http://localhost:{os.getenv('SOLID_POD_PORT', '8484')}/pods/{identity['npub']}/profile.json",
            "alsoKnownAs": [did],
        },
    )
    # DID document — consumed by solid-pod-rs's did-nostr resolver at
    # GET /did:nostr:<hex-pubkey>. alsoKnownAs cross-references the pod profile
    # URI so downstream clients can traverse in either direction.
    did_doc = build_did_document(
        identity,
        also_known_as=[
            f"http://localhost:{os.getenv('SOLID_POD_PORT', '8484')}/pods/{identity['npub']}/profile.json"
        ],
    )
    write_json(pod_dir / "did-nostr.json", did_doc)


def write_runtime_env(identity, run_root):
    run_root.mkdir(parents=True, exist_ok=True)
    env_file = run_root / "identity.env"
    env_file.write_text(
        "\n".join(
            [
                f"export AGENTBOX_AGENT_ID={identity['agent_id']}",
                f"export AGENTBOX_NPUB={identity['npub']}",
                f"export AGENTBOX_NSEC={identity['nsec']}",
                f"export AGENTBOX_PUBKEY_HEX={identity['public_key_hex']}",
                f"export AGENTBOX_X_ONLY_PUBKEY_HEX={identity['x_only_pubkey_hex']}",
                f"export AGENTBOX_DID=did:nostr:{identity['x_only_pubkey_hex']}",
                f"export AGENTBOX_URN=urn:agentbox:agent:{identity['agent_id']}",
                # nostr-pod-bridge ingress reads the agent identity from these two
                # vars (see services/nostr-pod-bridge/src/main.rs). The recipient
                # is the agent's own BIP-340 x-only key; the SK is its 64-char hex
                # secret. The entrypoint sources this file before exec'ing
                # supervisord so PID 1 — and thus the bridge child — inherit them,
                # keeping the secret out of the generated supervisor text.
                f"export AGENTBOX_BRIDGE_RECIPIENT_PUBKEY={identity['x_only_pubkey_hex']}",
                f"export AGENTBOX_BRIDGE_SK={identity['private_key_hex']}",
                "",
            ]
        ),
        encoding="utf-8",
    )
    # Carries the agent secret (nsec + SK hex); root sources it pre-supervisord,
    # devuser never reads it directly. Keep it off any other reader.
    os.chmod(env_file, 0o600)


def main():
    config_path = os.getenv("AGENTBOX_CONFIG", "/etc/agentbox.toml")
    config = load_config(config_path)
    sovereign_cfg = config.get("sovereign_mesh", {})
    if not sovereign_cfg.get("enabled", False):
        return

    agent_id = os.getenv("AGENTBOX_AGENT_ID", "agentbox-core")
    identity_root = pathlib.Path("/var/lib/agentbox/identities")
    pod_root = pathlib.Path(os.getenv("SOLID_POD_ROOT", "/var/lib/solid")) / "pods"
    run_root = pathlib.Path("/run/agentbox")

    identity = ensure_identity(agent_id, identity_root)
    ensure_acl(pod_root, identity)
    write_runtime_env(identity, run_root)

    # DreamLab convention (Melvin's create-agent layout): the PER-USER POD is a
    # full git repo, and the Multikey DID document (agent.did.json) + the signing
    # key (`git config nostr.privkey`) live at the POD-GIT ROOT. The pod dir is
    # pod_root/<npub> (the same dir ensure_acl scaffolds). It is git-init'd if
    # needed and the ADR-124 gitmark/blocktrails contract substrate is anchored
    # onto it with real commit SHAs. An explicit AGENTBOX_AGENT_REPO_ROOT
    # override is honoured for non-pod deployments. Additive to identity.env;
    # no key bytes change (ADR-033 I1).
    repo_root = os.getenv("AGENTBOX_AGENT_REPO_ROOT") or str(pod_root / identity["npub"])
    write_agent_repo_identity(identity, repo_root)


if __name__ == "__main__":
    main()
