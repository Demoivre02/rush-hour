#!/usr/bin/env python3
"""Procedural top-down car sprite renderer. Every car is drawn from its own
body profile, dimensions, colour and livery at a constant 56 px/metre so all
100 sprites are correctly sized relative to one another."""
import json, math, os, random
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.join(os.path.dirname(__file__), "..", "build")
SS   = 4                      # supersample factor
CW, CH = 200, 384             # final canvas
PPM  = 56                     # pixels per metre (final)
W, H = CW*SS, CH*SS
PPMS = PPM*SS

# half-width fraction along the body length (t: 0 = nose, 1 = tail)
PROFILE = {
 "city":     [(0,.54),(.04,.74),(.10,.90),(.18,.98),(.25,1.0),(.40,.96),(.55,.95),(.68,.97),(.80,1.0),(.89,.98),(.96,.86),(1,.64)],
 "hatch":    [(0,.54),(.03,.72),(.09,.89),(.17,.98),(.25,1.0),(.38,.95),(.52,.93),(.66,.95),(.78,1.0),(.88,.99),(.96,.90),(1,.68)],
 "sedan":    [(0,.52),(.03,.70),(.09,.88),(.16,.97),(.24,1.0),(.36,.96),(.50,.92),(.62,.93),(.74,.97),(.84,1.0),(.92,.95),(.97,.83),(1,.60)],
 "wagon":    [(0,.52),(.03,.70),(.09,.88),(.16,.97),(.24,1.0),(.38,.96),(.52,.94),(.66,.95),(.78,.99),(.88,1.0),(.95,.98),(1,.80)],
 "coupe":    [(0,.48),(.03,.68),(.09,.87),(.17,.97),(.25,1.0),(.38,.94),(.52,.90),(.64,.92),(.76,.98),(.85,1.0),(.93,.94),(.98,.80),(1,.56)],
 "roadster": [(0,.46),(.04,.68),(.11,.88),(.19,.98),(.27,1.0),(.42,.92),(.56,.90),(.68,.94),(.80,1.0),(.89,.97),(.96,.85),(1,.58)],
 "muscle":   [(0,.66),(.04,.84),(.10,.96),(.17,1.0),(.26,1.0),(.40,.95),(.54,.94),(.68,.96),(.80,1.0),(.90,.99),(.96,.92),(1,.72)],
 "pony":     [(0,.62),(.04,.82),(.10,.95),(.17,1.0),(.26,1.0),(.40,.94),(.55,.93),(.69,.96),(.80,1.0),(.90,.97),(.96,.89),(1,.68)],
 "suv":      [(0,.70),(.03,.86),(.09,.96),(.16,1.0),(.28,1.0),(.50,.98),(.72,1.0),(.86,1.0),(.94,.96),(1,.78)],
 "pickup":   [(0,.68),(.03,.86),(.09,.97),(.16,1.0),(.26,1.0),(.34,.94),(.44,.92),(.52,.98),(.58,1.0),(.90,1.0),(.97,.98),(1,.86)],
 "rally":    [(0,.56),(.03,.74),(.09,.90),(.16,1.0),(.25,1.0),(.38,.93),(.52,.92),(.66,.95),(.78,1.0),(.88,.99),(.96,.90),(1,.70)],
 "gt":       [(0,.50),(.03,.70),(.09,.88),(.17,.98),(.26,1.0),(.40,.93),(.54,.92),(.66,.95),(.78,1.0),(.87,1.0),(.94,.93),(.98,.80),(1,.58)],
 "supercar": [(0,.56),(.03,.76),(.09,.92),(.15,.97),(.21,.97),(.32,.86),(.44,.85),(.56,.92),(.68,.99),(.80,1.0),(.90,.99),(.96,.90),(1,.66)],
 "hypercar": [(0,.60),(.03,.80),(.08,.94),(.14,.98),(.20,.98),(.31,.85),(.43,.85),(.56,.94),(.68,1.0),(.80,1.0),(.90,.99),(.96,.92),(1,.70)],
 "trackcar": [(0,.52),(.03,.74),(.08,.94),(.14,1.0),(.21,1.0),(.31,.78),(.42,.78),(.55,.94),(.66,1.0),(.76,1.0),(.87,.97),(.95,.88),(1,.62)],
}
# cabin: (hood_end, roof_front, roof_rear, glass_end), axles: (front_t, rear_t), rear engine bay?
SPEC = {
 "city":     dict(cab=(.26,.40,.70,.84), ax=(.19,.83), mid=False, wheel=(.60,.19)),
 "hatch":    dict(cab=(.28,.42,.70,.82), ax=(.20,.82), mid=False, wheel=(.63,.21)),
 "sedan":    dict(cab=(.30,.44,.66,.78), ax=(.21,.79), mid=False, wheel=(.66,.22)),
 "wagon":    dict(cab=(.30,.44,.78,.88), ax=(.21,.80), mid=False, wheel=(.66,.22)),
 "coupe":    dict(cab=(.32,.47,.63,.75), ax=(.22,.80), mid=False, wheel=(.66,.23)),
 "roadster": dict(cab=(.38,.50,.60,.68), ax=(.22,.80), mid=False, wheel=(.62,.21)),
 "muscle":   dict(cab=(.35,.50,.68,.80), ax=(.20,.81), mid=False, wheel=(.70,.27)),
 "pony":     dict(cab=(.34,.49,.67,.79), ax=(.20,.81), mid=False, wheel=(.70,.27)),
 "suv":      dict(cab=(.26,.38,.72,.85), ax=(.19,.83), mid=False, wheel=(.76,.26)),
 "pickup":   dict(cab=(.26,.38,.50,.57), ax=(.17,.85), mid=False, wheel=(.80,.28)),
 "rally":    dict(cab=(.28,.42,.70,.82), ax=(.20,.82), mid=False, wheel=(.66,.23)),
 "gt":       dict(cab=(.31,.45,.63,.75), ax=(.21,.81), mid=False, wheel=(.68,.26)),
 "supercar": dict(cab=(.23,.36,.51,.61), ax=(.20,.82), mid=True,  wheel=(.68,.29)),
 "hypercar": dict(cab=(.21,.34,.48,.58), ax=(.19,.83), mid=True,  wheel=(.70,.31)),
 "trackcar": dict(cab=(.23,.35,.49,.59), ax=(.21,.81), mid=True,  wheel=(.68,.30)),
}

