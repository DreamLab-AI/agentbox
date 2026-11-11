---
name: cad-print
description: "Slices a model for 3D printing: turns an `.stl`, `.3mf` or `.obj` into printer-ready G-code with OrcaSlicer, headless, with built-in profiles for most FDM printers (Prusa, Bambu Lab, Creality, Voron), and tells the person how to hand it to their printer. Use when a model should be sliced or printed. Never starts a print and never contacts a printer. Whether a part will print is cad's manufacturing check."
license: MIT
---

# 3D printing

Get a part printed: slice it for the person's printer and hand the print to the printer's app. The
part itself is designed with the cad skill, and whether it will print (walls, overhangs, supports,
orientation) is the cad skill's manufacturing check: run it first when the person asks. This skill
never starts a print.

## Start with the task

| Task | Start with | Reference |
| --- | --- | --- |
| **Slice it to G-code** | `python scripts/orca_presets.py --list machine --match "<printer>"` | [Slice with OrcaSlicer](#slice-with-orcaslicer) |
| **Print on a Bambu Lab printer** | The sliced `.gcode.3mf`, handed to the person | [Handing the slice to a printer](#handing-the-slice-to-a-printer) |
| **Will this print?** | `cad`'s printing check | Its manufacturing references |

## Slice with OrcaSlicer

Slice with OrcaSlicer, headless. The agent never contacts a printer: the person gets the sliced
file ([below](#handing-the-slice-to-a-printer)).

### OrcaSlicer in agentbox

`orca-slicer` is on PATH when `[skills.spatial_and_3d] cad_print = true` in `agentbox.toml`; where
`command -v orca-slicer` finds nothing, it is gated off and needs that flag and an image rebuild. Do
not download an AppImage or Flatpak. Its built-in printer profiles are in the package, not in a home
folder, so give them to the preset script:

```bash
PROFILES="$(dirname "$(readlink -f "$(command -v orca-slicer)")")/../share/OrcaSlicer/profiles"
python3 scripts/orca_presets.py --profiles "$PROFILES" --list machine --match "MK4S"
```

Below, `<orca>` is `orca-slicer`, and every `orca_presets.py` call takes that `--profiles`.

### Slice headless

OrcaSlicer's command line (https://www.orcaslicer.com/wiki/cli/cli_mode) needs
complete presets: it doesn't fill in a preset's parent settings, and it slices
only with a process whose compatible printers name the printer.
`scripts/orca_presets.py` (Python 3, no dependencies) writes them from
OrcaSlicer's presets, searching the person's own first, then OrcaSlicer's
built-in profiles.

1. Find the person's printer, process and filament presets. Prefer the presets
   they print with; never invent one, since a wrong bed size or
   temperature can damage the printer.

   ```bash
   python scripts/orca_presets.py --list machine --match "MK4S"
   python scripts/orca_presets.py --list process --match "@MK4S 0.4"
   python scripts/orca_presets.py --list filament --match "PLA @MK4S"
   ```

2. Write the complete presets:

   ```bash
   python scripts/orca_presets.py --printer "Prusa MK4S 0.4 nozzle" \
     --process "0.20mm SPEED @MK4S 0.4" --filament "Prusa Generic PLA @MK4S" \
     --out presets
   ```

3. Slice. Give `--outputdir` an absolute path:

   ```bash
   <orca> model.stl \
     --load-settings "presets/process.json;presets/printer.json" \
     --load-filaments presets/filament-1.json \
     --arrange 1 --slice 0 \
     --outputdir /absolute/path/to/out --export-3mf model.gcode.3mf
   ```

   This writes `plate_1.gcode`, the plain G-code, and `model.gcode.3mf`, the
   sliced 3MF, into that folder. The command line reads `.stl`,
   `.3mf`, `.obj` and `.amf`; export STEP to STL or 3MF first (for a text-to-cad model, `cad model export <id> part.3mf`, or `cad step export part.step part.3mf`).
   Override one setting with `--<setting>=<value>`, using the setting's key
   with hyphens for underscores, such as `--layer-height=0.16`.

## Handing the slice to a printer

There is no slicer app, Bambu Connect or Bambu Studio in this container, and no printer on its
network. The deliverable is the sliced file: give the person the `.gcode` or `.gcode.3mf` path and
say how it reaches their printer. A Bambu Lab printer takes jobs from other software only through
Bambu Connect (Windows, macOS) or Bambu Studio on their own computer: they open the `.gcode.3mf`
there, pick the printer and press Print. Never report a print as started, never ask for printer
access codes, and tell them what to check first: printer, plate type, nozzle, filament and AMS
mapping, a clear build plate, and someone nearby for the first layer.

## Any other printer

The person prints the `.gcode` from their printer's app, its web interface
(PrusaLink, OctoPrint, Mainsail, Fluidd) or an SD card.

## Check each change

Before anyone prints a slice:

- `<orca> model.stl --info` prints the model's size; it has to fit the bed.
- Check the slice's settings, which OrcaSlicer writes at the end of the G-code:

  ```bash
  grep -E '^; (printer_model|nozzle_diameter|filament_type|nozzle_temperature|hot_plate_temp|bed_temperature) =|printing time' out/plate_1.gcode
  ```

  Confirm they match the person's printer and material before anyone prints it.
