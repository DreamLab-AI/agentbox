---
name: statcraft
description: "Runs SPSS-compatible statistics headlessly with the pure-Rust StatCraft engine (statcraft-run): CSV, SAV or XLSX in, SPSS syntax executed, exact results out as JSON. Use for a significance test, t-test, ANOVA, crosstab, correlation, regression, factor or reliability analysis, Mann-Whitney or Kruskal-Wallis, survey analysis, or opening an SPSS .sav, even if the user only asks 'is this difference significant'. Not for model training (pytorch-ml), interactive notebooks (jupyter-notebooks) or stateful exploratory analysis (codeact)."
---

# StatCraft (headless)

`statcraft-run` drives the [StatCraft](https://github.com/kobaltgit/StatCraft) engine
(MIT OR Apache-2.0) with no GUI. Upstream's own `--mcp` mode only relays to a running
desktop app on `127.0.0.1:18493`, so it does not work in agentbox; use this runner.

Gate: `[skills.data_science].statcraft = true` (rebuild-class). Check: `command -v statcraft-run`.

## Run a script

```bash
statcraft-run run data.csv analysis.sps          # or a .sav / .xlsx (--sheet NAME) / .tsv
echo 'T-TEST GROUPS=grp(1 2) /VARIABLES=score.' | statcraft-run run data.csv -
```

Output is one JSON document: `{"dataset": {"cases", "variables"}, "results": [{"command",
"line", "result"}]}`. Exit status is non-zero on any load, parse or execution error.

## Discover what exists

- `statcraft-run commands` — the 55 engine commands with their parameter schemas.
- `statcraft-run syntax-help` — the SPSS syntax reference; a copy is in
  [references/spss-syntax.md](references/spss-syntax.md).

## Verified behaviour

Checked against scipy 1.16 on a 12-case two-group dataset: Student and Welch t, df and
two-sided p, Levene F, descriptives and Pearson r agree to about 15 significant figures. The
engine's own 318 unit tests run in the Nix build (`lib/statcraft.nix`).

## Rules

- Report the test, statistic, df, p and effect size together; never a bare p.
- Keep the `.sps` script and the data file with the result so anyone can re-run it.
- Mixed models, Bayesian analysis and survival analysis are not in the engine; say so.
