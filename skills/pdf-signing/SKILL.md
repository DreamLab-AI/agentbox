---
name: pdf-signing
description: >-
  Cryptographically sign PDFs (invoices, contracts, letters, forms) with open-source
  tooling — pyHanko applying a PAdES/eIDAS-aligned digital signature plus an optional
  visible signature panel. TRIGGER when the user asks to "digitally sign", "e-sign",
  "add a digital signature to", "sign this invoice/contract/PDF", "make a signed PDF",
  "certify a PDF", or needs a signed document because a counterparty requires signed
  invoices/paperwork. Also covers generating a self-signed signing identity (X.509 key
  + cert), embedding an RFC-3161 trusted timestamp, verifying a signature (pdfsig), and
  the trust/upgrade path from self-signed to a fully-trusted (green-tick / eIDAS QES)
  certificate. SKIP for merely stamping an image of a handwritten signature with no
  cryptography (use imagemagick/pdftk), for filling form fields (pdftk), or for editing
  PDF content (pikepdf/pymupdf).
---

# PDF Signing (pyHanko, open-source)

## What this does
Applies a real **cryptographic digital signature** to a PDF: it hashes the whole
document, signs the hash with a private key, and embeds the signature + certificate.
Any later edit breaks the signature — that is what makes it tamper-evident and
non-repudiable. Uses **pyHanko** (the strongest open-source PDF signer: PAdES B-B/B-T/
B-LT/B-LTA, CAdES, document timestamps, LTV) with the `cryptography` library. No
proprietary tools, no cloud service, no Adobe.

It is **not** the same as pasting a picture of a signature — that is decorative and
proves nothing. This produces a signature a verifier (Adobe Acrobat, `pdfsig`, DSS)
can check.

## Quick start
```bash
cd "$(dirname skills/pdf-signing/SKILL.md)/scripts" 2>/dev/null || cd skills/pdf-signing/scripts
./sign.sh /path/to/invoice.pdf                 # → invoice-signed.pdf beside it
./sign.sh invoice.pdf out.pdf --tsa http://timestamp.digicert.com   # + trusted timestamp
./sign.sh doc.pdf --invisible                  # crypto only, no visible panel
```
`sign.sh` will, on first use: resolve/provision the interpreter (`setup.sh`), then
generate a self-signed identity if none exists, then sign. Verify with:
```bash
pdfsig invoice-signed.pdf     # expect "Signature is Valid" + "Total document signed"
```

## Where the keys live (important)
The signing **private key never goes in the container image or a git repo.** It lives
in `$PDF_SIGNING_KEYS_DIR` (default `~/.local/share/pdf-signing/`):

| File | Secret? | Purpose |
|------|---------|---------|
| `dreamlab-signing.p12` | **YES** — mode 600 | key + cert bundle used to sign |
| `.p12-pass` | **YES** — mode 600 | passphrase protecting the .p12 |
| `dreamlab-signing-cert.pem` | no — shareable | public cert; send to a recipient so they can trust your signature |

Regenerate/rotate the identity (5-year validity, RSA-3072) with:
```bash
./scripts/make_signing_cert.py --force            # defaults: DreamLab AI Consulting Ltd
./scripts/make_signing_cert.py --cn "Acme Ltd" --org "Acme Ltd" --email billing@acme.com
```

## Self-signed vs trusted — what a recipient sees
Out of the box the cert is **self-signed**, so `pdfsig` / Acrobat report
*"signature is valid, but the signer's identity is unknown"* (issuer unknown). The
maths is sound — integrity and non-repudiation hold — it just isn't chained to a CA the
reader already trusts. Two ways to get a clean "identity verified":

1. **One-off trust** — send the recipient `dreamlab-signing-cert.pem`; they add it as a
   trusted identity once. Fine for a known counterparty who has asked for signed docs.
2. **CA-issued / eIDAS** — for a permanent green tick everywhere, obtain a
   document-signing certificate from a public CA (or a Qualified cert / QES from an
   eIDAS trust-service provider) and point `sign.sh` at that `.p12`. See
   `references/trust-and-upgrade.md`.

Most B2B "we need a signed invoice" requirements are satisfied by option 1 (or even by
the self-signed signature alone — it is a bona-fide digital signature).

## Visible signature panel
By default a compact panel is drawn (signer, reason, UTC date, location). Default
placement targets the blank lower area of the **last** page (works well for invoices
whose final page carries only remittance details). Control it:
```bash
--page N            # 1-based page for the panel (default: last)
--pos x1,y1,x2,y2   # box in PDF points from bottom-left
--image sig.png     # overlay a scanned autograph as the panel background
--reason "…" --location "…" --name "…"
```

## Durable install (bake into the image)
`setup.sh` prefers an ambient `python3` that already imports pyHanko and only builds a
venv as a fallback. To make it venv-free after a rebuild, add to `flake.nix`'s
`pythonRuntimeEnv` (the `python.withPackages` list): `pyhanko  pillow  fonttools`
(`cryptography`/`asn1crypto`/`oscrypto` come transitively). `poppler-utils` (for
`pdfsig` verification) and `qpdf` are already in the image. See the block near
`pikepdf` in `pythonRuntimeEnv`.

## Verifying
```bash
pdfsig signed.pdf                 # poppler — validity + signed-range + signer DN
./scripts/sign_pdf.py --help      # all options
```
`pdfsig` prints `NSS_Init failed: … bad database` first — harmless (no NSS cert DB);
the `Signature Validation: Signature is Valid.` line is the one that matters.

## Files
- `scripts/sign.sh` — entry point (setup → identity → sign)
- `scripts/setup.sh` — resolve/provision interpreter, prints its path
- `scripts/sign_pdf.py` — the signer (pyHanko API; honours `$PDF_SIGNING_KEYS_DIR`)
- `scripts/make_signing_cert.py` — generate a self-signed signing identity
- `references/trust-and-upgrade.md` — trust import, CA/eIDAS upgrade, PAdES levels, LTV
