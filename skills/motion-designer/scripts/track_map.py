#!/usr/bin/env python3
# track_map.py - map a music track before cutting it to picture. Claude cannot listen, so it measures.
#   python3 track_map.py <track.wav|mp3> [--bpm 120]
# The beat grid is read from the low band (kick). Prints: tempo, beat phase (seconds past each beat grid line), per-second loudness, the biggest
# energy jumps (drop candidates, snapped to the beat grid) and where the sound ends.
import numpy as np, subprocess, sys, argparse
ap=argparse.ArgumentParser(); ap.add_argument('track'); ap.add_argument('--bpm',type=float); a=ap.parse_args()
SR=11025
raw=subprocess.run(['ffmpeg','-loglevel','error','-i',a.track,'-ac','1','-ar',str(SR),'-f','s16le','-'],capture_output=True).stdout
x=np.frombuffer(raw,'<i2')/32768
hop=64; n=len(x)//hop; fr=SR/hop
e=np.sqrt((x[:n*hop].reshape(n,hop)**2).mean(1)); tt=np.arange(n)/fr
lo=np.convolve(x,np.ones(37)/37,'same')            # ~150 Hz low-pass: the grid comes from the kick, not the hats
el=np.sqrt((lo[:n*hop].reshape(n,hop)**2).mean(1)); o=np.maximum(0,np.diff(el,prepend=0))
def score(bpm):
    per=60/bpm; h=np.bincount(((tt%per)/per*40).astype(int),weights=o,minlength=40); return h.max()/h.sum(),h
cands=np.arange(a.bpm-1,a.bpm+1.001,0.01) if a.bpm else np.arange(70,180,0.05)
bpm=max(cands,key=lambda b:score(b)[0]); per=60/bpm; h=score(bpm)[1]; phase=(np.argmax(h)+0.5)/40*per-hop/SR
print(f'bpm {bpm:.2f}   beat = {per:.4f} s   beats fall at phase {phase:.3f} s (t = phase + k*beat)')
sec=len(x)//SR; E=[20*np.log10(np.sqrt((x[i*SR:(i+1)*SR]**2).mean())+1e-9) for i in range(sec)]
print('loudness per second (dB):'); print(' '.join(f'{i}:{v:.0f}' for i,v in enumerate(E)))
snap=lambda t: phase+round((t-phase)/per)*per
j=sorted(range(2,sec-2),key=lambda i:-(np.mean(E[i:i+2])-np.mean(E[i-2:i])))[:4]
print('drop candidates (beat-snapped):',', '.join(f'{snap(i):.3f}' for i in sorted(j)))
loud=np.where(e>10**(-40/20))[0]; end=loud[-1]/fr
print(f'sound ends at {end:.2f} s   last beat before it: {phase+np.floor((end-phase)/per)*per:.3f}   bars (4/4) are {4*per:.3f} s')
