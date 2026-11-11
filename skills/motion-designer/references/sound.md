# Sound: a track cut to picture

The model cannot listen. Every sound decision is made by measuring, and the result is flagged for
a human ear. Picture is finished and locked before any of this.

Commands below are run from the skill folder. The Python scripts need numpy, which the image's
`python3` provides.

## 1. Get the track

Take the first of these that applies.

**A licensed track from the user.** Copy it into the project's `audio/` folder and go to step 2.
This is the only route to a deliverable.

**A music library connector.** If a licensed-music MCP server is connected in this session, search
it at the film's BPM (within 2 BPM, instrumental), download the ONE track you chose into `audio/`
and go to step 2. None is registered in this image by default.

**A holding track.** With neither of the above, do not stall and do not synthesise a music bed.
Fetch a stand-in so the cut can be judged against real music, and replace it later:

```bash
bash scripts/holding_track.sh search "uplifting energetic electronic instrumental 120 bpm" 10
bash scripts/holding_track.sh get "<url>" "<project>/audio"
```

Choose against the brief, not by the first result: the stated BPM within 2 of the film's, the mood
words, instrumental, between one and fifteen minutes, with a build and a drop. The title's BPM
claim is a hint; step 2 measures it. If the measured tempo is more than 2 BPM off the film's, the
cuts will drift: fetch a different one. Three candidates is a reasonable limit before asking.

A holding track is a rough cut tool with these consequences, all enforced by the scripts:

- It is saved as `HOLDING_<id>.wav`, low-passed at 7 kHz so it cannot pass for a master, with a
  `HOLDING_<id>.wav.rights.json` beside it recording the source and `"status": "holding"`.
- `music_cut.py` copies that record onto the mix. `master.sh` then refuses any export whose name
  does not contain `holding`, tags the MP4 and WAV, and writes `<export>.rights.json`.
- Nothing in the chain clears the rights. Whatever a video's title says about licensing, the track
  is unlicensed as far as this project knows. A holding export is for review inside the project.
  It is not published, posted or sent to a client.

Swapping in the licensed track later repeats steps 2, 4 and 5 only. Picture and SFX do not change
if the new track is at the same BPM.

## 2. Map it

```bash
python3 scripts/track_map.py "<audio/track.wav>" --bpm 120
```

Read three things from the output:
- **Beat phase**: beats fall at `phase + k * beat`. The grid comes from the kick, not the hats.
- **Drop**: in the per-second loudness row, find where it jumps (for example -21 to -9 dB). Take
  the beat-snapped drop candidate at that jump.
- **Ending**: where the sound ends, and the last beat before it. A track that stops on a downbeat
  gives a clean ending.

## 3. Write the hit list

One JSON entry per visual hit, in PICTURE time (the script adds the 1-frame delay):

```json
[{"t": 2.0, "type": "impact"}, {"t": 9.0, "type": "riser", "len": 1.0}, {"t": 0.5, "type": "thump", "f": 110}]
```

Types: `impact`, `thump`, `whoosh`, `riser` (ends at `t + len`, put an impact there), `fall`.
All are non-tonal, so they sit on any key. Full example:
[../example/sfx_events.json](../example/sfx_events.json).

```bash
python3 scripts/sfx.py events.json "<audio/name_sfx_v1.wav>" --dur 15 --fps 60
```

## 4. Cut and mix

```bash
python3 scripts/music_cut.py --track "<track.wav>" --dur 15 --fps 60 \
  --drop 24.15 --drop-at 2.0 \
  --end-beat 162.15 --end-at 14.0 --splice 10.0 --track-end 162.45 \
  --sfx "<sfx.wav>" --out "<audio/name_mix_v1.wav>"
```

- `--drop` / `--drop-at`: the track's drop lands on the film's first big hit.
- `--end-beat` / `--end-at`: the track's final downbeat lands on a picture downbeat about 1 s before
  the end, then a reverb tail rings out under the end card.
- `--splice`: picture time where the film jumps to the track's last bars. Put it on a big visual hit
  so an impact covers the edit.
- **Bar rule**: `(end-beat - drop) - (end-at - drop-at)` must be a whole number of bars (2 s at
  120 BPM). If it is half a bar off, move `--end-at` by half a bar.
- No clean ending in the track: leave out the four ending flags and it fades out instead.

Check the printed per-second loudness: the build should be quieter than the drop, and the last
second should fall away, not cut.

## 5. Master

```bash
bash scripts/master.sh <picture.mp4> "<export/name_v1.mp4>" --sfx "<mix.wav>"
bash scripts/master.sh <picture.mp4> "<export/name_holding_v1.mp4>" --sfx "<mix.wav>"   # holding track in the mix
```

Target -14 LUFS, true peak under -1 dBFS. The script prints both.

## Rules

- Never synthesise the music bed when the user asked for a real track. Synthesised sound is SFX only.
- Tonal SFX (blips, stabs, pads) clash with a music track: keep the stem non-tonal.
- Hits land 1 frame AFTER their picture event. Sound before picture feels wrong first.
- Tell the user plainly that the track choice and the splice need their ear, and name the splice time.
- Credit the track and artist wherever the film is posted.
- Never rename a holding export to drop the word, and never delete a `.rights.json` to get past
  `master.sh`. The way out is a licensed track.
