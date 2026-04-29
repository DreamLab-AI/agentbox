# Image-to-Video, Slideshows, Ken Burns

Image to video, fading slideshows, and Ken Burns zoom/pan effects.

## Single image to looping video with audio

```bash
ffmpeg -y -loop 1 -t 10 -i still.png -i music.mp3 -vf \
  "scale=1280:720:force_original_aspect_ratio=decrease,\
pad=1280:720:-1:-1:color=black,setsar=1,\
fade=t=in:st=0:d=1,format=yuv420p" \
  -c:v libx264 -c:a aac -shortest output_loop.mp4
```

`-loop 1 -t 10` -- repeat the image as a stream, capped at 10 seconds. Without `-t`, the loop is infinite. `fade=t=in:st=0:d=1` adds a 1s fade-in.

Tip: for remote images, download once locally first -- with `-loop 1` over HTTP, FFmpeg may re-fetch every frame.

## Slideshow with fade-between transitions

```bash
ffmpeg -y \
  -loop 1 -t 5 -i img1.png \
  -loop 1 -t 5 -i img2.png \
  -i music.mp3 -filter_complex \
  "[0:v]format=yuv420p,fade=t=in:st=0:d=0.5,setpts=PTS-STARTPTS[v0];\
[1:v]format=yuv420p,fade=t=out:st=4.5:d=0.5,setpts=PTS-STARTPTS[v1];\
[v0][v1]xfade=transition=fade:duration=0.5:offset=4.5,format=yuv420p[v]" \
  -map "[v]" -map 2:a -c:v libx264 -c:a aac -shortest slideshow.mp4
```

Output is `5 + 5 - 0.5 = 9.5s` because the 0.5s `xfade` overlaps. `transition=` accepts dozens of styles: `fade`, `wipeleft`, `slideup`, `circleopen`, `pixelize`, etc. (see `ffmpeg -h filter=xfade`).

For N images, chain `xfade` filters or use `concat` with per-clip `fade` filters.

## Ken Burns (zoom and pan)

```bash
ffmpeg -y \
  -loop 1 -i img1.png -loop 1 -i img2.png -i music.mp3 -filter_complex \
  "[0:v]scale=8000:-1,\
zoompan=z='zoom+0.005':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=100:s=1920x1080:fps=25,\
trim=duration=4,format=yuv420p,setpts=PTS-STARTPTS[v0];\
[1:v]scale=8000:-1,\
zoompan=z='if(lte(zoom,1.0),1.5,max(zoom-0.005,1.005))':x=0:y='ih/2-(ih/zoom/2)':d=100:s=1920x1080:fps=25,\
trim=duration=4,format=yuv420p,setpts=PTS-STARTPTS[v1];\
[v0][v1]xfade=transition=fade:duration=1:offset=3,format=yuv420p[v]" \
  -map "[v]" -map 2:a -c:v libx264 -c:a aac -shortest kenburns.mp4
```

Key parameters of `zoompan`:

| Param | Meaning |
|---|---|
| `z` | Zoom factor expression. `zoom+0.005` per frame slowly zooms in. To zoom out, start at 1.5 and decrement. |
| `x`, `y` | Top-left of the visible window. `iw/2-(iw/zoom/2)` keeps it centred. |
| `d` | Number of output frames. 100 frames at fps=25 = 4 seconds. |
| `s` | Output resolution. |
| `fps` | Output frame rate. |

`scale=8000:-1` first upscales the source to give zoompan room to crop without softness. Drop or lower if memory is tight.

## Burn-in fade for trim+concat compilations

Take two segments from the same source, fade in/out each, concat:

```bash
ffmpeg -y -i input.mp4 -filter_complex \
  "[0:v]trim=11:15,setpts=PTS-STARTPTS,fade=t=in:st=0:d=0.5,fade=t=out:st=3.5:d=0.5[v1];\
[0:a]atrim=11:15,asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.5,afade=t=out:st=3.5:d=0.5[a1];\
[0:v]trim=21:25,setpts=PTS-STARTPTS,fade=t=in:st=0:d=0.5,fade=t=out:st=3.5:d=0.5[v2];\
[0:a]atrim=21:25,asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.5,afade=t=out:st=3.5:d=0.5[a2];\
[v1][a1][v2][a2]concat=n=2:v=1:a=1[outv][outa]" \
  -map "[outv]" -map "[outa]" -c:v libx264 -c:a aac compilation.mp4
```

`setpts=PTS-STARTPTS` and `asetpts=PTS-STARTPTS` reset timestamps after each trim so `concat` lines them up correctly.
