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


def load_config(path):
    with open(path, "rb") as fh:
        return tomllib.load(fh)


def write_json(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def ensure_identity(agent_id, identity_root):
    identity_file = identity_root / f"{agent_id}.json"
    if identity_file.exists():
      return json.loads(identity_file.read_text(encoding="utf-8"))

    signing_key = SigningKey.generate(curve=SECP256k1)
    verifying_key = signing_key.get_verifying_key()
    private_bytes = signing_key.to_string()
    public_bytes = verifying_key.to_string()

    identity = {
        "agent_id": agent_id,
        "created_at": int(time.time()),
        "private_key_hex": private_bytes.hex(),
        "public_key_hex": public_bytes.hex(),
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

    acl = {
        "owner": identity["npub"],
        "rules": [
            {
                "subject": identity["npub"],
                "read": True,
                "write": True,
                "append": True,
                "control": True,
            }
        ],
    }
    write_json(pod_dir / ".acl.json", acl)
    write_json(
        pod_dir / "profile.json",
        {
            "id": identity["npub"],
            "webId": f"http://localhost:{os.getenv('SOLID_POD_PORT', '8484')}/pods/{identity['npub']}/profile.json",
        },
    )


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
