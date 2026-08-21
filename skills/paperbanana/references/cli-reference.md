# PaperBanana CLI Reference

Full command surface for the `paperbanana` CLI.

## `paperbanana generate`

Generate a methodology/architecture diagram from text.

```bash
paperbanana generate \
  --input <file.txt|->       # Source text (file or stdin)
  --caption <string>          # Figure caption / communicative intent
  --iterations <N>            # Refinement iterations (default: 3)
  --auto                      # Loop until critic satisfied
  --optimize                  # Pre-process inputs for quality
  --continue                  # Resume a previous run with feedback
  --format <png|jpeg|webp>    # Output format (default: png)
  --vlm-provider <openai|google|openrouter>
  --vlm-model <model-id>
  --image-provider <openai|google>
  --image-model <model-id>
  --verbose                   # Detailed progress
```

## `paperbanana plot`

Generate a statistical plot from data.

```bash
paperbanana plot \
  --data <file.csv>           # Data file
  --intent <string>           # What the plot should show
  --iterations <N>            # Refinement iterations
  --auto                      # Auto-refine
  --format <png|jpeg|webp>
```

## `paperbanana evaluate`

Evaluate a generated diagram against a reference.

```bash
paperbanana evaluate \
  --generated <diagram.png>   # Generated image
  --reference <ref.png>       # Human-drawn reference
  --context <method.txt>      # Source text
  --caption <string>          # Original caption
```

## `paperbanana batch`

Generate multiple figures from a manifest file.

```bash
paperbanana batch --manifest figures.yaml --optimize
```

Manifest format (YAML):
```yaml
items:
  - input: sections/method.txt
    caption: "Overview of encoder-decoder architecture"
    id: fig1
  - input: sections/training.txt
    caption: "Training pipeline with data augmentation"
    id: fig2
  - data: results/accuracy.csv
    intent: "Accuracy comparison bar chart"
    id: fig3
```
