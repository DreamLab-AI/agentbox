#!/usr/bin/env python3
import json
import os
import pathlib
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


def _keypair_from_privkey_hex(privkey_hex):
    signing_key = SigningKey.from_string(bytes.fromhex(privkey_hex), curve=SECP256k1)
    verifying_key = signing_key.get_verifying_key()
    private_bytes = signing_key.to_string()
    public_bytes = verifying_key.to_string()
    return {
        "private_key_hex": private_bytes.hex(),
        "public_key_hex": public_bytes.hex(),
        "x_only_pubkey_hex": public_bytes[:32].hex(),
        "nsec": bech32_encode("nsec", private_bytes),
        "npub": bech32_encode("npub", public_bytes),
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
        if "x_only_pubkey_hex" not in identity:
            identity["x_only_pubkey_hex"] = identity["public_key_hex"][:64]
            write_json(identity_file, identity)
        return identity

    signing_key = SigningKey.generate(curve=SECP256k1)
    verifying_key = signing_key.get_verifying_key()
    private_bytes = signing_key.to_string()
    public_bytes = verifying_key.to_string()
    identity = {
        "agent_id": agent_id,
        "created_at": int(time.time()),
        "private_key_hex": private_bytes.hex(),
        "public_key_hex": public_bytes.hex(),
        "x_only_pubkey_hex": public_bytes[:32].hex(),
        "nsec": bech32_encode("nsec", private_bytes),
        "npub": bech32_encode("npub", public_bytes),
    }
    write_json(identity_file, identity)
    return identity


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
    # Tier 1 + Tier 3 DID document — consumed by solid-pod-rs's did-nostr
    # resolver at GET /did:nostr:<hex-pubkey>. alsoKnownAs cross-references
    # the pod profile URI so downstream clients can traverse in either direction.
    did_doc = {
        "@context": [
            "https://www.w3.org/ns/did/v1",
            "https://w3id.org/security/suites/secp256k1-2019/v1",
        ],
        "id": did,
        "verificationMethod": [
            {
                "id": f"{did}#key-0",
                "type": "SchnorrSecp256k1VerificationKey2022",
                "controller": did,
                "publicKeyHex": identity["public_key_hex"],
            }
        ],
        "authentication": [f"{did}#key-0"],
        "assertionMethod":  [f"{did}#key-0"],
        "alsoKnownAs": [
            f"http://localhost:{os.getenv('SOLID_POD_PORT', '8484')}/pods/{identity['npub']}/profile.json"
        ],
    }
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
                "",
            ]
        ),
        encoding="utf-8",
    )


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


if __name__ == "__main__":
    main()
