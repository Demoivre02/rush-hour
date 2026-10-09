#!/usr/bin/env python3
"""Procedural engine + SFX synthesis. Engine loops are built in the frequency
domain so every loop is sample-exact seamless (no click at the wrap point)."""
import json, math, os, wave, struct
import numpy as np
from scipy import signal as sig

ROOT = os.path.join(os.path.dirname(__file__), "..", "build")
SR   = 44100
LOOP = 1.60                                   # seconds per engine loop

def write_wav(path, x, sr=SR):
    x = np.asarray(x, np.float64)
    peak = np.max(np.abs(x)) or 1.0
    x = np.clip(x/peak*0.92, -1, 1)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with wave.open(path,"wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
        w.writeframes((x*32767).astype("<i2").tobytes())

def softclip(x, k):
    return np.tanh(x*k)/math.tanh(k)

def periodic_noise(N, rng, lo=20, hi=18000, tilt=-1.0):
    """Noise that is exactly periodic over N samples."""
    nb = N//2 + 1
    f  = np.fft.rfftfreq(N, 1/SR)
    mag = np.zeros(nb)
    band = (f >= lo) & (f <= hi)
    mag[band] = (np.maximum(f[band],20)/1000.0) ** tilt
    ph = rng.uniform(0, 2*np.pi, nb)
    spec = mag*np.exp(1j*ph); spec[0] = 0
    return np.fft.irfft(spec, N)

def cfilt(b, a, x):
    """Filter a periodic signal without breaking its periodicity."""
    n = len(x)
    y = sig.lfilter(b, a, np.concatenate([x, x, x]))
    return y[n:2*n]

def cbp(x, lo, hi, order=2):
    b,a = sig.butter(order,[max(20,lo)/(SR/2), min(SR*0.49,hi)/(SR/2)],"band")
    return cfilt(b,a,x)

def reson(f0, q, fs=SR):
    return sig.iirpeak(min(f0, fs*0.45)/(fs/2), q)

# ------------------------------------------------------------------ families
# half : strength of half-order content (V8/V10 rumble)
# even : boost of even harmonics (rotary "brap")
# fmt  : (freq, Q, gain) exhaust/intake formants
# rough: cycle-to-cycle jitter,  noise: broadband level
# turbo/blower: forced-induction tone level
F = {
 "i3":            dict(half=.10, even=.25, tilt=1.05, fmt=[(190,3,1.5),(620,4,.8),(1500,5,.4)], rough=.06, noise=.20, turbo=0,  blower=0,   bright=.9),
 "i4":            dict(half=.05, even=.15, tilt=1.00, fmt=[(210,3,1.4),(700,4,.9),(1900,5,.45)],rough=.04, noise=.20, turbo=0,  blower=0,   bright=1.0),
 "i4_turbo":      dict(half=.05, even=.18, tilt=1.05, fmt=[(190,3,1.5),(640,4,.8),(1700,5,.4)], rough=.05, noise=.26, turbo=.55,blower=0,   bright=.95),
 "i4_sc":         dict(half=.04, even=.14, tilt=.95,  fmt=[(230,3,1.3),(760,4,.9),(2100,5,.5)], rough=.04, noise=.22, turbo=0,  blower=.60, bright=1.05),
 "i4_vtec":       dict(half=.03, even=.10, tilt=.88,  fmt=[(260,3,1.2),(900,4,1.0),(2600,5,.6)],rough=.03, noise=.18, turbo=0,  blower=0,   bright=1.2),
 "diesel_i4":     dict(half=.14, even=.30, tilt=1.35, fmt=[(120,2.5,1.8),(430,4,.9),(1100,5,.5)],rough=.16,noise=.42, turbo=.35,blower=0,   bright=.7),
 "flat4":         dict(half=.22, even=.34, tilt=1.10, fmt=[(170,2.5,1.7),(560,4,.9),(1600,5,.4)],rough=.09,noise=.24, turbo=0,  blower=0,   bright=.9),
 "i6_turbo":      dict(half=.04, even=.12, tilt=.92,  fmt=[(200,3,1.4),(720,4,1.0),(2200,5,.55)],rough=.03,noise=.24, turbo=.60,blower=0,   bright=1.1),
 "flat6":         dict(half=.16, even=.26, tilt=.90,  fmt=[(200,2.8,1.5),(780,4,1.0),(2500,5,.6)],rough=.06,noise=.24, turbo=0, blower=0,   bright=1.15),
 "flat6_turbo":   dict(half=.14, even=.24, tilt=.98,  fmt=[(185,2.8,1.6),(700,4,.9),(2100,5,.5)],rough=.06,noise=.30, turbo=.65,blower=0,   bright=1.05),
 "v6":            dict(half=.20, even=.22, tilt=1.02, fmt=[(180,3,1.5),(660,4,.9),(1800,5,.45)],rough=.07, noise=.22, turbo=0,  blower=0,   bright=.95),
 "v6_turbo":      dict(half=.18, even=.20, tilt=1.00, fmt=[(175,3,1.5),(640,4,.9),(2000,5,.5)], rough=.06, noise=.28, turbo=.62,blower=0,   bright=1.0),
 "v8":            dict(half=.72, even=.30, tilt=1.12, fmt=[(140,2.2,1.9),(520,3.5,1.0),(1500,5,.5)],rough=.10,noise=.24,turbo=0,blower=0,   bright=.92),
 "v8_sc":         dict(half=.66, even=.28, tilt=1.10, fmt=[(145,2.2,1.9),(540,3.5,1.0),(1600,5,.5)],rough=.09,noise=.26,turbo=0,blower=.75, bright=.98),
 "v8_turbo":      dict(half=.30, even=.20, tilt=1.00, fmt=[(165,2.6,1.7),(600,3.8,1.0),(1900,5,.55)],rough=.06,noise=.30,turbo=.66,blower=0,bright=1.05),
 "v10":           dict(half=.40, even=.18, tilt=.85,  fmt=[(210,3,1.4),(850,4,1.1),(2800,5,.7)], rough=.05, noise=.24, turbo=0,  blower=0,   bright=1.25),
 "v12":           dict(half=.10, even=.14, tilt=.78,  fmt=[(240,3,1.3),(980,4,1.2),(3200,5,.8)], rough=.03, noise=.22, turbo=0,  blower=0,   bright=1.35),
 "v12_turbo":     dict(half=.12, even=.16, tilt=.90,  fmt=[(200,3,1.4),(820,4,1.0),(2600,5,.6)], rough=.04, noise=.28, turbo=.60,blower=0,   bright=1.15),
 "v16_turbo":     dict(half=.16, even=.18, tilt=.95,  fmt=[(160,2.6,1.7),(700,4,1.0),(2400,5,.6)],rough=.04,noise=.30, turbo=.70,blower=0,  bright=1.10),
 "rotary2":       dict(half=.02, even=.62, tilt=.80,  fmt=[(300,3.5,1.1),(1150,4.5,1.1),(3400,5,.75)],rough=.03,noise=.26,turbo=0,blower=0, bright=1.4),
 "rotary2_turbo": dict(half=.02, even=.58, tilt=.86,  fmt=[(280,3.5,1.2),(1050,4.5,1.0),(3000,5,.65)],rough=.04,noise=.32,turbo=.68,blower=0,bright=1.3),
 "rotary4":       dict(half=.02, even=.54, tilt=.74,  fmt=[(330,3.5,1.1),(1300,4.5,1.2),(3800,5,.85)],rough=.02,noise=.24,turbo=0,blower=0, bright=1.5),
}
EVFAM = "electric"

def band_rpms(idle, redline):
    r = redline - idle
    return dict(idle=idle, low=idle+r*0.26, mid=idle+r*0.50,
                high=idle+r*0.74, redline=idle+r*0.97)

# ------------------------------------------------------------ engine loops
def engine_loop(fam, cyl, rpm, load, seed):
    """Frequency-domain build => perfectly seamless loop."""
    rng = np.random.default_rng(seed)
    N   = int(round(SR*LOOP))
    p   = F[fam]
    f0t = rpm/60.0*(cyl/2.0)
    binhz = SR/N
    M   = max(2, int(round(f0t/binhz)));  M += M % 2          # even -> half-order fits
    f0  = M*binhz
    rpm_actual = f0*60.0/(cyl/2.0)

    nb   = N//2+1
    spec = np.zeros(nb, complex)
    kmax = int(min(nb/M - 1, 16000/f0))
    for k in range(1, max(2,kmax)+1):
        a = (1.0/k**p["tilt"]) * (1.0 + p["even"]*(k % 2 == 0))
        a *= (1.0 + 0.55*p["bright"]*math.exp(-((k-3)**2)/18.0))
        a *= (0.55 + 0.45*load)
        b = k*M
        if b < nb: spec[b] = a*np.exp(1j*rng.uniform(0,2*np.pi))
    if p["half"] > 0:                                          # V8/V10 rumble
        for k in range(1, min(13, int(nb/(M/2))-1)):
            if k % 2 == 0: continue
            b = int(k*M/2)
            if 0 < b < nb:
                spec[b] += p["half"]*(1.0/(k**0.85))*np.exp(1j*rng.uniform(0,2*np.pi))
    x = np.fft.irfft(spec, N)

    for fq, q, g in p["fmt"]:                                  # exhaust formants
        b_, a_ = reson(fq*(1.0+0.12*load), q)
        x = x + g*0.55*cfilt(b_, a_, x)
    x /= (np.max(np.abs(x)) or 1)

    # combustion roughness: periodic AM at the firing rate
    ph = 2*np.pi*f0*np.arange(N)/SR
    x *= (1.0 + p["rough"]*(1.4*np.sin(ph) + 0.6*np.sin(2*ph+0.9)))

    nz = periodic_noise(N, rng, 60, 15000, -0.85)
    nz /= (np.max(np.abs(nz)) or 1)
    x = x + nz*p["noise"]*(0.45+0.55*load)

    if p["turbo"] > 0 and load > 0.30:                         # turbo whistle + hiss
        fw = 2600 + 5200*load*(rpm/6500.0)
        Mw = max(2,int(round(fw/binhz)))
        sp = np.zeros(nb, complex)
        for j,(o,g) in enumerate(((1,1.0),(2,0.32),(3,0.12))):
            b = Mw*o
            if b < nb: sp[b] = g*np.exp(1j*rng.uniform(0,2*np.pi))
        wh = np.fft.irfft(sp, N); wh /= (np.max(np.abs(wh)) or 1)
        hs = periodic_noise(N, rng, 3000, 15000, -0.2); hs /= (np.max(np.abs(hs)) or 1)
        x += p["turbo"]*(0.30*wh + 0.16*hs)*(load-0.30)/0.70
    if p["blower"] > 0:                                        # roots blower whine
        fb = rpm/60.0*3.4*2
        Mb = max(2,int(round(fb/binhz)))
        sp = np.zeros(nb, complex)
        for o,g in ((1,1.0),(2,0.45),(3,0.18),(4,0.08)):
            if Mb*o < nb: sp[Mb*o] = g*np.exp(1j*rng.uniform(0,2*np.pi))
        bl = np.fft.irfft(sp, N); bl /= (np.max(np.abs(bl)) or 1)
        x += p["blower"]*0.34*bl*(0.35+0.65*load)

    x = softclip(x/(np.max(np.abs(x)) or 1), 1.3+1.9*load)
    return x, rpm_actual

def ev_loop(rpm, load, seed):
    rng = np.random.default_rng(seed)
    N = int(round(SR*LOOP)); nb = N//2+1; binhz = SR/N
    f = 120 + rpm*0.0455                                   # motor + reduction whine
    Mm = max(2,int(round(f/binhz)))
    spec = np.zeros(nb, complex)
    for o,g in ((1,.55),(2,1.0),(3,.42),(4,.30),(6,.18),(8,.10)):
        if Mm*o < nb: spec[Mm*o] = g*np.exp(1j*rng.uniform(0,2*np.pi))
    Mi = max(2,int(round(8000/binhz)))                     # inverter switching tone
    if Mi < nb: spec[Mi] = 0.22*np.exp(1j*rng.uniform(0,2*np.pi))
    if 2*Mi < nb: spec[2*Mi] = 0.07*np.exp(1j*rng.uniform(0,2*np.pi))
    x = np.fft.irfft(spec, N); x /= (np.max(np.abs(x)) or 1)
    nz = periodic_noise(N, rng, 200, 16000, -0.5); nz /= (np.max(np.abs(nz)) or 1)
    x = x*(0.45+0.55*load) + nz*(0.10+0.18*load)
    b_,a_ = sig.butter(2, min(0.9, (400+rpm*0.35)/(SR/2)), "high")
    x = 0.55*x + 0.45*cfilt(b_,a_,x)
    return softclip(x/(np.max(np.abs(x)) or 1), 1.2), rpm

def sweep(fam, cyl, idle, redline, up=True, dur=2.6, seed=7):
    """Phase-continuous rev sweep (one-shot, not looped)."""
    rng = np.random.default_rng(seed)
    n = int(SR*dur); t = np.arange(n)/SR; u = t/dur
    e = u**0.72 if up else 1-(u**1.5)
    rpm = idle + (redline-idle)*e
    if fam == EVFAM:
        f = 120 + rpm*0.0455
        ph = 2*np.pi*np.cumsum(f)/SR
        x = 0.55*np.sin(ph)+1.0*np.sin(2*ph)+0.4*np.sin(3*ph)+0.25*np.sin(4*ph)
        x += 0.20*np.sin(2*np.pi*8000*t)
        x += 0.16*np.random.default_rng(seed).standard_normal(n)*(0.3+0.7*e)
    else:
        p = F[fam]
        f0 = rpm/60.0*(cyl/2.0)
        ph = 2*np.pi*np.cumsum(f0)/SR
        x = np.zeros(n)
        for k in range(1, 15):
            a = (1.0/k**p["tilt"])*(1.0+p["even"]*(k % 2 == 0))
            a *= (1.0+0.55*p["bright"]*math.exp(-((k-3)**2)/18.0))
            x += a*np.sin(k*ph + rng.uniform(0,2*np.pi))
        if p["half"] > 0:
            for k in (1,3,5,7):
                x += p["half"]*(1/k**0.85)*np.sin(k*ph/2 + rng.uniform(0,2*np.pi))
        for fq,q,g in p["fmt"]:
            b_,a_ = reson(fq,q); x = x + g*0.5*sig.lfilter(b_,a_,x)
        x /= (np.max(np.abs(x)) or 1)
        x *= (1.0+p["rough"]*1.3*np.sin(ph))
        x += rng.standard_normal(n)*p["noise"]*(0.35+0.65*e)*0.5
        if p["turbo"] > 0:
            fw = 2600+6200*e
            x += p["turbo"]*0.28*np.sin(2*np.pi*np.cumsum(fw)/SR)*e**1.6
        if p["blower"] > 0:
            x += p["blower"]*0.30*np.sin(2*np.pi*np.cumsum(rpm/60*6.8)/SR)*(0.3+0.7*e)
    env = np.minimum(1, np.minimum(t/0.02, (dur-t)/0.10))
    x *= env*(0.45+0.55*e)
    return softclip(x/(np.max(np.abs(x)) or 1), 2.0)

def startup(fam, cyl, idle, seed=11):
    rng = np.random.default_rng(seed)
    crank_d, catch_d, settle_d = 0.85, 0.45, 0.75
    n1,n2,n3 = [int(SR*d) for d in (crank_d,catch_d,settle_d)]
    t1 = np.arange(n1)/SR
    if fam == EVFAM:                                # EVs just chime and wake up
        n = int(SR*1.4); t = np.arange(n)/SR
        x = (np.sin(2*np.pi*660*t)*np.exp(-t*6) + 0.7*np.sin(2*np.pi*990*t)*np.exp(-t*5)
             + 0.4*np.sin(2*np.pi*1320*t)*np.exp(-t*4))
        x += 0.10*np.sin(2*np.pi*8000*t)*np.clip((t-0.5)/0.4,0,1)
        return softclip(x/(np.max(np.abs(x)) or 1), 1.5)
    whir = np.sin(2*np.pi*(1450+90*np.sin(2*np.pi*9*t1))*t1)*0.5
    grind = rng.standard_normal(n1)*0.55
    b_,a_ = sig.butter(2,[300/(SR/2), 3600/(SR/2)],"band"); grind = sig.lfilter(b_,a_,grind)
    chug = (np.sin(2*np.pi*9.5*t1) > 0.35).astype(float)
    crank = (whir+grind)*(0.35+0.65*chug)*np.minimum(1,t1/0.05)
    rpm2 = np.concatenate([np.linspace(420, idle*2.15, n2),
                           np.linspace(idle*2.15, idle, n3)])
    p = F[fam]; f0 = rpm2/60.0*(cyl/2.0); ph = 2*np.pi*np.cumsum(f0)/SR
    y = np.zeros(len(rpm2))
    for k in range(1,13):
        y += (1.0/k**p["tilt"])*(1.0+p["even"]*(k%2==0))*np.sin(k*ph+rng.uniform(0,2*np.pi))
    if p["half"] > 0:
        for k in (1,3,5): y += p["half"]*(1/k**0.9)*np.sin(k*ph/2)
    for fq,q,g in p["fmt"]:
        b_,a_ = reson(fq,q); y = y + g*0.5*sig.lfilter(b_,a_,y)
    y /= (np.max(np.abs(y)) or 1)
    y += rng.standard_normal(len(y))*p["noise"]*0.45
    env = np.concatenate([np.linspace(0.25,1.0,n2), np.linspace(1.0,0.62,n3)])
    x = np.concatenate([crank*0.75, y*env])
    x[n1:n1+400] += rng.standard_normal(400)*0.6*np.exp(-np.arange(400)/90)  # catch bark
    return softclip(x/(np.max(np.abs(x)) or 1), 1.9)

# ------------------------------------------------------------------- SFX
def env_ad(n, a, d, p=2.0):
    t = np.arange(n)/SR
    return np.minimum(1, t/max(a,1e-4)) * np.exp(-np.maximum(0,t-a)/max(d,1e-4))**1 * 1.0

def bp(x, lo, hi, order=2):
    b,a = sig.butter(order,[max(20,lo)/(SR/2), min(SR*0.49,hi)/(SR/2)],"band")
    return sig.lfilter(b,a,x)

def make_sfx():
    R = np.random.default_rng(2026); S = {}
    def n_(d): return R.standard_normal(int(SR*d))

    # --- tyres -----------------------------------------------------------
    for name, d, f1, f2 in (("tyre_skid_short",0.55,900,2600),
                            ("tyre_skid_long",2.20,800,2400),
                            ("tyre_chirp",0.16,1400,3400)):
        n = int(SR*d); t = np.arange(n)/SR
        x = bp(n_(d), f1, f2, 3)
        slip = 1.0+0.55*np.sin(2*np.pi*(52+26*np.sin(2*np.pi*1.7*t))*t)
        e = np.minimum(1,t/0.03)*np.exp(-np.maximum(0,t-d*0.55)/(d*0.30))
        S[name] = softclip(x*slip*e, 1.6)
    n = int(SR*1.6)                                    # seamless screech loop
    x = cbp(periodic_noise(n,R,900,2600), 900, 2600, 3)
    t = np.arange(n)/SR
    S["tyre_screech_loop"] = softclip(x*(1+0.5*np.sin(2*np.pi*10*t)), 1.5)
    for name, lo, hi in (("surface_gravel_loop",300,5000),("surface_wet_loop",600,9000)):
        x = cbp(periodic_noise(n,R,lo,hi,-0.4), lo, hi, 2)
        if "gravel" in name:
            g = (R.random(n) > 0.9985).astype(float)
            x = x + cfilt(*sig.butter(2,[1200/(SR/2),8000/(SR/2)],"band"), g)*2.5
        S[name] = x
    S["wind_loop"] = cbp(periodic_noise(n,R,80,4000,-0.9), 80, 3500, 2)

    # --- driveline -------------------------------------------------------
    for name, d, thump, ring in (("gearshift_up",0.13,150,2400),
                                 ("gearshift_down",0.15,120,1900),
                                 ("gearshift_sequential",0.10,190,3100)):
        n = int(SR*d); t = np.arange(n)/SR
        x  = np.sin(2*np.pi*thump*t)*np.exp(-t*70)
        x += 0.8*bp(n_(d), 1200, 7000, 2)*np.exp(-t*95)
        x += 0.35*np.sin(2*np.pi*ring*t)*np.exp(-t*130)
        S[name] = softclip(x, 2.0)
    d=1.30; n=int(SR*d); t=np.arange(n)/SR                    # turbo spool
    f = 1800+7200*(t/d)**1.5
    S["turbo_spool"] = softclip((np.sin(2*np.pi*np.cumsum(f)/SR)*0.75
        + 0.30*np.sin(2*np.pi*np.cumsum(2*f)/SR) + 0.5*bp(n_(d),3000,12000,2))
        * np.minimum(1,t/0.08)*(0.2+0.8*(t/d)**1.8), 1.6)
    for name, d, f_hi in (("turbo_blowoff",0.42,7000),("turbo_flutter",0.55,5200)):
        n=int(SR*d); t=np.arange(n)/SR
        cut = f_hi*np.exp(-t*4.5)+900
        x = bp(n_(d), 700, f_hi, 2)*np.exp(-t*7.5)
        if "flutter" in name:
            x *= (1+0.9*np.sin(2*np.pi*32*t))
        else:
            x += 0.5*np.sin(2*np.pi*np.cumsum(cut)/SR)*np.exp(-t*9)
        S[name] = softclip(x*np.minimum(1,t/0.006), 1.8)
    for name, d, lo in (("backfire_pop",0.20,90),("exhaust_crackle",0.75,110)):
        n=int(SR*d); t=np.arange(n)/SR
        if "crackle" in name:
            hits=(R.random(n)>0.9965).astype(float)
            x = sig.lfilter(*sig.butter(2,[200/(SR/2),6000/(SR/2)],"band"), hits)*4
            x += np.sin(2*np.pi*lo*t)*hits.cumsum()*0
        else:
            x = np.sin(2*np.pi*lo*t)*np.exp(-t*38) + 1.2*bp(n_(d),400,9000,2)*np.exp(-t*46)
        S[name] = softclip(x, 2.2)
    d=0.30;n=int(SR*d);t=np.arange(n)/SR                       # rev limiter chop
    S["rev_limiter"] = softclip((bp(n_(d),150,4000,2)+np.sin(2*np.pi*220*t))
                                *((np.sin(2*np.pi*26*t)>0).astype(float))*np.minimum(1,t/0.01),2.0)
    d=0.70;n=int(SR*d);t=np.arange(n)/SR                       # brake squeal
    S["brake_squeal"] = softclip((0.8*np.sin(2*np.pi*(3100+80*np.sin(2*np.pi*7*t))*t)
        + 0.3*np.sin(2*np.pi*4700*t) + 0.35*bp(n_(d),2000,9000,2))
        * np.minimum(1,t/0.05)*np.exp(-np.maximum(0,t-0.35)/0.16), 1.5)

    # --- impacts ---------------------------------------------------------
    for name, d, low, amp in (("collision_light",0.45,140,0.6),
                              ("collision_medium",0.85,95,0.85),
                              ("collision_heavy",1.50,62,1.0)):
        n=int(SR*d); t=np.arange(n)/SR
        x  = amp*np.sin(2*np.pi*low*np.exp(-t*2.5)*t)*np.exp(-t*7)
        x += 0.9*bp(n_(d), 200, 6000, 2)*np.exp(-t*11)
        x += 0.55*bp(n_(d), 2500, 12000, 2)*np.exp(-t*26)
        deb=(R.random(n)>0.997).astype(float)*np.exp(-t*2.2)
        x += 0.8*bp(deb,1500,9000,2)*6
        S[name]=softclip(x,2.4)
    n=int(SR*1.6)
    S["scrape_loop"]=softclip(cbp(periodic_noise(n,R,700,9000,-0.3),700,9000,2)*
                              (1+0.6*np.sin(2*np.pi*37*np.arange(n)/SR)),1.7)

    # --- nitrous ---------------------------------------------------------
    d=0.9;n=int(SR*d);t=np.arange(n)/SR
    S["nitro_activate"]=softclip((bp(n_(d),400,11000,2)*np.minimum(1,t/0.04)*np.exp(-t*3.0)
        + 0.5*np.sin(2*np.pi*np.cumsum(np.linspace(140,60,n))/SR)*np.exp(-t*4)),1.8)
    n=int(SR*1.6)
    S["nitro_loop"]=softclip(cbp(periodic_noise(n,R,500,12000,-0.35),500,12000,2)*1.2,1.6)

    # --- horns -----------------------------------------------------------
    def horn(d, freqs, saw=True):
        n=int(SR*d); t=np.arange(n)/SR; x=np.zeros(n)
        for f0 in freqs:
            vib = f0*(1+0.004*np.sin(2*np.pi*5.5*t))
            ph = 2*np.pi*np.cumsum(vib)/SR
            x += (sig.sawtooth(ph)*0.6 + np.sin(ph)*0.5) if saw else np.sin(ph)
        e = np.minimum(1,t/0.02)*np.minimum(1,(d-t)/0.05)
        return softclip(bp(x*e, 180, 7000, 2), 1.7)
    S["horn_a"]=horn(0.60,[440,554.4]); S["horn_b"]=horn(0.75,[349.2,440,523.3])
    S["horn_air"]=horn(1.10,[196,247,294])

    # --- race flow / UI --------------------------------------------------
    def beep(d,f,dec=8.0,harm=(1,.35,.12)):
        n=int(SR*d); t=np.arange(n)/SR
        x=sum(g*np.sin(2*np.pi*f*k*t) for k,g in zip((1,2,3),harm))
        return x*np.minimum(1,t/0.005)*np.exp(-t*dec)
    S["countdown_beep"]=beep(0.40,880); S["countdown_go"]=beep(0.95,1318.5,4.0)
    S["ui_select"]=beep(0.10,1200,26); S["ui_confirm"]=np.concatenate([beep(0.09,880,26),beep(0.20,1318.5,14)])
    S["ui_back"]=beep(0.14,520,20);    S["ui_error"]=np.concatenate([beep(0.10,320,24),beep(0.18,240,16)])
    S["checkpoint"]=np.concatenate([beep(0.09,1046.5,26),beep(0.24,1568,10)])
    S["lap_complete"]=np.concatenate([beep(0.10,784,24),beep(0.10,1046.5,24),beep(0.35,1318.5,7)])
    S["race_finish"]=np.concatenate([beep(0.12,523.3,20),beep(0.12,659.3,20),
                                     beep(0.12,784,20),beep(0.75,1046.5,3.2)])
    return S

# ------------------------------------------------------------------- main
def main():
    db = json.load(open(os.path.join(ROOT,"cars.json")))
    fams = {}
    for code, meta in db["engine_families"].items():
        fams[meta_fam(code)] = meta if False else fams.get(meta_fam(code), meta)
    manifest = dict(sample_rate=SR, loop_seconds=LOOP,
                    note=("Engine loops are seamless. Pitch-shift a loop by "
                          "target_rpm / rpm to cover the range between bands, and "
                          "cross-fade between adjacent bands."),
                    engines={}, sfx={})
    for code, meta in db["engine_families"].items():
        fam = code if code in F or code == EVFAM else code
        bands = band_rpms(meta["idle_rpm"] or 900, meta["redline_rpm"])
        entry = dict(label=meta["label"], cylinders=meta["cylinders"],
                     idle_rpm=meta["idle_rpm"], redline_rpm=meta["redline_rpm"], loops={})
        for bi,(bname, rpm) in enumerate(bands.items()):
            load = [0.10,0.35,0.55,0.80,1.00][bi]
            if fam == EVFAM:
                x, rpm_a = ev_loop(rpm, load, 900+bi)
            else:
                x, rpm_a = engine_loop(fam, meta["cylinders"] or 4, rpm, load, hash(fam)%9999+bi)
            rel = f"engines/{fam}/{fam}_{bname}.wav"
            write_wav(os.path.join(ROOT,"audio",rel), x)
            entry["loops"][bname] = dict(file=rel, rpm=round(rpm_a,1), load=load, seamless=True)
        for nm, gen in (("rev", lambda: sweep(fam, meta["cylinders"] or 4,
                                              meta["idle_rpm"] or 900, meta["redline_rpm"], True)),
                        ("decel", lambda: sweep(fam, meta["cylinders"] or 4,
                                                meta["idle_rpm"] or 900, meta["redline_rpm"], False, 2.0)),
                        ("start", lambda: startup(fam, meta["cylinders"] or 4, meta["idle_rpm"] or 900))):
            rel = f"engines/{fam}/{fam}_{nm}.wav"
            write_wav(os.path.join(ROOT,"audio",rel), gen())
            entry[nm] = rel
        manifest["engines"][fam] = entry
        print("  engine:", fam)

    for name, x in make_sfx().items():
        rel = f"sfx/{name}.wav"
        write_wav(os.path.join(ROOT,"audio",rel), x)
        manifest["sfx"][name] = dict(file=rel, seconds=round(len(x)/SR,3),
                                     loop=name.endswith("_loop"))
    json.dump(manifest, open(os.path.join(ROOT,"audio","audio_manifest.json"),"w"), indent=2)
    print("engines:", len(manifest["engines"]), " sfx:", len(manifest["sfx"]))

def meta_fam(c): return c
main()
