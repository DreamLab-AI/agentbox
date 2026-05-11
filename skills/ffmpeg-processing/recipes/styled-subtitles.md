# Styled Subtitles

Burn-in (rasterised into video) versus soft (separate track). Burn-in for platforms that ignore tracks (TikTok, IG); soft for archival, accessibility, multi-language.

## Burn-in SRT with custom font and styling

```bash
ffmpeg -y -i input.mp4 -vf \
  "subtitles=subs.srt:fontsdir=.:force_style='FontName=Poppins,FontSize=24,\
PrimaryColour=&HFFFFFF,OutlineColour=&H4066B66B,Outline=1,BorderStyle=3'" \
  -c:v libx264 -crf 18 -c:a copy output_subs.mp4
```

### Notes

- `FontName=Poppins` is the **font family name** as registered inside the file, **not** the file name. Open the `.ttf` to find it.
- `fontsdir=.` tells FFmpeg where to look for the font file.
- `BorderStyle=3` = opaque box around the text; `=1` = outline only.
- Colours are `&HAABBGGRR` (alpha first, then BGR -- not RGB). Alpha `00`=opaque, `FF`=transparent. `&HFFFFFF` is opaque white.
- `Outline=1` is outline width in pixels.

### Common style fields

| Field | Effect |
|---|---|
| `FontName`, `FontSize` | Family + point size |
| `PrimaryColour` | Fill colour (`&HAABBGGRR`) |
| `OutlineColour` | Outline / box colour |
| `BorderStyle` | 1 = outline + drop shadow, 3 = opaque box |
| `Outline` | Outline thickness or box padding |
| `Shadow` | Shadow distance |
| `Bold`, `Italic`, `Underline` | 0 / -1 (yes) |
| `Alignment` | 1=BL, 2=BC, 3=BR, 5=TL, 6=TC, 7=TR (numpad layout) |
| `MarginV` | Vertical margin from edge in pixels |

## Burn-in ASS (advanced styling, animations, karaoke)

ASS supports per-line override tags (`{\b1}bold{\b0}`, `{\fade(...)}`, `{\move(...)}`, etc.). For pixel-perfect or animated subs, ASS beats SRT. Authoring tool: Aegisub.

```bash
ffmpeg -y -i input.mp4 -vf "ass=subs.ass:fontsdir=." -c:v libx264 -crf 18 -c:a copy output.mp4
```

For truly bespoke effects (per-character animation, custom shapes) -- generate transparent PNG sequences outside any subtitle format and overlay them. See [timed-text-overlays.md](timed-text-overlays.md).

## Soft subs in MKV (no re-encode)

```bash
ffmpeg -y -i video.mp4 -i subs.srt \
  -c copy -c:s srt -disposition:s:0 default \
  output.mkv
```

`-disposition:s:0 default` flags the first subtitle stream as the default track. MKV stores SRT natively. For MP4, use `-c:s mov_text`.

## Multiple soft sub tracks with language metadata

```bash
ffmpeg -y -i video.mp4 -i en.srt -i es.srt -i fr.srt \
  -map 0 -map 1 -map 2 -map 3 -c copy -c:s srt \
  -metadata:s:s:0 language=eng -metadata:s:s:0 title="English" \
  -metadata:s:s:1 language=spa -metadata:s:s:1 title="Español" \
  -metadata:s:s:2 language=fra -metadata:s:s:2 title="Français" \
  -disposition:s:0 default \
  output.mkv
```

## Extract embedded subs

```bash
ffmpeg -y -i video.mkv -map 0:s:0 subs.srt
```

`0:s:0` = first subtitle stream of the first input. Use `ffprobe -show_streams` to enumerate.

## Trim before burning to skip irrelevant ranges

```bash
ffmpeg -y -i input.mp4 -ss 00:00 -to 00:40 -vf \
  "subtitles=subs.srt:force_style='FontName=Poppins,FontSize=24,BorderStyle=3'" \
  -c:v libx264 -c:a copy output.mp4
```

The `-ss/-to` here is output-seeking (after `-i`) so timestamps line up with the original SRT.
