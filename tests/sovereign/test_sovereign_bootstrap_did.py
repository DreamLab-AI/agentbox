"""
tests/sovereign/test_sovereign_bootstrap_did.py

pytest coverage for scripts/sovereign-bootstrap.py — the DID-document /
pod-git-contract half of the sovereign identity bootstrap.

This guards the ADR-033 convergence (did:nostr single Multikey form) and the
ADR-124 build-out (gitmark/blocktrails contract substrate wired onto the REAL
per-user pod git), against the hard invariants:

  I1. did:nostr:<hex> identity string unchanged (BIP-340 x-only even-y hex).
  I2. publicKeyMultibase == "fe70102" + same x-only hex; round-trips; 71 chars;
      no key bytes change.
  I4. Only the 2019 doc shape is superseded — the id string still governs.

The auth path (NIP-98, I3) is deliberately NOT exercised here: it verifies the
raw event pubkey and never reads the DID-doc verificationMethod, so re-encoding
the VM cannot touch it. That property is covered by the NIP-98 verifier tests.

Groups:
  A. build_did_document   — canonical Multikey shape; 2019 suite dropped (I1/I2/I4)
  B. gitmark / blocktrails — 5-key gitmark; Blocktrail states[] = REAL pod SHAs
  C. write_agent_repo_identity — pod-git init + agent.did.json/key at repo ROOT

The crypto (BIP-340 even-y derivation) lives in the `ecdsa` dependency that the
bootstrap imports at module load. When `ecdsa` is absent (minimal CI image) the
whole module is skipped — the script is only ever run inside the container where
`ecdsa` is present.
"""

import importlib.util
import json
import pathlib
import subprocess

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[2]
SCRIPT_PATH = ROOT / "scripts" / "sovereign-bootstrap.py"

# BIP-340 test vector: privkey 3 → known even-y x-only pubkey F9308A01...
PRIV_HEX = "0000000000000000000000000000000000000000000000000000000000000003"
EXPECTED_XONLY = "f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9"


