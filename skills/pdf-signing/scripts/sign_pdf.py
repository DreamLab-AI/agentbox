#!/usr/bin/env python3
"""Digitally sign a PDF with pyHanko using the DreamLab signing identity.

Applies a cryptographic PAdES (PDF Advanced Electronic Signature) signature —
the ETSI/eIDAS-aligned profile — plus, by default, a visible signature stamp.
The signature covers the whole document: any later edit invalidates it.

  ./venv/bin/python sign_pdf.py INPUT.pdf [-o OUTPUT.pdf]

Common options:
  -o/--output PATH   default: alongside input as <name>-signed.pdf
  --reason TEXT      signature reason (default: invoice issuance line)
  --location TEXT    signing location (default: Eskdale, United Kingdom)
  --name TEXT        signer display name in the visible stamp
  --page N           1-based page for the visible stamp (default: last page)
  --pos BOX          x1,y1,x2,y2 in PDF points from bottom-left (default: bottom-right margin)
  --image PATH       overlay a signature image (e.g. a scanned autograph PNG) in the box
  --tsa URL          add an RFC-3161 trusted timestamp (e.g. http://timestamp.digicert.com)
  --invisible        cryptographic signature only, no visible stamp
  --field NAME       signature field name (default: DreamLabSignature)

Exit status is non-zero on failure. Verify afterwards with:  pdfsig OUTPUT.pdf
"""
import argparse
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

from pyhanko.sign import signers, timestamps
from pyhanko.sign.fields import SigFieldSpec, SigSeedSubFilter, append_signature_field
from pyhanko.pdf_utils.incremental_writer import IncrementalPdfFileWriter
from pyhanko import stamp
from pyhanko.pdf_utils import text

HERE = Path(__file__).resolve().parent
# key store: PDF_SIGNING_KEYS_DIR override, else keys/ beside this script
KEYS = Path(os.environ.get("PDF_SIGNING_KEYS_DIR", HERE / "keys"))
DEFAULT_P12 = KEYS / "dreamlab-signing.p12"
DEFAULT_PASS = KEYS / ".p12-pass"


def parse_box(s: str):
    parts = [float(x) for x in s.replace(" ", "").split(",")]
    if len(parts) != 4:
        raise argparse.ArgumentTypeError("--pos needs 4 comma-separated numbers: x1,y1,x2,y2")
    return tuple(parts)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("input", type=Path)
    ap.add_argument("-o", "--output", type=Path, default=None)
    ap.add_argument("--reason", default="Invoice issued by DreamLab AI Consulting Ltd")
    ap.add_argument("--location", default="Eskdale, United Kingdom")
    ap.add_argument("--name", default="DreamLab AI Consulting Ltd")
    ap.add_argument("--page", type=int, default=0, help="1-based; 0 = last page (default)")
    ap.add_argument("--pos", type=parse_box, default=None, help="x1,y1,x2,y2 pts from bottom-left")
    ap.add_argument("--image", type=Path, default=None)
    ap.add_argument("--tsa", default=None)
    ap.add_argument("--invisible", action="store_true")
    ap.add_argument("--field", default="DreamLabSignature")
    ap.add_argument("--p12", type=Path, default=DEFAULT_P12)
    ap.add_argument("--passfile", type=Path, default=DEFAULT_PASS)
    args = ap.parse_args()

    if not args.input.exists():
        print(f"input not found: {args.input}", file=sys.stderr)
        return 2
    if not args.p12.exists():
        print(f"signing identity missing: {args.p12}\n  run: ./venv/bin/python make_signing_cert.py",
              file=sys.stderr)
        return 2
    passphrase = args.passfile.read_text().strip().encode()

    out_path = args.output or args.input.with_name(args.input.stem + "-signed.pdf")

    signer = signers.SimpleSigner.load_pkcs12(pfx_file=str(args.p12), passphrase=passphrase)
    if signer is None:
        print("failed to load signing identity (bad passphrase?)", file=sys.stderr)
        return 2

    timestamper = timestamps.HTTPTimeStamper(args.tsa) if args.tsa else None

    meta = signers.PdfSignatureMetadata(
        field_name=args.field,
        reason=args.reason,
        location=args.location,
        subfilter=SigSeedSubFilter.PADES,
        md_algorithm="sha256",
        embed_validation_info=bool(args.tsa),
    )

    with args.input.open("rb") as fh:
        w = IncrementalPdfFileWriter(fh)

        stamp_style = None
        if not args.invisible:
            # resolve page + default box
            pages_root = w.root["/Pages"]
            n_pages = int(pages_root["/Count"])
            page_ix = (args.page - 1) if args.page > 0 else (n_pages - 1)
            box = args.pos
            if box is None:
                page_obj = pages_root["/Kids"][page_ix].get_object()
                mb = page_obj.get("/MediaBox") or pages_root.get("/MediaBox") or [0, 0, 595.28, 841.89]
                x0 = float(mb[0])
                # left-aligned panel in the blank lower area of the (last) page —
                # on these invoices that page carries only the top bank block.
                box = (x0 + 56, 590, x0 + 336, 640)
            append_signature_field(
                w, sig_field_spec=SigFieldSpec(args.field, on_page=page_ix, box=box)
            )
            stamp_text = "Digitally signed by %(signer)s\nReason: %(reason)s\nDate: %(ts)s\nLocation: %(location)s"
            style_kwargs = dict(
                stamp_text=stamp_text,
                text_box_style=text.TextBoxStyle(font_size=7),
                border_width=0.6,
            )
            if args.image and args.image.exists():
                from pyhanko.pdf_utils import images
                stamp_style = stamp.TextStampStyle(
                    background=images.PdfImage(str(args.image)), **style_kwargs
                )
            else:
                stamp_style = stamp.TextStampStyle(**style_kwargs)

        pdf_signer = signers.PdfSigner(
            meta, signer=signer, stamp_style=stamp_style, timestamper=timestamper
        )

        appearance_params = {
            "signer": args.name,
            "reason": args.reason,
            "location": args.location,
            "ts": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        }
        with out_path.open("wb") as outf:
            pdf_signer.sign_pdf(
                w, output=outf,
                appearance_text_params=appearance_params if not args.invisible else None,
            )

    print(f"signed  : {out_path}")
    print(f"signer  : {args.name}")
    print(f"profile : PAdES (sha256){' + RFC-3161 timestamp' if args.tsa else ''}"
          f"{' , invisible' if args.invisible else ' , visible stamp'}")
    print("verify  : pdfsig '%s'" % out_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
