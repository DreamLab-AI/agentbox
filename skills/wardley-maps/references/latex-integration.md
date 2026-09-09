# LaTeX Integration — worked example

Full workflow for including a Wardley map in a LaTeX document: write the `.mmd` file,
render it via the browsercontainer sidecar (`/opt/agentbox/scripts/mmdc-sidecar.sh`, same as the main
`wardley-beta` example in `../SKILL.md`), then `\includegraphics` the result.

## Step 1 — Write the `.mmd` file

```
wardley-beta
title Creative Industries -- AI Strategic Positioning 2026
size [1100, 700]
evolution genesis / concept -> custom / emerging -> product / converging -> commodity / accepted

anchor creator [0.95, 0.50]
anchor audience [0.95, 0.80]

component "Creative Output" [0.85, 0.50] label [12, -6]
component "AI Tools" [0.60, 0.50] label [12, -6]
component "Distribution" [0.75, 0.80] label [12, -6]
component "Brand/Reputation" [0.70, 0.25] label [-90, 0]
component "AI Training Data" [0.30, 0.50] label [12, -6]
component "Compute" [0.15, 0.50] label [12, -6]

creator -> "Creative Output"
creator -> "Brand/Reputation"
"Creative Output" -> "AI Tools"
"Creative Output" -> "Distribution"
audience -> "Distribution"
"AI Tools" -> "AI Training Data"
"AI Training Data" -> "Compute"
```

**Four strategic positions for creative industries:**

| Position | Description | Map signal |
|----------|-------------|------------|
| All-in | Fully embrace AI in all workflows | AI Tools near product/commodity |
| AI-native | Build with AI from the ground up | AI Tools as anchor component |
| Refusal | Human-only, premium positioning | AI Tools absent from map |
| Middle | Selective AI augmentation | AI Tools in custom/emerging |

## Step 2 — Render via browsercontainer sidecar

```bash
/opt/agentbox/scripts/mmdc-sidecar.sh -i map.mmd -o figures/wardley/creative_industries.png
# Or for vector output:
/opt/agentbox/scripts/mmdc-sidecar.sh -i map.mmd -o figures/wardley/creative_industries.svg
```

## Step 3 — Include in LaTeX

```latex
\begin{figure}[htbp]
  \centering
  \includegraphics[width=0.9\textwidth]{figures/wardley/creative_industries.png}
  \caption{Strategic positioning for creative industries, May 2026.}
  \label{fig:wardley-creative}
\end{figure}
```