def hex2rgb(h):
    h = h.lstrip("#"); return tuple(int(h[i:i+2],16) for i in (0,2,4))
def mix(a,b,t):
    return tuple(int(round(a[i]+(b[i]-a[i])*t)) for i in range(3))
def clampc(c):
    return tuple(max(0,min(255,int(round(v)))) for v in c)
def scale(c,f):
    return clampc([v*f for v in c])
def lum(c):
    return (0.299*c[0]+0.587*c[1]+0.114*c[2])/255.0

def halfwidths(body, n, hw_max):
    pts = PROFILE[body]
    ts  = np.array([p[0] for p in pts]); vs = np.array([p[1] for p in pts])
    t   = np.linspace(0,1,n)
    v   = np.interp(t, ts, vs)
    k   = max(3, n//60) | 1                       # smooth the corners
    ker = np.ones(k)/k
    v   = np.convolve(np.pad(v,(k//2,k//2),mode="edge"), ker, mode="valid")
    return v*hw_max

def render(car, font_small=None):
    rng   = random.Random(car["seed"])
    body  = car["body_type"]
    spec  = SPEC[body]
    Lm, Wm = car["dimensions"]["length_m"], car["dimensions"]["width_m"]
    Lp, hw_max = Lm*PPMS, Wm*PPMS/2.0
    y0    = (H - Lp)/2.0
    cx    = W/2.0
    N     = int(Lp)
    hw    = halfwidths(body, N, hw_max)
    ys    = y0 + np.arange(N)

    prim  = hex2rgb(car["visual"]["primary_color"])
    acc   = hex2rgb(car["visual"]["accent_color"])
    if abs(lum(prim)-lum(acc)) < 0.18:            # keep livery readable
        acc = (245,246,248) if lum(prim) < 0.5 else (24,27,31)
    dark  = lum(prim) < 0.42

    img  = Image.new("RGBA",(W,H),(0,0,0,0))
    dr   = ImageDraw.Draw(img,"RGBA")

    # ---- body silhouette mask -------------------------------------------
    poly = [(cx+hw[i], ys[i]) for i in range(N)] + [(cx-hw[i], ys[i]) for i in range(N-1,-1,-1)]
    mask = Image.new("L",(W,H),0)
    ImageDraw.Draw(mask).polygon(poly, fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(SS*0.45))
    mask = mask.point(lambda v: 255 if v > 118 else 0).filter(ImageFilter.GaussianBlur(SS*0.35))

    # ---- ground shadow ---------------------------------------------------
    sh = Image.new("L",(W,H),0)
    ImageDraw.Draw(sh).polygon([(x+SS*2.5, y+SS*4) for x,y in poly], fill=185)
    sh = sh.filter(ImageFilter.GaussianBlur(SS*3.0))
    shadow = Image.new("RGBA",(W,H),(0,0,0,0)); shadow.putalpha(sh)

    # ---- wheels (drawn under the body) ----------------------------------
    wl = Image.new("RGBA",(W,H),(0,0,0,0)); wd = ImageDraw.Draw(wl,"RGBA")
    wdia, wwid = spec["wheel"][0]*PPMS, spec["wheel"][1]*PPMS
    if car["tier"] in ("super","hyper"): wdia*=1.05; wwid*=1.16
    proud = 1.16 if body in ("trackcar","supercar","hypercar") else 1.13
    rim = (198,202,208) if not dark else (172,178,186)
    arches = []
    for t_ax, rear in ((spec["ax"][0],False),(spec["ax"][1],True)):
        i = min(N-1,max(0,int(t_ax*N)))
        yc = ys[i]; outer = hw[i]*proud
        w = wwid*(1.14 if rear and car["tier"] in ("super","hyper","tuned") else 1.0)
        arches.append((yc, wdia))
        for sgn_ in (-1,1):
            x1 = cx + sgn_*outer; x0 = x1 - sgn_*w
            box = [min(x0,x1), yc-wdia/2, max(x0,x1), yc+wdia/2]
            wd.rounded_rectangle([box[0]-SS*1.2,box[1]-SS*1.2,box[2]+SS*1.2,box[3]+SS*1.2],
                                 radius=SS*4.5, fill=(8,9,11,150))
            wd.rounded_rectangle(box, radius=SS*3.5, fill=(28,29,32,255))
            inb = [box[0]+w*0.26, box[1]+wdia*0.19, box[2]-w*0.26, box[3]-wdia*0.19]
            wd.rounded_rectangle(inb, radius=SS*2.5, fill=rim+(255,))
            wd.rounded_rectangle([inb[0]+w*.13, inb[1]+wdia*.07, inb[2]-w*.13, inb[3]-wdia*.07],
                                 radius=SS*2, fill=(56,60,66,255))
    img.alpha_composite(wl)

    # ---- shaded body -----------------------------------------------------
    yy, xx = np.mgrid[0:H,0:W].astype(np.float32)
    hwmap = np.zeros(H, np.float32); hwmap[int(y0):int(y0)+N] = hw[:max(0,min(N,H-int(y0)))]
    hwmap = np.maximum(hwmap, 1e-3)
    u = np.abs(xx - cx) / hwmap[:,None]                      # 0 centre .. 1 edge
    sgn = np.sign(xx - cx)
    tlong = np.clip((yy - y0)/max(Lp,1), 0, 1)
    shade  = 1.06 - 0.62*np.clip(u,0,1.2)**2.3               # crown roll-off
    shade += 0.055*(1.0 - tlong)                             # nose catches light
    shade -= 0.045*sgn*np.clip(u,0,1)                        # key light upper-left
    spec_band = 0.30*np.exp(-((u-0.30)**2)/(2*0.075**2)) * (sgn<0)
    spec_band+= 0.13*np.exp(-((u-0.42)**2)/(2*0.090**2)) * (sgn>0)
    shade = np.clip(shade + spec_band, 0.22, 1.62)
    base = np.array(prim, np.float32)
    rgb  = np.clip(base[None,None,:]*shade[...,None], 0, 255)
    hi   = np.clip((shade-1.0)*1.4, 0, 1)[...,None]
    rgb  = np.clip(rgb*(1-hi*0.55) + 255*hi*0.55, 0, 255)     # white-ish speculars
    bodyimg = Image.fromarray(rgb.astype(np.uint8),"RGB").convert("RGBA")
    bodyimg.putalpha(mask)

    # ---- livery (clipped to body) ---------------------------------------
    liv = Image.new("RGBA",(W,H),(0,0,0,0)); ld = ImageDraw.Draw(liv,"RGBA")
    L = car["visual"]["livery"]; num = 1 + car["seed"] % 98
    def yat(t): return y0 + t*Lp
    if L == "stripe_center":
        w = hw_max*0.30
        ld.rectangle([cx-w, y0-10, cx+w, y0+Lp+10], fill=acc+(232,))
        ld.rectangle([cx-w*0.30, y0-10, cx+w*0.30, y0+Lp+10], fill=scale(prim,0.85)+(160,))
    elif L == "stripe_dual":
        w, off = hw_max*0.13, hw_max*0.30
        for s in (-1,1):
            ld.rectangle([cx+s*off-w, y0-10, cx+s*off+w, y0+Lp+10], fill=acc+(235,))
    elif L == "two_tone":
        ld.rectangle([0, y0-10, W, yat(spec["cab"][0])], fill=acc+(225,))
    elif L == "racing_split":
        ld.polygon([(cx-hw_max*1.4, yat(0.30)),(cx+hw_max*1.4, yat(0.14)),
                    (cx+hw_max*1.4, yat(0.42)),(cx-hw_max*1.4, yat(0.58))], fill=acc+(228,))
        ld.polygon([(cx-hw_max*1.4, yat(0.66)),(cx+hw_max*1.4, yat(0.50)),
                    (cx+hw_max*1.4, yat(0.60)),(cx-hw_max*1.4, yat(0.76))],
                   fill=scale(acc,0.55)+(200,))
    elif L == "rally":
        ld.rectangle([0, yat(0.36), W, yat(0.52)], fill=acc+(230,))
        ld.rectangle([0, yat(0.52), W, yat(0.58)], fill=scale(acc,0.6)+(215,))
        ld.rectangle([0, yat(0.14), W, yat(0.22)], fill=acc+(180,))
    if L in ("racing_split","rally") and font_small:
        for s in (-1,1):
            ld.ellipse([cx+s*hw_max*0.52-SS*13, yat(0.50)-SS*13,
                        cx+s*hw_max*0.52+SS*13, yat(0.50)+SS*13], fill=(248,249,250,235))
            ld.text((cx+s*hw_max*0.52, yat(0.50)), str(num), font=font_small,
                    fill=(22,24,28,255), anchor="mm")
    liv.putalpha(Image.fromarray(
        (np.array(liv.getchannel("A"),np.float32)*np.array(mask,np.float32)/255).astype(np.uint8)))
    bodyimg.alpha_composite(liv)

    d = ImageDraw.Draw(bodyimg,"RGBA")
    hood_e, roof_f, roof_r, glass_e = spec["cab"]
    def hwat(t): return float(hw[min(N-1,max(0,int(t*N)))])

    # ---- panel shutlines --------------------------------------------------
    shut = (0,0,0,58)
    for t in (hood_e, glass_e):
        d.line([(cx-hwat(t)*0.94, yat(t)),(cx+hwat(t)*0.94, yat(t))], fill=shut, width=SS)
    for s in (-1,1):
        d.line([(cx+s*hwat(roof_f)*0.90, yat(roof_f)),(cx+s*hwat(roof_r)*0.90, yat(roof_r))],
               fill=shut, width=SS)

    # ---- glasshouse -------------------------------------------------------
    glass = (18,24,32)
    def gh(t, f):  return cx - hwat(t)*f, cx + hwat(t)*f
    if body == "roadster":
        l,r = gh(roof_f,.76); l2,r2 = gh(glass_e,.70)
        d.polygon([(l,yat(roof_f)),(r,yat(roof_f)),(r2,yat(glass_e)),(l2,yat(glass_e))],
                  fill=(34,36,40,255))
        for sgn_ in (-1,1):
            d.rounded_rectangle([cx+sgn_*hwat(.55)*.34-SS*7, yat(.545),
                                 cx+sgn_*hwat(.55)*.34+SS*7, yat(.635)],
                                radius=SS*3, fill=(58,62,68,255))
            d.ellipse([cx+sgn_*hwat(.66)*.36-SS*6, yat(.655)-SS*6,
                       cx+sgn_*hwat(.66)*.36+SS*6, yat(.655)+SS*6], fill=(152,157,164,255))
        la,ra = gh(hood_e,.62); lb,rb = gh(roof_f,.76)
        d.polygon([(la,yat(hood_e+.015)),(ra,yat(hood_e+.015)),(rb,yat(roof_f)),(lb,yat(roof_f))],
                  fill=glass+(225,))
    else:
        pts, back = [], []
        for t,f in ((hood_e,.66),(hood_e+(roof_f-hood_e)*.55,.80),(roof_f,.87),
                    (roof_r,.87),(roof_r+(glass_e-roof_r)*.5,.82),(glass_e,.66)):
            l,r = gh(t,f); pts.append((r,yat(t))); back.append((l,yat(t)))
        d.polygon(pts+back[::-1], fill=glass+(252,))
        rp, rb2 = [], []
        for t,f in ((roof_f,.60),(roof_f+(roof_r-roof_f)*.28,.745),
                    (roof_f+(roof_r-roof_f)*.74,.755),(roof_r,.62)):
            l,r = gh(t,f); rp.append((r,yat(t))); rb2.append((l,yat(t)))
        d.polygon(rp+rb2[::-1], fill=scale(prim,0.93)+(255,))
        l,r = gh(roof_f,.60); l2,r2 = gh(roof_f+(roof_r-roof_f)*.28,.745)
        d.line([(l+SS*2,yat(roof_f)),(l2+SS*2,yat(roof_f+(roof_r-roof_f)*.30))],
               fill=(255,255,255,46), width=SS*2)
        tw = hood_e+(roof_f-hood_e)*0.42
        lw,rw = gh(tw,.72)
        d.line([(lw+ (rw-lw)*0.10, yat(tw)),(lw+(rw-lw)*0.34, yat(tw+(roof_f-tw)*0.85))],
               fill=(96,116,140,150), width=SS*3)
    # ---- rear deck: engine bay or boot ------------------------------------
    if spec["mid"]:
        t1, t2 = glass_e+0.03, 0.855
        bw = hwat(.70)*.62
        d.rounded_rectangle([cx-bw-SS*2, yat(t1)-SS*2, cx+bw+SS*2, yat(t2)+SS*2],
                            radius=SS*6, fill=scale(prim,0.78)+(255,))
        d.rounded_rectangle([cx-bw, yat(t1), cx+bw, yat(t2)], radius=SS*5,
                            fill=(34,37,42,245))
        for k in range(5):
            yv = yat(t1) + (yat(t2)-yat(t1))*(0.15+0.70*k/4)
            d.rounded_rectangle([cx-bw*.72, yv-SS*1.6, cx+bw*.72, yv+SS*1.6],
                                radius=SS*2, fill=(112,120,130,225))
        d.rounded_rectangle([cx-hwat(.29)*.40, yat(.115), cx+hwat(.29)*.40, yat(.205)],
                            radius=SS*4, fill=scale(prim,0.83)+(255,))
        for sgn_ in (-1,1):                       # side intakes ahead of rear wheels
            d.polygon([(cx+sgn_*hwat(.56)*.92, yat(.545)),(cx+sgn_*hwat(.62)*.99, yat(.60)),
                       (cx+sgn_*hwat(.66)*.99, yat(.685)),(cx+sgn_*hwat(.60)*.90, yat(.66))],
                      fill=(24,26,30,235))
    else:
        d.line([(cx-hwat(.90)*.86, yat(.905)),(cx+hwat(.90)*.86, yat(.905))], fill=shut, width=SS)
    # bonnet vents / scoop
    if car["tier"] in ("tuned","super","hyper") and not spec["mid"]:
        if body in ("muscle","pony") or car["engine"]["cylinders"] >= 8:
            d.rounded_rectangle([cx-hwat(.18)*.34, yat(.13), cx+hwat(.18)*.34, yat(.245)],
                                radius=SS*5, fill=(24,26,30,240))
            d.rounded_rectangle([cx-hwat(.18)*.24, yat(.152), cx+hwat(.18)*.24, yat(.225)],
                                radius=SS*4, fill=(62,66,72,255))
        else:
            for s in (-1,1):
                d.rounded_rectangle([cx+s*hwat(.19)*.52-SS*7, yat(.15),
                                     cx+s*hwat(.19)*.52+SS*7, yat(.235)],
                                    radius=SS*4, fill=(30,33,38,230))
    if body == "pickup":                                    # load bed
        d.rounded_rectangle([cx-hwat(.75)*.86, yat(.60), cx+hwat(.75)*.86, yat(.965)],
                            radius=SS*4, fill=(46,48,52,255))
        d.rounded_rectangle([cx-hwat(.75)*.78, yat(.618), cx+hwat(.75)*.78, yat(.948)],
                            radius=SS*3, fill=(64,67,72,255))
    if body == "suv":                                       # roof rails
        for s in (-1,1):
            d.rounded_rectangle([cx+s*hwat(.55)*.72-SS*3, yat(.40),
                                 cx+s*hwat(.55)*.72+SS*3, yat(.80)],
                                radius=SS*3, fill=(38,40,44,255))

    # ---- mirrors ----------------------------------------------------------
    tm = hood_e + (roof_f-hood_e)*0.72
    for s in (-1,1):
        d.polygon([(cx+s*hwat(tm)*0.97, yat(tm)-SS*3),
                   (cx+s*hwat(tm)*1.20, yat(tm)+SS*1),
                   (cx+s*hwat(tm)*1.17, yat(tm)+SS*6),
                   (cx+s*hwat(tm)*0.97, yat(tm)+SS*5)], fill=scale(prim,0.82)+(255,))

    # ---- lights -----------------------------------------------------------
    hl = (247,245,231)
    for sgn_ in (-1,1):
        d.polygon([(cx+sgn_*hwat(.035)*.42, yat(.016)),(cx+sgn_*hwat(.05)*.86, yat(.030)),
                   (cx+sgn_*hwat(.065)*.82, yat(.058)),(cx+sgn_*hwat(.05)*.40, yat(.046))],
                  fill=hl+(255,))
        d.polygon([(cx+sgn_*hwat(.985)*.36, yat(.975)),(cx+sgn_*hwat(.975)*.84, yat(.962)),
                   (cx+sgn_*hwat(.988)*.80, yat(.988)),(cx+sgn_*hwat(.994)*.34, yat(.994))],
                  fill=(216,44,38,255))
    if car["tier"] in ("super","hyper"):                     # brake-light bar
        d.rounded_rectangle([cx-hwat(.96)*.62, yat(.955), cx+hwat(.96)*.62, yat(.975)],
                            radius=SS*2, fill=(190,34,30,225))

    # ---- aero -------------------------------------------------------------
    if car["visual"]["has_wing"]:
        wy = yat(1.0) - Lp*0.045
        ww = hw_max*(1.20 if car["tier"] in ("super","hyper") else 1.02)
        for s in (-1,1):                                     # uprights
            d.rounded_rectangle([cx+s*ww*0.62-SS*3.5, wy-SS*6, cx+s*ww*0.62+SS*3.5, wy+SS*12],
                                radius=SS*2, fill=(34,36,40,255))
        d.rounded_rectangle([cx-ww, wy-SS*8.5, cx+ww, wy+SS*2.0], radius=SS*3,
                            fill=(28,30,34,255))
        d.rounded_rectangle([cx-ww*0.985, wy-SS*7.2, cx+ww*0.985, wy-SS*2.6], radius=SS*2,
                            fill=(88,93,100,255))
    if car["tier"] in ("super","hyper"):                      # splitter + diffuser
        d.rounded_rectangle([cx-hwat(.02)*1.14, yat(0)-SS*4, cx+hwat(.02)*1.14, yat(.018)],
                            radius=SS*2, fill=(32,34,38,235))
        d.rounded_rectangle([cx-hwat(.99)*.90, yat(.985), cx+hwat(.99)*.90, yat(.998)],
                            radius=SS*2, fill=(30,32,36,235))
    # exhausts
    if car["engine"]["code"] != "electric":
        nex = 2 if car["engine"]["cylinders"] >= 8 else 1
        for k in range(nex):
            for s in (-1,1):
                xo = cx + s*(hwat(.99)*0.44 + k*SS*7)
                d.ellipse([xo-SS*3.2, yat(.996)-SS*5.0, xo+SS*3.2, yat(.996)+SS*0.4],
                          fill=(150,154,160,255))

    # ---- silhouette edge --------------------------------------------------
    edge = mask.filter(ImageFilter.FIND_EDGES).filter(ImageFilter.GaussianBlur(SS*0.5))
    edge = edge.point(lambda v: min(255, int(v*2.1)))
    ol = Image.new("RGBA",(W,H),(10,12,15,255)); ol.putalpha(
        Image.fromarray((np.array(edge,np.float32)*0.62).astype(np.uint8)))
    bodyimg.alpha_composite(ol)
    bodyimg.putalpha(Image.fromarray(np.maximum(np.array(bodyimg.getchannel("A")),
                                                np.array(mask))))
    img.alpha_composite(bodyimg)

    out = Image.alpha_composite(shadow, img).resize((CW,CH), Image.LANCZOS)
    car_only = img.resize((CW,CH), Image.LANCZOS)
    sh_only  = shadow.resize((CW,CH), Image.LANCZOS)
    return out, car_only, sh_only

# ---------------------------------------------------------------- main
def find_font(size):
    for p in ("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
              "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"):
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()

db = json.load(open(os.path.join(ROOT,"cars.json")))
for sub in ("sprites/topdown","sprites/shadow","sprites/thumbs","sprites/atlas"):
    os.makedirs(os.path.join(ROOT,sub), exist_ok=True)

fs = find_font(SS*16)
made = []
for c in db["cars"]:
    comp, car_only, sh_only = render(c, fs)
    car_only.save(os.path.join(ROOT,"sprites/topdown",c["id"]+".png"))
    sh_only.save(os.path.join(ROOT,"sprites/shadow",c["id"]+"_shadow.png"))
    th = comp.copy(); th.thumbnail((128,128), Image.LANCZOS)
    canvas = Image.new("RGBA",(128,128),(0,0,0,0))
    canvas.paste(th, ((128-th.width)//2,(128-th.height)//2)); canvas.save(
        os.path.join(ROOT,"sprites/thumbs",c["id"]+"_thumb.png"))
    made.append((c, comp))
print("sprites:", len(made))

# per-tier atlases + json map
for tier in ("base","tuned","super","hyper"):
    subset = [(c,im) for c,im in made if c["tier"]==tier]
    cols = 6; rows = math.ceil(len(subset)/cols)
    at = Image.new("RGBA",(cols*CW, rows*CH),(0,0,0,0)); frames={}
    for i,(c,im) in enumerate(subset):
        x,y = (i%cols)*CW, (i//cols)*CH
        at.paste(im,(x,y)); frames[c["id"]]=dict(x=x,y=y,w=CW,h=CH)
    at.save(os.path.join(ROOT,"sprites/atlas",f"atlas_{tier}.png"))
    json.dump(dict(image=f"atlas_{tier}.png",frame_w=CW,frame_h=CH,frames=frames),
              open(os.path.join(ROOT,"sprites/atlas",f"atlas_{tier}.json"),"w"), indent=2)

# contact sheet
fnt, fnt2 = find_font(15), find_font(12)
cols = 10; rows = 10; TW,TH = 150,268
sheet = Image.new("RGB",(cols*TW, rows*TH+70),(16,18,22))
sd = ImageDraw.Draw(sheet)
sd.text((24,24), "100-CAR PACK  ·  top-down sprites  ·  base → tuned → supercar → hypercar",
        font=find_font(24), fill=(232,236,240))
COL={"base":(120,132,146),"tuned":(90,180,120),"super":(230,170,60),"hyper":(220,90,110)}
for i,(c,im) in enumerate(made):
    x,y = (i%cols)*TW, 70+(i//cols)*TH
    t = im.copy(); t.thumbnail((TW-14, TH-52), Image.LANCZOS)
    sheet.paste(t,(x+(TW-t.width)//2, y+6), t)
    sd.rectangle([x+8,y+TH-40,x+8+7,y+TH-33], fill=COL[c["tier"]])
    sd.text((x+20,y+TH-42), c["manufacturer"][:16], font=fnt2, fill=(150,156,164))
    sd.text((x+8,y+TH-26), c["model"][:19], font=fnt, fill=(236,239,242))
    sd.text((x+8,y+TH-12), f'{c["performance"]["power_hp"]} hp · PI {c["performance"]["performance_index"]}',
            font=fnt2, fill=(132,140,150))
sheet.save(os.path.join(ROOT,"sprites","contact_sheet.png"))
print("atlases + contact sheet done")
