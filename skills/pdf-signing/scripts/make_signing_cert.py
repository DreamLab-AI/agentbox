#!/usr/bin/env python3
"""Generate a self-signed document-signing identity for DreamLab AI Consulting Ltd.

Produces (under keys/, git-ignored — the .p12 holds the PRIVATE key):
  keys/dreamlab-signing.p12       PKCS#12 bundle (key + cert) used by sign_pdf.py
  keys/dreamlab-signing-cert.pem  public certificate only — safe to share so a
                                  recipient can add it to their trusted identities
  keys/.p12-pass                  the PKCS#12 passphrase (mode 600, git-ignored)

Self-signed means readers (Adobe/Acrobat) will show "signature valid, signer
identity unknown" until the recipient imports dreamlab-signing-cert.pem as a
trusted identity. The signature is still cryptographically sound: it proves the
document has not changed since signing and binds it to this key. Upgrade path to
a fully-trusted (green-tick / eIDAS QES) identity is in README.md.

Uses the `cryptography` library only — no openssl binary required. Idempotent-ish:
refuses to overwrite an existing .p12 unless --force is passed.
"""
import argparse
import datetime as dt
import os
import secrets
import stat
import sys
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.serialization import pkcs12
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID

KEYS = Path(os.environ.get("PDF_SIGNING_KEYS_DIR", Path(__file__).resolve().parent / "keys"))


def _write_600(path: Path, data: bytes) -> None:
    path.write_bytes(data)
    path.chmod(stat.S_IRUSR | stat.S_IWUSR)  # 600


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--force", action="store_true", help="overwrite an existing identity")
    ap.add_argument("--years", type=int, default=5, help="validity in years (default 5)")
    ap.add_argument("--cn", default="DreamLab AI Consulting Ltd")
    ap.add_argument("--org", default="DreamLab AI Consulting Ltd")
    ap.add_argument("--email", default="john@thedreamlab.uk")
    ap.add_argument("--country", default="GB")
    ap.add_argument("--locality", default="Eskdale")
    args = ap.parse_args()

    KEYS.mkdir(mode=0o700, exist_ok=True)
    p12_path = KEYS / "dreamlab-signing.p12"
    if p12_path.exists() and not args.force:
        print(f"refusing to overwrite {p12_path} (pass --force to regenerate)", file=sys.stderr)
        return 1

    # 3072-bit RSA: broad reader compatibility, strong enough for long-lived docs.
    key = rsa.generate_private_key(public_exponent=65537, key_size=3072)

    subject = issuer = x509.Name([
        x509.NameAttribute(NameOID.COUNTRY_NAME, args.country),
        x509.NameAttribute(NameOID.LOCALITY_NAME, args.locality),
        x509.NameAttribute(NameOID.ORGANIZATION_NAME, args.org),
        x509.NameAttribute(NameOID.ORGANIZATIONAL_UNIT_NAME, "Invoicing"),
        x509.NameAttribute(NameOID.COMMON_NAME, args.cn),
        x509.NameAttribute(NameOID.EMAIL_ADDRESS, args.email),
    ])

    now = dt.datetime.now(dt.timezone.utc)
    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(issuer)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - dt.timedelta(minutes=5))
        .not_valid_after(now + dt.timedelta(days=365 * args.years))
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .add_extension(
            x509.KeyUsage(
                digital_signature=True,
                content_commitment=True,  # a.k.a. non-repudiation — the bit that matters for signing
                key_encipherment=False,
                data_encipherment=False,
                key_agreement=False,
                key_cert_sign=False,
                crl_sign=False,
                encipher_only=False,
                decipher_only=False,
            ),
            critical=True,
        )
        .add_extension(
            x509.ExtendedKeyUsage([ExtendedKeyUsageOID.EMAIL_PROTECTION]),
            critical=False,
        )
        .add_extension(
            x509.SubjectAlternativeName([
                x509.RFC822Name(args.email),
                x509.UniformResourceIdentifier("https://www.dreamlab-ai.com"),
            ]),
            critical=False,
        )
        .add_extension(x509.SubjectKeyIdentifier.from_public_key(key.public_key()), critical=False)
        .sign(private_key=key, algorithm=hashes.SHA256())
    )

    passphrase = secrets.token_urlsafe(24)
    p12 = pkcs12.serialize_key_and_certificates(
        name=b"DreamLab AI Consulting Ltd signing key",
        key=key,
        cert=cert,
        cas=None,
        encryption_algorithm=serialization.BestAvailableEncryption(passphrase.encode()),
    )

    _write_600(p12_path, p12)
    _write_600(KEYS / ".p12-pass", (passphrase + "\n").encode())
    # public cert is shareable — normal perms
    (KEYS / "dreamlab-signing-cert.pem").write_bytes(
        cert.public_bytes(serialization.Encoding.PEM)
    )

    print(f"wrote {p12_path}")
    print(f"wrote {KEYS / 'dreamlab-signing-cert.pem'}  (public — share this for trust import)")
    print(f"wrote {KEYS / '.p12-pass'}  (mode 600 — passphrase; keep private)")
    print(f"subject : {args.cn}")
    print(f"valid   : {now:%Y-%m-%d} → {now + dt.timedelta(days=365*args.years):%Y-%m-%d}")
    print(f"fingerprint(SHA-256): {cert.fingerprint(hashes.SHA256()).hex(':')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
