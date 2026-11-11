#!/usr/bin/env bash
# master.sh - mix, master and mux under the picture. Picture length rules.
#   bash master.sh <picture.mp4> <out.mp4> [--vo f] [--music f] [--sfx f] [--keep-audio] [--music-db -14]
#     --vo          speech; the music ducks under it (sidechain)
#     --music       bed (post only, never from a video model)
#     --sfx         hits / synthesized score / ambience stem
#     --keep-audio  also mix the picture's own audio (A-roll VO or generated ambience)
# Rights: an input with a <file>.rights.json whose status is "holding" (holding_track.sh, carried by
# music_cut.py) makes this a holding export. Its name must contain "holding", the MP4 and WAV are
# tagged, and <out>.rights.json is written. A holding export is for review, never for publication.
# Master: about -14 LUFS integrated, WAV limited to -2.2 dBTP so the AAC stays under -1 dBTP.
# Prints measured LUFS and true peak of the DECODED output.
set -euo pipefail
PIC="$1"; OUT="$2"; shift 2
VO=""; MUSIC=""; SFX=""; KEEP=0; MDB=-14
while [ $# -gt 0 ]; do case "$1" in
  --vo) VO="$2"; shift 2;; --music) MUSIC="$2"; shift 2;; --sfx) SFX="$2"; shift 2;;
  --keep-audio) KEEP=1; shift;; --music-db) MDB="$2"; shift 2;; *) echo "unknown $1"; exit 2;; esac; done

# Holding if the file is named HOLDING_*, or has a rights record that says so, or has a rights
# record that cannot be read: an unreadable record never clears a track.
HOLD=""; HOLDWHY=""
for f in "$VO" "$MUSIC" "$SFX"; do
  [ -n "$f" ] || continue
  case "$(basename "$f")" in HOLDING_*) HOLDWHY="$(basename "$f") is named as a holding track";; esac
  if [ -f "$f.rights.json" ]; then
    ST=$(jq -r '.status // ""' "$f.rights.json" 2>/dev/null) || ST="unreadable"
    if [ "$ST" = "holding" ]; then HOLD="$f.rights.json"; HOLDWHY="$(basename "$f.rights.json") marks this audio as a holding track"
    elif [ "$ST" = "unreadable" ]; then HOLDWHY="$(basename "$f.rights.json") cannot be read, so the audio is treated as a holding track"; fi
  fi
done
TAG=()
if [ -n "$HOLDWHY" ]; then
  case "$(basename "$OUT" | tr 'A-Z' 'a-z')" in *holding*) ;; *)
    echo "refused: $HOLDWHY (unlicensed stand-in)."
    echo "Name the export so it says so, for example $(basename "${OUT%.*}")_holding.${OUT##*.}, or cut a licensed track."; exit 3;; esac
  TAG=(-metadata "comment=HOLDING TRACK: unlicensed stand-in audio, review only, not for publication")
fi
WORK="$(dirname "$OUT")/_master"; mkdir -p "$WORK"
DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$PIC")
IN=(); F=""; n=0; SPEECH=""; BUS=()
add() { IN+=(-i "$1"); n=$((n + 1)); }
fit="aresample=48000,aformat=channel_layouts=stereo,apad,atrim=0:$DUR"

if [ $KEEP = 1 ] && ffprobe -v error -select_streams a:0 -show_entries stream=codec_type -of csv=p=0 "$PIC" | grep -q audio; then
  add "$PIC"; F+="[$((n-1)):a]${fit}[pic];"; BUS+=("[pic]"); SPEECH="pic"; fi
if [ -n "$VO" ]; then add "$VO"; F+="[$((n-1)):a]$fit,afade=t=in:d=0.03[vo];"; BUS+=("[vo]"); SPEECH="vo"; fi
if [ -n "$SFX" ]; then add "$SFX"; F+="[$((n-1)):a]${fit}[sfx];"; BUS+=("[sfx]"); fi
if [ -n "$MUSIC" ]; then
  add "$MUSIC"; F+="[$((n-1)):a]$fit,volume=${MDB}dB,afade=t=out:st=$(python3 -c "print(max(0,$DUR-1.5))"):d=1.5[mus0];"
  if [ -n "$SPEECH" ]; then
    F+="[$SPEECH]asplit=2[${SPEECH}d][key];[mus0][key]sidechaincompress=threshold=0.02:ratio=6:attack=15:release=350[mus];"
    BUS=("${BUS[@]/\[$SPEECH\]/[${SPEECH}d]}")
  else F+="[mus0]anull[mus];"; fi
  BUS+=("[mus]")
fi
[ $n -gt 0 ] || { echo "no audio given"; exit 2; }
F+="$(printf '%s' "${BUS[@]}")amix=inputs=${#BUS[@]}:duration=first:normalize=0,aformat=sample_fmts=fltp[mix]"
ffmpeg -y -loglevel error "${IN[@]}" -filter_complex "$F" -map "[mix]" -c:a pcm_f32le "$WORK/mix.wav"

lufs() { ffmpeg -hide_banner -i "$1" -af ebur128=peak=true -f null - 2>&1 | awk '$1=="I:"{i=$2} $1=="Peak:"{p=$2} END{print i, p}'; }
# -2.2 dBTP brickwall at 4x oversampling; four rounds converge near -14 LUFS
LIM=$(python3 -c "print(round(10**(-2.2/20), 4))")
for round in 1 2 3 4; do
  I=$(lufs "$WORK/mix.wav" | awk '{print $1}')
  GAIN=$(python3 -c "print(round(-14 - float('$I'), 2))")
  ffmpeg -y -loglevel error -i "$WORK/mix.wav" -af "aresample=192000,volume=${GAIN}dB,alimiter=limit=$LIM:attack=1:release=60:level=false,aresample=48000" -c:a pcm_f32le "$WORK/mix_m.wav"
  mv "$WORK/mix_m.wav" "$WORK/mix.wav"
done
# remove DC, write the master WAV next to the output
ffmpeg -y -loglevel error -i "$WORK/mix.wav" -af "highpass=f=10" "${TAG[@]}" -c:a pcm_s24le "${OUT%.*}_master.wav"
ffmpeg -y -loglevel error -i "$PIC" -i "${OUT%.*}_master.wav" -map 0:v -map 1:a -c:v copy -c:a aac -b:a 256k \
  -t "$DUR" "${TAG[@]}" -movflags +faststart "$OUT"
ffmpeg -y -loglevel error -ss "$(python3 -c "print(min(1.0, $DUR/2))")" -i "$OUT" -frames:v 1 "${OUT%.*}_poster.png"
read -r I P <<<"$(lufs "$OUT")"
echo "final  -> $OUT"
echo "master -> ${OUT%.*}_master.wav"
echo "poster -> ${OUT%.*}_poster.png"
echo "decoded: $I LUFS integrated, true peak $P dBFS (target -14 / under -1)"
if [ -n "$HOLDWHY" ]; then
  if [ -n "$HOLD" ]; then jq --arg f "$(basename "$HOLD")" '. + {derived_from: $f}' "$HOLD" > "$OUT.rights.json"
  else jq -n --arg why "$HOLDWHY" '{status: "holding", licensed: false, note: $why}' > "$OUT.rights.json"; fi
  echo "HOLDING EXPORT: $HOLDWHY. Review only. Rights record -> $OUT.rights.json"
fi
rm -rf "$WORK"
