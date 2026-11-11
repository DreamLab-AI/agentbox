#!/usr/bin/env python3
# sfx.py - synthesize a non-tonal SFX stem from a hit list, so it sits on top of any music key.
#   python3 sfx.py events.json out.wav [--dur 15 --fps 60]
# events.json: [{"t": 2.0, "type": "impact", "gain": 1.0}, {"t": 9.0, "type": "riser", "len": 1.0}, ...]
# types: impact (big hit), thump (bounce / landing, "f" = Hz), whoosh (fast pass, "len"),
#        riser (noise sweep up that ENDS at t+len, put an impact there), fall (sweep down, "len").
# t is the PICTURE time of the event; every sound lands 1 frame later.
import numpy as np, wave, json, sys, argparse
ap=argparse.ArgumentParser(); ap.add_argument('events'); ap.add_argument('out')
ap.add_argument('--dur',type=float,default=15); ap.add_argument('--fps',type=float,default=60); a=ap.parse_args()
SR=48000; N=int(a.dur*SR); OFF=1/a.fps; buf=np.zeros((N+2*SR,2)); rs=np.random.default_rng(7)
tt=lambda d: np.arange(int(d*SR))/SR
def sweep(f0,f1,d,tau):
    t=tt(d); f=f1+(f0-f1)*np.exp(-t/tau); return np.cos(2*np.pi*np.cumsum(f)/SR-2*np.pi*f[0]/SR)
def lp(x,k): return np.convolve(x,np.ones(k)/k,'same')
def svf(d,f0,f1,q=3.0,curve=1.0):
    n=rs.standard_normal(int(d*SR)); u=np.arange(len(n))/len(n); fc=f0*(f1/f0)**(u**curve); lo=bp=0.0; o=np.empty_like(n)
    for i in range(len(n)):
        f=2*np.sin(np.pi*min(fc[i],SR/6.5)/SR); hi=n[i]-lo-bp/q; bp+=f*hi; lo+=f*bp; o[i]=bp
    return o
def impact(e):
    d=e.get('len',0.9); t=tt(d)
    return sweep(140,38,d,0.06)*np.exp(-t/0.28)+0.6*sweep(420,110,d,0.05)*np.exp(-t/0.12)+0.7*lp(rs.standard_normal(len(t)),6)*np.exp(-t/0.09)+0.6*np.exp(-t/0.002)
def thump(e):
    f=e.get('f',110); d=e.get('len',0.3); t=tt(d); return sweep(f*2.2,f,d,0.03)*np.exp(-t/(d*0.3))+0.3*np.sin(2*np.pi*f*3*t)*np.exp(-t/0.03)
def whoosh(e):
    d=e.get('len',0.4); w=svf(d,300,3500,2.5,0.5); return w*np.hanning(len(w))*0.45
def riser(e):
    d=e.get('len',1.0); w=svf(d,400,7000,3,2.0); return w*np.linspace(0,1,len(w))**2*0.55
def fall(e):
    d=e.get('len',0.5); w=svf(d,5000,250,4,0.8); return w*np.exp(-tt(d)/(d*0.6))*0.4
GEN={'impact':impact,'thump':thump,'whoosh':whoosh,'riser':riser,'fall':fall}
for e in json.load(open(a.events)):
    s=GEN[e['type']](e)*e.get('gain',1.0); pan=e.get('pan',0.0); i=int(round((e['t']+OFF)*SR)); n=min(len(s),len(buf)-i)
    if n<=0: continue   # the event starts after the end of the film
    buf[i:i+n,0]+=s[:n]*(1-max(0,pan)); buf[i:i+n,1]+=s[:n]*(1+min(0,pan))
x=buf[:N]; x-=x.mean(0); x=np.tanh(x*0.9); x*=0.7/max(1e-9,np.abs(x).max())
w=wave.open(a.out,'wb'); w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes((x*32767).astype('<i2').tobytes()); w.close()
print('wrote',a.out)
