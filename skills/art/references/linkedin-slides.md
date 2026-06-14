# LinkedIn Slide / Carousel Production (Beamer → Nano Banana upcycle)

A repeatable pipeline for turning data/results into a **stunning, faithful, LinkedIn-ready
slide deck**. Diagrams-as-code give exact charts; Nano Banana Pro upcycles each slide into
an editorial visual *without* losing a single number — the best of both.

## When to use
Results decks, launch announcements, research summaries — anything where you need both
**precise data** and **premium visual polish** for LinkedIn (document posts / carousels).

## Pipeline

1. **Author the deck as Beamer (`aspectratio=43` for LinkedIn).** Charts via **PGFPlots**
   (diagrams-as-code — exact bars/numbers). Lead with the headline; one idea per slide;
   teal `#008080` + burnt-orange `#CC5500` on light `#FAF9F6`. Compile with `xelatex`.
2. **Rasterise slides** (no ghostscript needed — use MuPDF):
   ```bash
   mutool draw -o slides/slide-%02d.png -r 200 deck.pdf 1-N
   ```
   (nix mutool: `/nix/store/*mupdf*-bin/bin/mutool`; nix gs also exists if ImageMagick needs it.)
3. **Upcycle each slide via Nano Banana Pro** (`gemini-3-pro-image`) with the slide PNG as
   `--ref` and the shared **metaprompt** (`tools/slide-upcycle-metaprompt.txt`). The metaprompt
   enforces: *the reference is authoritative — reproduce every word/number/bar EXACTLY; improve
   only the visual design; no LaTeX/Beamer artifacts; consistent KG node-motif + palette;
   legible as a thumbnail*. For chart slides, also inject the exact data block (belt-and-braces).
   Driver: `tools/slide-upcycle.sh [2K|4K]` (loops all slides; per-slide chart/diagram addenda).
4. **Audit slide-by-slide IN-MODEL** — read each upcycled image and compare to source: every
   number, label, URL and bar must match. Re-render failures at **4K** (more faithful) then
   resize down for the PDF. 2K is usually enough and is efficient for LinkedIn.
5. **Composite** to a lean PDF (resize for web):
   ```bash
   magick slides-up/slide-*.jpg -resize 1600x1200 -quality 85 deck-upcycled.pdf
   ```

## Lessons learned (2026-06-14, ontology-eval deck)
- **High res = high fidelity.** Nano Banana Pro reproduces text/charts far better at 2K–4K than
  at low res. If a complex chart garbles, bump to 4K then downscale.
- **`--ref` is authoritative** for text — slides with short text need no data injection. For
  bar charts, inject the exact values too; it matched the reference with zero conflicts.
- **Metaprompt = consistency.** One shared base prompt + per-slide addenda keeps the series
  visually coherent (palette, motif, type) while each slide stays faithful.
- **Lead with the win; don't bury the lede.** Curate — features are legion; the deck carries one
  clear message + supporting charts.
- Keep brand + URL (`visionflow.info`) on the title and closing slides.
