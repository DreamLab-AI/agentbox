#!/usr/bin/env python3
# music_cut.py - cut a track to picture on the beat grid and lay the SFX stem on top.
#   python3 music_cut.py --track t.wav --dur 15 --fps 60 --drop 24.155 --drop-at 2.0 \
#       [--end-beat 162.155 --end-at 14.0 --splice 10.0 --track-end 162.45] [--sfx sfx.wav] --out mix.wav
# Part A: the track's drop (track time --drop) lands on picture time --drop-at.
# Part B (optional): from picture time --splice the track's last bars play so its final downbeat
# (--end-beat) lands on --end-at, then a reverb tail rings out. Keep (end-beat - drop) minus
# (end-at - drop-at) a whole number of bars so the splice is musical. Without part B the track fades out.
# Music lands 1 frame after picture (light beats sound).
# If <track>.rights.json exists (holding_track.sh writes one) it is copied to <out>.rights.json.
import numpy as np, subprocess, wave, argparse, json, os
ap=argparse.ArgumentParser()
for k,d in (('track',None),('out',None),('sfx',None)): ap.add_argument('--'+k,default=d)
for k,d in (('dur',15),('fps',60),('drop',None),('drop-at',2.0),('end-beat',None),('end-at',None),('splice',None),
            ('track-end',None),('music-gain',0.7),('sfx-gain',0.6),('tail',0.011)): ap.add_argument('--'+k,type=float,default=d)
a=ap.parse_args(); SR=48000; off=1/a.fps
raw=subprocess.run(['ffmpeg','-loglevel','error','-i',a.track,'-ac','2','-ar',str(SR),'-f','f32le','-'],capture_output=True).stdout
m=np.frombuffer(raw,'<f4').reshape(-1,2).astype(np.float64)
N=int(a.dur*SR); out=np.zeros((N+3*SR,2))
def lay(p0,p1,t0):                                   # picture [p0,p1) <- track from t0
    i=int(p0*SR); n=int((p1-p0)*SR); s=int((t0-off)*SR); seg=m[max(s,0):max(s,0)+n]; out[i:i+len(seg)]=seg
if a.end_beat is None:
    lay(0,a.dur,a.drop-a.drop_at); fo=int(0.4*SR); out[N-fo:N]*=np.linspace(1,0,fo)[:,None]**2
else:
    lay(0,a.splice,a.drop-a.drop_at); tb=a.end_beat-a.end_at+a.splice; lay(a.splice,a.dur+2,tb)
    i=int(a.splice*SR); xf=int(0.012*SR); r=np.linspace(0,1,xf)[:,None]; s=int((tb-off)*SR)
    out[i-xf:i]=out[i-xf:i]*(1-r)+m[s-xf:s]*r
    te=a.track_end if a.track_end else a.end_beat+0.3
    endB=min(N,int((a.splice+te-tb+off)*SR)); out[endB:]=0
    L=int(2.2*SR); t=np.arange(L)/SR; rs=np.random.default_rng(3)
    src=out[endB-int(0.8*SR):endB].copy(); src*=np.linspace(0,1,len(src))[:,None]**2; n=len(src)+L
    for c in range(2):
        ir=np.convolve(rs.standard_normal(L)*np.exp(-t/0.5),np.ones(8)/8,'same')
        tail=np.fft.irfft(np.fft.rfft(src[:,c],n)*np.fft.rfft(ir,n),n)*a.tail
        s0=endB-len(src); e=min(len(out),s0+n); out[s0:e,c]+=tail[:e-s0]
out=out[:N]; fi=int(0.02*SR); out[:fi]*=np.linspace(0,1,fi)[:,None]; fo=int(0.2*SR); out[-fo:]*=np.linspace(1,0,fo)[:,None]
mix=out*a.music_gain
if a.sfx:
    w=wave.open(a.sfx); sf=np.frombuffer(w.readframes(w.getnframes()),'<i2').reshape(-1,2)/32768
    k=min(N,len(sf)); mix[:k]+=sf[:k]*a.sfx_gain
mix/=max(1,np.abs(mix).max()/0.95)
rms=lambda v:20*np.log10(np.sqrt((v**2).mean())+1e-9)
print('music rms per second:',' '.join(f'{i}:{rms(out[i*SR:(i+1)*SR]):.0f}' for i in range(int(a.dur))))
w=wave.open(a.out,'wb'); w.setnchannels(2); w.setsampwidth(3); w.setframerate(SR)
w.writeframes((mix*8388607).astype('<i4').view(np.uint8).reshape(-1,4)[:,:3].tobytes()); w.close(); print('wrote',a.out)
# A holding track's rights record follows the audio: the mix inherits it, and master.sh reads it.
if not os.path.exists(a.track+'.rights.json') and os.path.basename(a.track).startswith('HOLDING_'):
    json.dump({'status':'holding','licensed':False,'note':'rights record missing; the track is named as a holding track',
               'derived_from':os.path.basename(a.track)},open(a.out+'.rights.json','w'),indent=1); print('rights: holding (by name) ->',a.out+'.rights.json')
if os.path.exists(a.track+'.rights.json'):
    r=json.load(open(a.track+'.rights.json')); r['derived_from']=os.path.basename(a.track)
    json.dump(r,open(a.out+'.rights.json','w'),indent=1); print('rights:',r.get('status'),'->',a.out+'.rights.json')
