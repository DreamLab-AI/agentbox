# Trust, verification and upgrade path

## The three things a verifier checks
1. **Integrity** — does the signed byte range still hash to the embedded value? Any
   edit after signing fails this. Always enforced by the maths.
2. **Signer identity** — does the certificate chain up to a Certificate Authority the
   reader trusts? This is the *only* thing a self-signed cert does not satisfy by
   default.
3. **Time** — when was it signed? A signed local clock time is present; a *trusted*
   time needs an RFC-3161 timestamp from a TSA (`--tsa`).

A self-signed signature nails (1) always and (3) if you add `--tsa`. Only (2) needs a
trust decision by the recipient.

## Getting "identity verified" with the self-signed cert
Send the recipient `dreamlab-signing-cert.pem` (public, safe to email) once.

- **Adobe Acrobat / Reader**: open the signed PDF → click the signature → "Signature
  Properties" → "Show Signer's Certificate" → "Trust" tab → "Add to Trusted
  Certificates" (tick "use for signing"). Thereafter every doc signed with this key
  shows a green tick for them.
- **Linux `pdfsig`**: it validates the signature regardless; "Certificate issuer is
  unknown" just reflects no NSS trust store entry. To make it chain, import the PEM into
  an NSS DB (`certutil -A -n dreamlab -t "TCu,Cu,Tu" -i dreamlab-signing-cert.pem -d
  sql:$HOME/.pki/nssdb`).
- **DSS / EU validators**: will report "indeterminate / no trust anchor" — expected for
  a private cert; upload the cert as a custom trust anchor to validate.

## Upgrading to a fully-trusted certificate
When you want a green tick for *anyone* with no manual import, replace the self-signed
`.p12` with a CA-issued one and point `sign.sh` at it (same passphrase-file convention,
or edit `sign_pdf.py`'s `--p12/--passfile`).

| Tier | What it gives | Source | Cost |
|------|---------------|--------|------|
| Self-signed (this skill) | valid signature, manual trust | local | free |
| Adobe AATL document-signing cert | green tick in Adobe out-of-the-box | AATL CA (GlobalSign, Sectigo, Entrust…) | ~£150–400/yr |
| eIDAS **Advanced** (AdES) cert | legally-recognised e-signature in EU/UK | eIDAS TSP | ~£100–300/yr |
| eIDAS **Qualified** (QES) | equivalent to a handwritten signature in law | Qualified TSP + identity vetting, often HSM/USB token | ~£200–600/yr + token |

All of these are just a different `.p12`/PKCS#11 token fed to the same pyHanko flow —
pyHanko supports PKCS#11 (`pyhanko.sign.pkcs11`) for HSM/smartcard-held qualified keys.

## PAdES levels (what `--tsa` and LTV buy you)
- **B-B** (default here): basic — signature + cert. Verifiable while the cert is valid.
- **B-T**: adds a trusted timestamp (`--tsa URL`). Proves *when* it was signed; survives
  later key expiry for the "signed before expiry" question.
- **B-LT / B-LTA**: adds long-term validation material (OCSP/CRL, cert chain, archival
  timestamps) so it stays verifiable for years/decades even if CAs go offline. pyHanko
  does this via `use_pades_lta=True` + a `ValidationContext`; needs network at signing
  and a TSA. Use for contracts meant to be checkable long after issue.

Free public TSAs (no auth): `http://timestamp.digicert.com`,
`http://timestamp.sectigo.com`, `http://rfc3161.ai.moda`. Availability varies; a signed
doc without a timestamp is still valid.

## Why pyHanko (vs alternatives)
- **pyHanko** — pure-python, PAdES/CAdES, LTV, PKCS#11/HSM, visible stamps, scriptable.
  Best open-source coverage; what this skill uses.
- **JSignPdf / iText (Java)** — capable but heavier runtime; iText AGPL/commercial.
- **LibreOffice headless** — can sign but needs the whole office stack and a preset key.
- **openssl + qpdf** — can build a signature by hand but you reimplement PAdES; avoid.
- **`pdfsig` (poppler)** — verify only, already in the image. Good verification partner.