@pytest.fixture(scope="module")
def sb():
    """Load the hyphenated bootstrap script as a module. Skip if its `ecdsa`
    import dependency is unavailable in this environment."""
    pytest.importorskip("ecdsa", reason="sovereign-bootstrap.py requires ecdsa")
    spec = importlib.util.spec_from_file_location("sovereign_bootstrap", SCRIPT_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def identity(sb):
    ident = sb._keypair_from_privkey_hex(PRIV_HEX)
    ident["agent_id"] = "test-agent"
    return ident


@pytest.fixture
def pod_repo(sb, identity, tmp_path):
    """A real, git-init'd per-user pod with the contract substrate wired on."""
    pod = tmp_path / "npub1testpod"
    assert sb._ensure_pod_git(pod, identity) is True
    sb.wire_pod_contract_substrate(identity, pod)
    return pod


# ─── A. build_did_document — canonical Multikey shape ───────────────────────────


def test_did_document_is_canonical_multikey_form(sb, identity):
    doc = sb.build_did_document(identity)
    assert doc["@context"] == [
        "https://w3id.org/did",
        "https://w3id.org/nostr/context",
    ]
    assert doc["id"] == f"did:nostr:{EXPECTED_XONLY}"
    assert doc["type"] == "DIDNostr"
    assert len(doc["verificationMethod"]) == 1
    vm = doc["verificationMethod"][0]
    assert vm["id"] == f"did:nostr:{EXPECTED_XONLY}#key1"
    assert vm["type"] == "Multikey"
    assert vm["controller"] == f"did:nostr:{EXPECTED_XONLY}"
    assert doc["authentication"] == ["#key1"]
    assert doc["assertionMethod"] == ["#key1"]
    assert doc["service"] == []


def test_i2_public_key_multibase_round_trips(sb, identity):
    """I2: publicKeyMultibase == fe70102 + same x-only hex; round-trips; 71 chars."""
    doc = sb.build_did_document(identity)
    vm = doc["verificationMethod"][0]
    assert vm["publicKeyMultibase"] == f"fe70102{EXPECTED_XONLY}"
    # round-trip: the multibase body (after the 7-char fe70102 prefix) IS the
    # did:nostr body — no key bytes change.
    assert vm["publicKeyMultibase"][7:] == doc["id"][len("did:nostr:"):]
    assert len(vm["publicKeyMultibase"]) == 71


def test_i1_i4_drops_2019_suite_keeps_id(sb, identity):
    """I1/I4: the 2019 SchnorrSecp256k1VerificationKey2019 / publicKeyHex shape
    is gone; the did:nostr:<hex> id string is unchanged and lowercase."""
    doc = sb.build_did_document(identity)
    blob = json.dumps(doc)
    assert "SchnorrSecp256k1VerificationKey2019" not in blob
    assert "publicKeyHex" not in blob
    assert "secp256k1-2019" not in blob
    xonly = doc["id"][len("did:nostr:"):]
    assert len(xonly) == 64 and xonly == xonly.lower() and xonly == EXPECTED_XONLY


# ─── B. gitmark / blocktrails — 5-key gitmark; states[] = REAL pod SHAs ──────────


def test_gitmark_is_exactly_five_key_ground_truth(sb, identity):
    gm = sb.build_gitmark(identity, "/unused", "deadbeef")
    assert set(gm.keys()) == {"@id", "genesis", "nick", "package", "repository"}
    assert gm["@id"] == "gitmark:deadbeef:0"
    assert gm["genesis"] == "deadbeef"
    assert gm["nick"] == "test-agent"
    assert gm["repository"] == f"did:nostr:{EXPECTED_XONLY}"


def test_blocktrail_shape(sb):
    bt = sb.build_blocktrail("g0", ["g0", "s1"])
    assert bt["@type"] == "Blocktrail"
    assert bt["profile"] == "gitmark"
    assert bt["genesis"] == "g0"
    assert bt["states"] == ["g0", "s1"]
    assert bt["txo"] == []  # L0 honest-or-caught; single-use-seal seam empty


def test_blocktrail_states_are_real_pod_commit_shas(pod_repo):
    """The contract substrate must anchor on the LIVE git surface — every SHA in
    blocktrails states[] is a real commit reachable from the pod's git log."""
    bt = json.loads((pod_repo / "blocktrails.json").read_text())
    real_log = subprocess.run(
        ["git", "-C", str(pod_repo), "log", "--format=%H"],
        capture_output=True, text=True, check=True,
    ).stdout.split()
    assert bt["states"], "blocktrails states[] must not be empty"
    for sha in bt["states"]:
        assert sha in real_log, f"state {sha} is not a real pod commit SHA"
    assert bt["genesis"] == bt["states"][0]


# ─── C. write_agent_repo_identity — pod-git root layout ─────────────────────────


def test_agent_did_json_and_key_at_pod_git_root(pod_repo, identity):
    """Melvin's create-agent layout: agent.did.json + git config nostr.privkey
    live at the pod-git ROOT."""
    doc = json.loads((pod_repo / "agent.did.json").read_text())
    assert doc["type"] == "DIDNostr"
    assert doc["verificationMethod"][0]["publicKeyMultibase"] == f"fe70102{EXPECTED_XONLY}"
    privkey = subprocess.run(
        ["git", "-C", str(pod_repo), "config", "nostr.privkey"],
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    assert privkey == identity["private_key_hex"]
    assert (pod_repo / "gitmark.json").exists()
    assert (pod_repo / "blocktrails.json").exists()


def test_write_agent_repo_identity_inits_pod_git_when_missing(sb, identity, tmp_path):
    """The pod is a full git repo: write_agent_repo_identity must init it if the
    .git dir is absent, then land the identity + contract files."""
    pod = tmp_path / "fresh-pod"
    pod.mkdir()
    assert not (pod / ".git").exists()
    sb.write_agent_repo_identity(identity, str(pod))
    assert (pod / ".git").exists()
    assert (pod / "agent.did.json").exists()


def test_idempotent_on_rerun(sb, identity, pod_repo):
    """A second bootstrap pass must not crash and must keep a valid trail."""
    sb.wire_pod_contract_substrate(identity, pod_repo)
    bt = json.loads((pod_repo / "blocktrails.json").read_text())
    real_log = subprocess.run(
        ["git", "-C", str(pod_repo), "log", "--format=%H"],
        capture_output=True, text=True, check=True,
    ).stdout.split()
    for sha in bt["states"]:
        assert sha in real_log
