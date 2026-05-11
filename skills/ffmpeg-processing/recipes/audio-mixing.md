# Audio Mixing and Processing

Mix, replace, normalise, crossfade, and reformat audio without distorting pitch.

## Replace audio in video

```bash
ffmpeg -y -i video.mp4 -i new.mp3 \
  -map 0:v -map 1:a -shortest \
  -c:v copy -c:a aac \
  output.mp4
```

`-shortest` clips the output to the shorter of the two streams. Drop it to keep full video length (audio cuts to silence).

## Mix BGM into existing audio at lower volume

```bash
ffmpeg -y -i video.mp4 -i music.mp3 -filter_complex \
  "[1:a]volume=0.2[bgm];\
[0:a][bgm]amix=inputs=2:duration=shortest" \
  -shortest -map 0:v -c:v copy -c:a aac output.mp4
```

`volume=0.2` = 20% of original. `amix=duration=shortest` ends when the shorter input ends -- use `duration=first` to lock to the original audio's length, or `duration=longest` to keep going.

`amix` halves perceived loudness with each input by default (sums then normalises). For predictable levels, set per-input volume explicitly.

## Crossfade two audio tracks

```bash
ffmpeg -y -i first.mp3 -i second.mp3 -filter_complex \
  "[0:0][1:0]acrossfade=d=3:c1=exp:c2=qsin" \
  -c:a libmp3lame -q:a 2 output.mp3
```

`d=3` = 3-second crossfade. `c1=exp` = curve for the fade-out (exponential, fast); `c2=qsin` = curve for the fade-in (slow sinusoidal). Other curves: `tri`, `qua`, `cub`, `squ`, `cbr`, `par`, `log`, `ipar`, `dese`, `desi`, `losi`, `nofade`.

## Manual fade + concat (no overlap, gapless)

When you want the tracks back-to-back with fades but no temporal overlap:

```bash
ffmpeg -y -i first.mp3 -i second.mp3 -filter_complex \
  "[0:a]afade=t=out:st=2:d=3[a0];\
[1:a]afade=t=in:st=0:d=3[a1];\
[a0][a1]concat=n=2:v=0:a=1" \
  -c:a libmp3lame -q:a 2 output.mp3
```

Fade out the tail of track one (starting at its 2s mark, over 3s), fade in track two from its start, concat.

## Stereo to mono with explicit channel weighting

```bash
ffmpeg -y -i stereo.mp3 -af "pan=mono|c0=.5*c0+.5*c1" -c:a libmp3lame mono.mp3
```

`c0=.5*c0+.5*c1` -- output channel 0 is 50% input-left + 50% input-right. To prefer one side: `c0=0.7*c0+0.3*c1`.

## Combine audio from two videos, normalise, mono, downsample

```bash
ffmpeg -y -i a.mp4 -i b.mp4 -filter_complex \
  "[0:a][1:a]amix=inputs=2:duration=longest,\
pan=mono|c0=.5*c0+.5*c1,\
dynaudnorm" \
  -ar 16000 -c:a libmp3lame -b:a 64k merged.mp3
```

`dynaudnorm` -- dynamic loudness normalisation, smooths loud and quiet sections. `-ar 16000` = 16 kHz (good for speech / Whisper STT).

## Loudness normalisation (broadcast-grade)

```bash
ffmpeg -y -i input.mp4 -af "loudnorm=I=-16:TP=-1.5:LRA=11" -c:v copy output.mp4
```

`I=-16` integrated LUFS, `TP=-1.5` true peak ceiling, `LRA=11` loudness range. Defaults match streaming platforms (YouTube uses ≈ -14 LUFS).

For accuracy, run a measurement pass first, then apply with the measured values:

```bash
ffmpeg -y -i input.mp4 -af loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json -f null -
# read measured_I, measured_LRA, measured_TP, measured_thresh, target_offset from output, then:
ffmpeg -y -i input.mp4 -af "loudnorm=I=-16:TP=-1.5:LRA=11:\
measured_I=...:measured_LRA=...:measured_TP=...:measured_thresh=...:offset=...:linear=true" \
  -c:v copy output.mp4
```

## Speed change, pitch preserved

```bash
ffmpeg -y -i input.mp4 -filter_complex \
  "[0:v]setpts=PTS/1.5[v];[0:a]atempo=1.5[a]" \
  -map "[v]" -map "[a]" output.mp4
```

`atempo` accepts 0.5–2.0 per stage. For wider range, chain: `atempo=2.0,atempo=2.0` = 4×.

## Format conversion

```bash
# MP3 to high-quality WAV (32-bit float would be pcm_f32le; here 32-bit signed PCM mono 48 kHz)
ffmpeg -y -i input.mp3 -acodec pcm_s32le -ac 1 -ar 48000 output.wav

# Extract AAC without re-encode
ffmpeg -y -i input.mp4 -map 0:a:0 -acodec copy output.aac

# Speech-optimised MP3 (low bitrate, mono, 16 kHz)
ffmpeg -y -i input.mp4 -ar 16000 -ab 48k -codec:a libmp3lame -ac 1 speech.mp3
```

## Audio quality reference

| Codec | Flag | Quality knob |
|---|---|---|
| MP3 | `-c:a libmp3lame` | `-q:a 0` (best) to `-q:a 9` (worst); `-q:a 2` ≈ 170-210 kbps VBR |
| AAC | `-c:a aac` | `-b:a 192k` typical; `-q:a` only with `-strict experimental` |
| Opus | `-c:a libopus` | `-b:a 96k` for music, `-b:a 32k` for speech |
| FLAC | `-c:a flac` | Lossless; `-compression_level 8` for smallest |
