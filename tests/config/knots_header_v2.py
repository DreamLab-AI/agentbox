"""Knots' BLAKE2b proof-of-work hash of the 164-byte v2 block header, engine-free.

The block hash of a chain beside a BLAKE2b parent (`xbt`, `txbt4`; sidestr SPEC 3.2): Knots
29.4.x `src/primitives/block.cpp` CBlockHeader::GetHash, as bitcoin-desktop/schema transcribes
it in `codec/pow/knots-header-v2.js` (the pinned schema commit in
config/sidechain/upstream-pins). Wire layout from `schema/overlays/knots-blake2b.jsonld`
knots:BlockHeaderV2. Only the standard library's SHA-256 and BLAKE2b are used; nothing here
is a primitive of its own.

    h1   = tagged("Bitcoin block header 1", version‖prev‖height‖merkle‖time‖0‖bits‖txCount‖flags‖clearBits‖tagged(xorKey))
    h2   = tagged("Merge-mining hook", h1‖0³²‖mmRhs)
    b1   = blake2b-256(0⁴‖h2‖extranonce)
    b2   = blake2b-256(ASIC-profile layout of h2, nonces, b1)
    hash = b2 XOR mask(xorKey, clearBits), display order

tests/config/sidechain-genesis.test.sh checks this against two live txbt4 headers before
using it on a sealed genesis.
"""
import hashlib
import struct


def tagged(tag: str, msg: bytes) -> bytes:
    """BIP-340 tagged hash: SHA-256(SHA-256(tag) ‖ SHA-256(tag) ‖ msg)."""
    t = hashlib.sha256(tag.encode()).digest()
    return hashlib.sha256(t + t + msg).digest()


def _blake2b256(msg: bytes) -> bytes:
    return hashlib.blake2b(msg, digest_size=32).digest()


def fields(hdr: bytes) -> dict:
    """The v2 header's fields, hashes in wire order."""
    if len(hdr) != 164:
        raise ValueError(f"a v2 header is 164 bytes, not {len(hdr)}")
    version, = struct.unpack_from("<I", hdr, 0)
    time_wire, bits, nonce, nonce2, nonce3 = struct.unpack_from("<5I", hdr, 68)
    time_offset, = struct.unpack_from("<I", hdr, 104)
    tx_count, = struct.unpack_from("<H", hdr, 108)
    height, = struct.unpack_from("<i", hdr, 128)
    return dict(version=version, prev=hdr[4:36], merkle=hdr[36:68], time_wire=time_wire,
                bits=bits, nonce=nonce, nonce2=nonce2, nonce3=nonce3, extranonce=hdr[88:104],
                time_offset=time_offset, tx_count=tx_count, flags=hdr[110],
                clear_bits=hdr[111], xor_key=hdr[112:128], height=height, mm_rhs=hdr[132:164])


def header_time(f: dict) -> int:
    """Consensus time: the wire time plus the offset when flags bit 2 is set."""
    return (f["time_wire"] + f["time_offset"]) & 0xFFFFFFFF if f["flags"] & 4 else f["time_wire"]


def v2_hash(hdr: bytes) -> str:
    """The block hash of a 164-byte v2 header, as hex in display order."""
    f = fields(hdr)
    u32 = lambda n: struct.pack("<I", n & 0xFFFFFFFF)  # noqa: E731
    prev_display = f["prev"][::-1]
    mask = bytearray(32)
    if any(f["xor_key"]):
        mask[:] = tagged("Bitcoin block hash PoW XOR mask", f["xor_key"])
        clear = f["clear_bits"] >> 3
        for i in range(min(clear, 32)):
            mask[i] = 0
        if clear < 32:
            mask[clear] &= 0xFF >> (f["clear_bits"] & 7)
    h1 = tagged("Bitcoin block header 1",
                u32(f["version"]) + prev_display + u32(f["height"]) + f["merkle"]
                + u32(f["time_wire"]) + b"\0" + u32(f["bits"]) + u32(f["tx_count"])
                + bytes([f["flags"], f["clear_bits"]])
                + tagged("Bitcoin block hash PoW XOR key", f["xor_key"]))
    h2 = tagged("Merge-mining hook", h1 + bytes(32) + f["mm_rhs"])
    b1 = _blake2b256(u32(0) + h2 + f["extranonce"])
    nonces = u32(f["nonce"]) + u32(f["nonce2"]) + u32(f["time_offset"]) + u32(f["nonce3"])
    profile = f["flags"] & 3
    if profile == 0:
        prev_hidden = tagged("Bitcoin prevblock header, hashed", prev_display)
        asic = bytes(6) + prev_hidden[6:] + nonces + b1
    elif profile == 1:
        asic = (u32(f["nonce"]) + u32(f["nonce2"]) + u32(f["nonce3"]) + u32(f["time_offset"])
                + b1 + h2)
    elif profile == 2:
        asic = bytes(48) + h2 + nonces + b1
    else:
        asic = bytes(80) + h2 + nonces + b1
    return bytes(x ^ y for x, y in zip(_blake2b256(asic), mask)).hex()
