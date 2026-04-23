# LaTeX & TeX Live Configuration

## Version

Agentbox uses `pkgs.texliveFull` from nixpkgs-unstable. This provides the complete TeX Live distribution with ~7,000 packages.

**Alternative**: Use `pkgs.texlive.combined.scheme-full` if `texliveFull` bloats the image. Both are functionally equivalent and include all core LaTeX packages.

## Enabling LaTeX

Set in `agentbox.toml`:
```toml
[skills.docs]
latex = true
report_builder = true  # Recommended: enables report generation
```

This installs:
- `texliveFull`: All TeX Live packages (pdflatex, xelatex, biber, etc.)
- `biber`: Bibliography engine for BibLaTeX

## Covered Packages

- **Core**: pdflatex, xelatex, lualatex, latexmk
- **Fonts**: DejaVu, Liberation, Noto fonts
- **Bibliography**: BibTeX, BibLaTeX, biber
- **Graphics**: pgfplots, TikZ, graphicx
- **Documents**: Beamer, book, report, article classes
- **Extras**: hyperref, fancyhdr, geometry, babel

## Adding Custom Packages

To add a specific LaTeX package (e.g., `listings`):
1. Extend `docsPackages` in `flake.nix`:
   ```nix
   docsPackages = lib.optionals ((docsCfg.latex or false) || (docsCfg.report_builder or false)) [
     pkgs.texliveFull
     pkgs.biber
     pkgs.texlivePackages.listings  # Add custom package
   ];
   ```
2. Rebuild: `nix build .#runtime`

## Downsizing

If `texliveFull` is too large, substitute with a curated scheme:
```nix
pkgs.texlive.combined.scheme-medium  # ~3000 packages, 1.5GB
pkgs.texlive.combined.scheme-small   # ~400 packages, 200MB
```
