#!/usr/bin/env python3
"""Build the 100-car database for the racing game. All figures derived from a
consistent physics-ish model so tiers scale monotonically."""
import json, math, hashlib, os, csv

OUT = os.path.join(os.path.dirname(__file__), "..", "build")

# ---------------------------------------------------------------- manufacturers
MANUFACTURERS = {
 "Ishara":   dict(country="Japan",   founded=1948, hq="Nagoya",     ethos="Frugal, feather-light city cars with a cult tuning scene.",       palette=["#E8E9EB","#2F6FB2","#C7382F","#1D2024","#7EC8C0"]),
 "Katsuro":  dict(country="Japan",   founded=1937, hq="Yokohama",   ethos="Mass-market saloons by day, all-wheel-drive giant killers by night.", palette=["#1B4F9C","#C8CDD3","#111418","#D8B12A","#8E2B2B"]),
 "Ryuzaki":  dict(country="Japan",   founded=1961, hq="Hiroshima",  ethos="Rotary obsessives. Light, revvy, and allergic to pistons.",       palette=["#E6E8EA","#B4241E","#F2A03D","#20242A","#2E7D6B"]),
 "Mishima":  dict(country="Japan",   founded=1917, hq="Osaka",      ethos="Heavy industry roots — indestructible trucks and one screaming halo car.", palette=["#2B3138","#8A9099","#6E1F22","#C4C9CE","#3C6E4F"]),
 "Tenjin":   dict(country="Japan",   founded=2009, hq="Fukuoka",    ethos="Electric-only. Silent, instant, unnervingly quick.",              palette=["#F1F3F5","#3AA0D8","#171B20","#7A5CD6","#26C6A8"]),
 "Hanyu":    dict(country="Korea",   founded=1974, hq="Ulsan",      ethos="Value engineering that quietly grew a performance division.",     palette=["#C9CED4","#1F3D7A","#B03030","#20242A","#5FA83F"]),
 "Grauwolf": dict(country="Germany", founded=1926, hq="Munich",     ethos="Precision executive machinery with a straight-six heartbeat.",    palette=["#1E2A47","#D6DAE0","#0F1216","#8C1F27","#6F7B8A"]),
 "Vorst":    dict(country="Germany", founded=1949, hq="Stuttgart",  ethos="Rear-engine heresy, perfected over seventy years of flat sixes.", palette=["#D9DDE1","#1F5FAD","#C0342C","#15181C","#D9A93B"]),
 "Eisenbach":dict(country="Germany", founded=1958, hq="Ingolstadt", ethos="Four-ring engineering: quattro traction and V10 theatrics.",      palette=["#2A2E33","#B9BEC4","#7C1D24","#1A4E86","#E2E5E8"]),
 "Krallmann":dict(country="Germany", founded=1987, hq="Bottrop",    ethos="A tuning house that outgrew its donors and started building its own.", palette=["#0E1013","#3A3F45","#C2A24A","#7B1F1F","#5D6873"]),
 "Alviero":  dict(country="Italy",   founded=1947, hq="Maranello",  ethos="Front-engined V12 grand tourers with racing in the bloodline.",   palette=["#C0181C","#F0E6D2","#141619","#D8B240","#1F3F6E"]),
 "Scorpetti":dict(country="Italy",   founded=1963, hq="Modena",     ethos="Mid-engined, twin-turbo, and unapologetically dramatic.",         palette=["#F0B429","#1B1D21","#B32020","#DDE1E5","#2C5F8A"]),
 "Valdoro":  dict(country="Italy",   founded=1966, hq="Bologna",    ethos="Angular V10 wedges built to intimidate first and corner second.", palette=["#7BC043","#F2F3F4","#171A1E","#E4620F","#3B2E7E"]),
 "Wexler":   dict(country="USA",     founded=1908, hq="Detroit",    ethos="Displacement is the answer. What was the question?",              palette=["#1F4FA0","#C42B24","#EFEFEF","#161A1E","#E39A1D"]),
 "Marlowe":  dict(country="USA",     founded=1953, hq="Dearborn",   ethos="Pony cars, drag strips, and a stubborn love of pushrods.",        palette=["#D93A2B","#1B1E23","#E8EAEC","#2E5FA3","#C9A227"]),
 "Ironvale": dict(country="USA",     founded=1931, hq="Fort Worth", ethos="Trucks and body-on-frame SUVs that treat kerbs as suggestions.",  palette=["#3B4A3A","#8B8378","#1C1F23","#9C3B26","#C6C9CC"]),
 "Apex Dynamics":dict(country="USA", founded=2016, hq="Fremont",    ethos="Quad-motor electric hypercars from a company that was a battery startup.", palette=["#101318","#00B7C7","#E9ECEF","#5B32D6","#B9C0C7"]),
 "Ashcombe": dict(country="UK",      founded=1919, hq="Gaydon",     ethos="Hand-built luxury GTs with a V12 and a stiff upper lip.",         palette=["#0F3B33","#D5D9DD","#151719","#7C1F2E","#B99C5E"]),
 "Thornbury":dict(country="UK",      founded=1955, hq="Norfolk",    ethos="Adds lightness. Removes carpet, radio, doors, and your fillings.", palette=["#F2C230","#0F1215","#1D6E4E","#DDE2E6","#B02A2A"]),
 "Aveline":  dict(country="France",  founded=1919, hq="Sochaux",    ethos="Soft-riding oddballs that turn into rally monsters when provoked.", palette=["#2F6FB2","#EDEFF1","#C4342E","#1A1D21","#E0A93B"]),
 "Norsken":  dict(country="Sweden",  founded=1937, hq="Gothenburg", ethos="Safe estates for the family, megacars for the other side of the garage.", palette=["#1B2A3A","#DCE0E4","#0E1114","#2E7D6B","#C9722C"]),
}

# ---------------------------------------------------------------- body profiles
# length_m, width_m, CdA (m^2), grip mod, brake mod, ride height class
BODIES = {
 "city":     dict(L=3.62, W=1.68, cda=0.72, grip=-0.04, brk=-0.02, seats=4),
 "hatch":    dict(L=4.06, W=1.79, cda=0.71, grip=-0.01, brk=0.00,  seats=5),
 "sedan":    dict(L=4.66, W=1.83, cda=0.66, grip=-0.01, brk=0.00,  seats=5),
 "wagon":    dict(L=4.78, W=1.86, cda=0.70, grip=-0.03, brk=-0.01, seats=5),
 "coupe":    dict(L=4.46, W=1.81, cda=0.63, grip=0.02,  brk=0.01,  seats=4),
 "roadster": dict(L=3.98, W=1.73, cda=0.64, grip=0.03,  brk=0.02,  seats=2),
 "muscle":   dict(L=4.88, W=1.93, cda=0.72, grip=-0.05, brk=-0.02, seats=4),
 "pony":     dict(L=4.79, W=1.91, cda=0.68, grip=-0.03, brk=-0.01, seats=4),
 "suv":      dict(L=4.96, W=1.96, cda=0.92, grip=-0.14, brk=-0.06, seats=7),
 "pickup":   dict(L=5.58, W=2.03, cda=1.05, grip=-0.18, brk=-0.08, seats=5),
 "rally":    dict(L=4.44, W=1.84, cda=0.72, grip=0.05,  brk=0.02,  seats=5),
 "gt":       dict(L=4.72, W=1.95, cda=0.62, grip=0.03,  brk=0.02,  seats=2),
 "supercar": dict(L=4.55, W=1.99, cda=0.61, grip=0.06,  brk=0.04,  seats=2),
 "hypercar": dict(L=4.66, W=2.06, cda=0.60, grip=0.10,  brk=0.06,  seats=2),
 "trackcar": dict(L=4.18, W=1.90, cda=0.78, grip=0.14,  brk=0.08,  seats=2),
}

# ---------------------------------------------------------------- engine archetypes
# cyl = firing pulses per revolution basis, idle/redline rpm, sound family
ENGINES = {
 "i3":            dict(cyl=3,  idle=780, redline=6200, family="i3",            label="Inline-3"),
 "i4":            dict(cyl=4,  idle=800, redline=6800, family="i4",            label="Inline-4"),
 "i4_turbo":      dict(cyl=4,  idle=820, redline=6900, family="i4_turbo",      label="Turbo Inline-4"),
 "i4_sc":         dict(cyl=4,  idle=850, redline=7600, family="i4_sc",         label="Supercharged Inline-4"),
 "i4_vtec":       dict(cyl=4,  idle=880, redline=9000, family="i4_vtec",       label="High-Rev Inline-4"),
 "diesel_i4":     dict(cyl=4,  idle=700, redline=4600, family="diesel_i4",     label="Turbo-Diesel Inline-4"),
 "flat4":         dict(cyl=4,  idle=820, redline=7400, family="flat4",         label="Flat-4"),
 "i6_turbo":      dict(cyl=6,  idle=760, redline=7200, family="i6_turbo",      label="Twin-Turbo Inline-6"),
 "flat6":         dict(cyl=6,  idle=840, redline=8400, family="flat6",         label="Flat-6"),
 "flat6_turbo":   dict(cyl=6,  idle=800, redline=7400, family="flat6_turbo",   label="Twin-Turbo Flat-6"),
 "v6":            dict(cyl=6,  idle=740, redline=6800, family="v6",            label="V6"),
 "v6_turbo":      dict(cyl=6,  idle=780, redline=7600, family="v6_turbo",      label="Twin-Turbo V6"),
 "v8":            dict(cyl=8,  idle=700, redline=7200, family="v8",            label="V8"),
 "v8_sc":         dict(cyl=8,  idle=720, redline=6800, family="v8_sc",         label="Supercharged V8"),
 "v8_turbo":      dict(cyl=8,  idle=740, redline=7600, family="v8_turbo",      label="Twin-Turbo V8"),
 "v10":           dict(cyl=10, idle=900, redline=8700, family="v10",           label="V10"),
 "v12":           dict(cyl=12, idle=880, redline=8900, family="v12",           label="V12"),
 "v12_turbo":     dict(cyl=12, idle=820, redline=7600, family="v12_turbo",     label="Twin-Turbo V12"),
 "v16_turbo":     dict(cyl=16, idle=800, redline=7000, family="v16_turbo",     label="Quad-Turbo W16"),
 "rotary2":       dict(cyl=4,  idle=950, redline=9000, family="rotary2",       label="Twin-Rotor"),
 "rotary2_turbo": dict(cyl=4,  idle=920, redline=8500, family="rotary2_turbo", label="Turbo Twin-Rotor"),
 "rotary4":       dict(cyl=8,  idle=1000,redline=9500, family="rotary4",       label="Quad-Rotor"),
 "electric":      dict(cyl=0,  idle=0,   redline=18000,family="electric",      label="Electric"),
}

TIER_GRIP  = {"base":0.90, "tuned":1.00, "super":1.16, "hyper":1.30}
TIER_TYRE  = {"base":"Street Radial","tuned":"Performance Summer","super":"Semi-Slick","hyper":"Track Cup 2"}
LAUNCH     = {"FWD":1.20, "RWD":1.13, "AWD":1.00, "4WD":1.07}

# ---------------------------------------------------------------- the 100 cars
# (mfr, model, tier, body, engine, hp, torque_nm, kg, drive, year, livery, colorIdx, blurb)
C = [
# ---- BASE (30) -------------------------------------------------------------
("Ishara","Kite","base","city","i3",92,142,950,"FWD",2019,"solid",0,"The cheapest key in the garage. Nine hundred and fifty kilos of pure momentum management."),
("Ishara","Kite RS","base","hatch","i4",138,175,1010,"FWD",2021,"stripe_center",1,"Stiffer springs, a red badge, and the first hint that Ishara has a sense of humour."),
("Ishara","Vela","base","sedan","i4",128,168,1180,"FWD",2018,"solid",2,"A rental-counter special that somehow became a drift-school favourite."),
("Hanyu","Pulse","base","hatch","i4",110,150,1090,"FWD",2020,"solid",0,"Ten-year warranty, zero pretension, surprising cornering manners."),
("Hanyu","Meridian","base","sedan","i4",178,265,1350,"FWD",2022,"two_tone",1,"Hanyu's midsize saloon. Comfortable, quiet, quietly quick."),
("Hanyu","Torro","base","suv","i4_turbo",190,320,1480,"AWD",2023,"solid",3,"A crossover that thinks it's a hot hatch on stilts."),
("Aveline","Bonbon","base","city","i3",84,128,880,"FWD",2017,"two_tone",0,"Three cylinders, four seats, and suspension tuned on cobblestones."),
("Aveline","Cirrus","base","hatch","i4",132,190,1120,"FWD",2021,"solid",1,"Soft, tall-riding, and startlingly composed once you commit to a corner."),
("Aveline","Marais","base","wagon","i4_turbo",165,270,1310,"FWD",2020,"solid",2,"The estate that hauls a family and, with the seats down, a spare engine."),
("Katsuro","Sable","base","sedan","i4",145,190,1230,"FWD",2019,"solid",1,"Katsuro's bread and butter. Ten million sold, one million modified."),
("Katsuro","Sable GT","base","sedan","i4_turbo",205,300,1290,"FWD",2022,"stripe_dual",0,"A factory-warm Sable with a small turbo and a big attitude."),
("Katsuro","Kaido","base","coupe","i4",168,205,1120,"RWD",1998,"two_tone",2,"Rear drive, skinny tyres, and a chassis that made a generation of mountain-pass legends."),
("Katsuro","Ronin 2.0","base","coupe","i4",200,215,1240,"RWD",2023,"solid",0,"Modern Kaido. Same recipe, better brakes, no rust."),
("Ryuzaki","Aki","base","roadster","i4",130,160,960,"RWD",2016,"solid",1,"A folding roof, a slick gearbox, and nothing else to get in the way."),
("Ryuzaki","Kaze RX","base","coupe","rotary2",190,196,1180,"RWD",1993,"stripe_center",0,"Two spinning triangles, nine thousand revs, and a thirst you learn to fund."),
("Mishima","Trail 4","base","pickup","diesel_i4",210,500,1980,"4WD",2021,"solid",0,"Mishima's workhorse. Torque like a tugboat, corners like a wardrobe."),
("Mishima","Ridgeback","base","suv","v6",250,350,2050,"AWD",2022,"two_tone",1,"Seven seats, a locking diff, and no idea it's in a racing game."),
("Grauwolf","Kern 20","base","sedan","i4_turbo",194,300,1470,"RWD",2022,"solid",1,"Rear-drive executive basics. The cheapest way into the Grauwolf chassis."),
("Grauwolf","Kern 25 Touring","base","wagon","i4_turbo",228,350,1560,"AWD",2023,"solid",0,"The wagon that beat sports cars in the wet and carried the dog home after."),
("Vorst","Ceres","base","coupe","flat4",200,320,1220,"RWD",2021,"solid",0,"Mid-engined, flat-four, and the purest steering rack under six figures."),
("Wexler","Coyote","base","pony","v6",245,380,1560,"RWD",2023,"stripe_dual",0,"The V6 rental-spec Coyote. Everyone starts here. Nobody stays."),
("Marlowe","Comet","base","pony","v6",258,390,1600,"RWD",2022,"stripe_center",0,"Marlowe's entry pony car — all the shape, two thirds of the noise."),
("Marlowe","Dart 2.3T","base","coupe","i4_turbo",235,390,1520,"RWD",2021,"solid",1,"A four-cylinder pony car. Purists complained. It out-handled all of them."),
("Ironvale","Sentinel","base","suv","v6",265,390,2280,"4WD",2022,"solid",0,"Body-on-frame, three tonnes of intent, physics be damned."),
("Ironvale","Mule 150","base","pickup","v6",250,400,2150,"4WD",2023,"two_tone",1,"A pickup in a racing game is a statement. Make it."),
("Thornbury","Wren","base","roadster","i4",145,165,720,"RWD",2019,"stripe_dual",0,"Seven hundred and twenty kilograms. No carpet, no radio, no excuses."),
("Norsken","Frost 2.0T","base","wagon","i4_turbo",197,300,1520,"AWD",2021,"solid",0,"Safe, square, all-wheel drive. Deceptively fast on a wet road."),
("Tenjin","Ion","base","hatch","electric",170,290,1450,"FWD",2024,"solid",0,"Silent, instant off the line, and completely uninterested in gears."),
("Tenjin","Ion Dual","base","hatch","electric",245,420,1590,"AWD",2024,"stripe_center",1,"Two motors, one pedal, and traction in places you didn't expect."),
("Ashcombe","Lyre","base","coupe","i4_turbo",232,350,1440,"RWD",2023,"solid",0,"Ashcombe's junior coupe. Leather, wood, and a surprisingly willing chassis."),
# ---- TUNED (30) ------------------------------------------------------------
("Katsuro","Kaido Turbo","tuned","coupe","i4_turbo",340,440,1180,"RWD",2001,"stripe_dual",2,"A big single turbo bolted to a legend. Laggy, violent, adored."),
("Katsuro","Ronin RS","tuned","coupe","i4_turbo",380,470,1290,"AWD",2024,"racing_split",0,"The Ronin with the factory motorsport catalogue emptied into it."),
("Katsuro","Tessen GT","tuned","coupe","i6_turbo",480,600,1560,"AWD",2002,"solid",0,"Twin-turbo straight six, computer-controlled all-wheel drive, folk-hero status."),
("Katsuro","Tessen V-Spec","tuned","coupe","i6_turbo",560,660,1580,"AWD",2004,"stripe_center",1,"Stiffer, wider, angrier. The one on everyone's bedroom wall."),
("Katsuro","Sable STX","tuned","rally","i4_turbo",310,430,1400,"AWD",2006,"rally",0,"Homologation saloon. Gravel-bred, tarmac-capable, permanently sideways."),
("Ryuzaki","Kaze RX Turbo","tuned","coupe","rotary2_turbo",320,390,1250,"RWD",1996,"stripe_center",1,"Boost meets rotary. The tachometer becomes a suggestion."),
("Ryuzaki","Shinkai FD","tuned","coupe","rotary2_turbo",395,450,1290,"RWD",1999,"solid",0,"Sequential twin turbos, a perfect silhouette, and a maintenance schedule from hell."),
("Ryuzaki","Aki S2","tuned","roadster","i4_vtec",260,240,1010,"RWD",2020,"solid",2,"Nine thousand revs from four cylinders. Torque is for other people."),
("Ryuzaki","Genbu Widebody","tuned","coupe","rotary2_turbo",500,520,1210,"RWD",2018,"racing_split",3,"A drift-spec Shinkai with fenders like shoulder pads and a hydraulic handbrake."),
("Ishara","Kite RS Cup","tuned","hatch","i4_turbo",300,400,1080,"FWD",2024,"racing_split",1,"Front-drive, limited-slip, and faster round a lap than cars costing four times more."),
("Hanyu","Meridian N","tuned","sedan","i4_turbo",290,400,1420,"FWD",2024,"stripe_dual",1,"Hanyu's skunkworks saloon. Pops, bangs, and a warranty that covers track days."),
("Aveline","Cirrus Rallye","tuned","rally","i4_turbo",305,420,1230,"AWD",2023,"rally",0,"Aveline's rally homologation. Long-travel suspension and a co-driver seat."),
("Vorst","Ceres GTS","tuned","coupe","flat6",400,420,1370,"RWD",2024,"solid",1,"They put the big flat six in the small car. Everything you hoped would happen, happened."),
("Vorst","Kessel S","tuned","coupe","flat6_turbo",450,530,1500,"RWD",2023,"solid",0,"Engine still hanging out the back. Still shouldn't work. Still does."),
("Vorst","Kessel Turbo S","tuned","coupe","flat6_turbo",580,750,1640,"AWD",2024,"solid",2,"All-wheel drive, two turbos, and launch control that rearranges your organs."),
("Grauwolf","Kern 40 CS","tuned","coupe","i6_turbo",510,600,1690,"RWD",2024,"stripe_dual",0,"Carbon roof, no rear seats, and a straight six tuned to sing at eight."),
("Grauwolf","Sturm 8","tuned","sedan","v8_turbo",600,750,1830,"AWD",2024,"solid",2,"A four-door with a twin-turbo V8 and absolutely no respect for its own tyres."),
("Eisenbach","Klasse 63","tuned","sedan","v8_turbo",585,850,1870,"AWD",2023,"solid",0,"Hand-built V8, quilted leather, and a drift mode nobody at head office admits to."),
("Eisenbach","Halde RS","tuned","wagon","v6_turbo",450,600,1720,"AWD",2024,"solid",1,"The fast estate. Groceries at nine tenths."),
("Eisenbach","Kreuz GT","tuned","gt","v10",620,560,1650,"AWD",2022,"racing_split",3,"Naturally aspirated V10 in an aluminium spaceframe. The last of its kind."),
("Wexler","Coyote GT","tuned","pony","v8",460,570,1650,"RWD",2024,"stripe_dual",1,"Five litres, a manual gearbox, and a soundtrack that sets off car alarms."),
("Wexler","Coyote Mach","tuned","pony","v8_sc",560,700,1700,"RWD",2024,"racing_split",0,"Supercharged, splitter'd, and wearing a wing you can see from orbit."),
("Wexler","Ironhide 440","tuned","muscle","v8",440,610,1720,"RWD",1970,"stripe_center",1,"Big-block classic. Brakes are decorative. Straight lines only, mostly."),
("Marlowe","Comet SS","tuned","pony","v8",490,630,1690,"RWD",2023,"stripe_center",0,"The Comet with the proper engine. Balance sold separately."),
("Marlowe","Comet Venom","tuned","pony","v8_sc",615,780,1730,"RWD",2024,"racing_split",1,"Supercharged, widebodied, and quietly terrifying in the wet."),
("Marlowe","Dart Rally","tuned","rally","i4_turbo",350,450,1490,"AWD",2024,"rally",3,"Marlowe's answer to the gravel crowd. Underdog energy."),
("Thornbury","Wren Cup","tuned","trackcar","i4_sc",260,250,740,"RWD",2022,"racing_split",0,"Three hundred and fifty horsepower per tonne with a supercharger whine and no roof."),
("Thornbury","Harrier R","tuned","trackcar","v6_turbo",430,440,1010,"RWD",2023,"solid",2,"Bonded aluminium tub, mid-mounted V6, and a steering rack wired to your spine."),
("Norsken","Frost R","tuned","wagon","i4_turbo",360,500,1620,"AWD",2024,"solid",3,"Electrified rear axle, snow tyres optional, dignity intact."),
("Tenjin","Ion GT","tuned","sedan","electric",480,700,1720,"AWD",2025,"stripe_center",3,"Four hundred and eighty silent horsepower. The strangest thing you'll ever overtake with."),
# ---- SUPER (25) ------------------------------------------------------------
("Scorpetti","Fiora","super","supercar","v8_turbo",660,760,1470,"RWD",2023,"solid",0,"Mid-engined, flat-plane, and calibrated to sound expensive at every rpm."),
("Scorpetti","Fiora Corsa","super","supercar","v8_turbo",710,770,1390,"RWD",2024,"racing_split",1,"Stripped, caged, and given a rear wing with an opinion."),
("Scorpetti","Tramonto","super","supercar","v8_turbo",680,760,1520,"RWD",2024,"solid",2,"Roof folds, noise doesn't. Scorpetti's open-top statement piece."),
("Alviero","Tempesta","super","gt","v12",800,718,1560,"RWD",2024,"solid",0,"Front-mid V12, no turbos, no apologies. Eight thousand nine hundred revs."),
("Alviero","Aquilone","super","gt","v12",740,690,1630,"RWD",2023,"stripe_center",1,"The grand tourer. Cross a continent, then set a lap record on arrival."),
("Alviero","Nembo GTS","super","supercar","v8_turbo",700,760,1490,"RWD",2024,"solid",3,"The smaller Alviero. Twin turbos, shorter wheelbase, sharper temper."),
("Valdoro","Aventine","super","supercar","v10",640,600,1520,"AWD",2022,"solid",0,"Naturally aspirated V10, scissor doors, and a noise that sets off seismographs."),
("Valdoro","Aventine SV","super","supercar","v10",780,690,1450,"AWD",2024,"racing_split",3,"Lighter, louder, and wearing enough carbon to build a small aircraft."),
("Valdoro","Falco","super","trackcar","v10",700,620,1380,"RWD",2024,"racing_split",1,"Rear-drive only, aero everywhere, built for people who've stopped pretending."),
("Vorst","Kessel RSR","super","trackcar","flat6",640,470,1420,"RWD",2024,"racing_split",0,"Naturally aspirated flat six at nine thousand. A homologation special for the road."),
("Vorst","Kessel Turbo GT","super","supercar","flat6_turbo",700,800,1590,"AWD",2025,"solid",1,"The fastest thing Vorst will sell you with a number plate."),
("Ashcombe","Corvane","super","gt","v12",720,700,1780,"RWD",2023,"solid",0,"Twelve cylinders wrapped in leather. Brutal, but politely."),
("Ashcombe","Thistle S","super","gt","v8_turbo",665,800,1700,"RWD",2024,"solid",3,"The junior Ashcombe. Twin-turbo V8, tail-happy by design."),
("Eisenbach","Nordwand GT","super","supercar","v8_turbo",720,800,1620,"AWD",2024,"solid",1,"All-wheel drive, all-weather, all the time. The point-and-shoot supercar."),
("Grauwolf","Sturm 8 CSL","super","gt","v8_turbo",700,750,1700,"RWD",2025,"stripe_dual",0,"Rear drive, no rear seats, and a Nürburgring time they won't stop mentioning."),
("Katsuro","Tessen Kaiju","super","supercar","v6_turbo",710,780,1620,"AWD",2025,"racing_split",0,"The Tessen reborn: hybrid-assisted V6, four driven wheels, zero nostalgia."),
("Mishima","Raiden V10","super","supercar","v10",690,540,1480,"RWD",2011,"solid",3,"Mishima's one and only halo car. Carbon tub, ten cylinders, a voice like a violin."),
("Marlowe","Comet ZX","super","supercar","v8_turbo",680,780,1580,"RWD",2025,"stripe_center",0,"Marlowe finally put the engine behind the driver. It changed everything."),
("Wexler","Sidewinder V10","super","supercar","v10",725,780,1560,"RWD",2017,"stripe_dual",1,"Eight point four litres, no traction control worth the name, and a legend of a reputation."),
("Thornbury","Harrier GT1","super","trackcar","v8_turbo",700,700,1130,"RWD",2025,"racing_split",0,"Six hundred and twenty horsepower per tonne. Thornbury's idea of restraint."),
("Thornbury","Lancet","super","trackcar","v6_turbo",650,600,1050,"RWD",2024,"solid",2,"Hybrid-assisted, ground-effect, and legal on public roads by the narrowest margin."),
("Ryuzaki","Shinkai Type-R","super","supercar","rotary4",700,560,1290,"RWD",2025,"stripe_center",1,"Four rotors. Nine thousand five hundred revs. A sound nothing else makes."),
("Norsken","Torden","super","supercar","v8_turbo",800,900,1450,"RWD",2024,"solid",0,"Sweden's first proper supercar. Twin turbos and a carbon monocoque."),
("Tenjin","Kaminari","super","supercar","electric",780,1000,1980,"AWD",2025,"solid",3,"Three motors, torque vectoring, and total silence at two hundred."),
("Apex Dynamics","Surge","super","gt","electric",760,980,1890,"AWD",2025,"solid",1,"Apex's entry point. Still quicker off the line than most things here."),
# ---- HYPER (15) ------------------------------------------------------------
("Alviero","Divina","hyper","hypercar","v12",1000,900,1590,"RWD",2025,"solid",0,"Hybrid-assisted V12. Alviero's flagship, and the last naturally aspirated twelve they'll build."),
("Scorpetti","Aeterna","hyper","hypercar","v8_turbo",1050,1000,1470,"AWD",2025,"racing_split",1,"Twin-turbo hybrid, active aero, and a price with too many digits."),
("Valdoro","Corvino","hyper","hypercar","v12",1015,890,1560,"AWD",2025,"racing_split",3,"A V12 hypercar shaped like a stealth fighter that lost an argument with a wind tunnel."),
("Vorst","Kaskade","hyper","hypercar","v8_turbo",950,1000,1680,"AWD",2024,"solid",0,"Le Mans technology, road-car warranty. Vorst's engineering flex."),
("Grauwolf","Projekt R","hyper","hypercar","v6_turbo",1050,900,1620,"AWD",2025,"stripe_center",1,"A Formula One power unit with number plates. Idles like a machine gun."),
("Krallmann","Zorn 900","hyper","hypercar","v12_turbo",950,1200,1780,"AWD",2024,"solid",0,"Krallmann takes a V12, adds two turbos, and removes the concept of moderation."),
("Krallmann","Nachtfalter","hyper","hypercar","v8_turbo",1200,1300,1650,"RWD",2025,"solid",1,"Matte black, rear drive, twelve hundred horsepower. Named after a moth. Behaves like a hornet."),
("Norsken","Ragnar","hyper","hypercar","v8_turbo",1600,1500,1370,"RWD",2025,"solid",0,"Sixteen hundred horsepower in fourteen hundred kilos. The megacar arms race, won."),
("Norsken","Ragnar Absolut","hyper","hypercar","v8_turbo",1750,1600,1400,"RWD",2026,"stripe_center",2,"Long-tail bodywork built for one thing: the top-speed record."),
("Ashcombe","Solstice AM","hyper","hypercar","v12",1140,900,1030,"RWD",2025,"racing_split",0,"A thousand kilos, a screaming V12, and a cockpit you climb into feet first."),
("Apex Dynamics","Tempest EV","hyper","hypercar","electric",1900,2360,2150,"AWD",2025,"solid",0,"Quad motors. Nineteen hundred horsepower. Silence, then the horizon."),
("Apex Dynamics","Halo X","hyper","hypercar","electric",1500,1800,1950,"AWD",2026,"racing_split",2,"Apex's track-focused EV. Active aero, and brakes that recover more energy than most cars make."),
("Mishima","Raiden Omega","hyper","hypercar","v10",1080,850,1520,"AWD",2026,"racing_split",1,"The Raiden returns with hybrid assistance and a redline that never moved."),
("Thornbury","Vespera","hyper","hypercar","v8_turbo",1150,1000,1180,"RWD",2026,"racing_split",0,"Thornbury's hypercar. They added lightness until there was almost nothing left."),
("Wexler","Thunderhead","hyper","hypercar","v16_turbo",1580,1600,1980,"AWD",2025,"solid",0,"Sixteen cylinders, four turbos, and Detroit's answer to European excess."),
]

assert len(C) == 100, len(C)

def seed_of(s):
    return int(hashlib.md5(s.encode()).hexdigest()[:8], 16)

def slug(*parts):
    t = "-".join(parts).lower()
    return "".join(ch if ch.isalnum() else "-" for ch in t).strip("-").replace("--","-")

def derive(mfr, model, tier, body, eng, hp, tq, kg, drive, year, livery, ci, blurb, idx):
    b, e = BODIES[body], ENGINES[eng]
    is_ev = eng == "electric"

    # --- acceleration 0-100 km/h -------------------------------------------
    ratio = kg / hp
    acc = 1.566 * (ratio ** 0.78) * LAUNCH[drive]
    acc *= (0.94 + (1.00 - TIER_GRIP[tier]) * 0.22)     # tyre launch grip
    if is_ev: acc *= 0.90                                # instant torque
    acc = max(acc, 1.62)
    acc = round(acc, 2)
    # 0-200 km/h, drag starts to bite
    acc200 = round(acc * (3.05 + 260.0 / hp), 2)

    # --- top speed (drag limited) ------------------------------------------
    cda = b["cda"]
    if tier in ("super","hyper"): cda *= 1.06            # downforce costs drag
    if livery == "racing_split":  cda *= 1.04
    watts = hp * 745.7 * (0.80 if is_ev else 0.75)
    vmax = (watts / (0.5 * 1.225 * cda)) ** (1/3.0)
    if is_ev: vmax = min(vmax, 96.0)                     # single-speed gearing wall
    top = int(round(vmax * 3.6))
    if body in ("pickup","suv"): top = min(top, 210)
    top = min(top, {"base":260,"tuned":330,"super":365,"hyper":500}[tier])

    # --- lateral grip / handling -------------------------------------------
    g = TIER_GRIP[tier] + b["grip"] - (kg - 1400) / 1000.0 * 0.055
    if drive in ("AWD","4WD"): g += 0.02
    if livery == "racing_split": g += 0.03
    g = round(max(0.62, min(1.85, g)), 2)

    # --- braking 100-0 m ----------------------------------------------------
    gb = g * 0.95 + b["brk"]
    brake_m = round(771.6 / (2 * gb * 9.81), 1)

    # --- performance index --------------------------------------------------
    s_acc  = min(1.0, max(0.0, (12.5 - acc) / 10.6))
    s_top  = min(1.0, max(0.0, (top - 150) / 300.0))
    s_hand = min(1.0, max(0.0, (g - 0.68) / 0.85))
    s_brk  = min(1.0, max(0.0, (58 - brake_m) / 27.0))
    comb   = 0.33*s_acc + 0.25*s_top + 0.29*s_hand + 0.13*s_brk
    pi     = int(round(100 + 899 * comb))
    cls    = ("D" if pi<300 else "C" if pi<400 else "B" if pi<500 else
              "A" if pi<600 else "S1" if pi<700 else "S2" if pi<800 else "X")

    # --- economy ------------------------------------------------------------
    price = int(round((((pi-100)/900.0) ** 3.2) * 3_250_000 + 11_000) / 500) * 500
    if year < 2005: price = int(price * 1.25 / 500) * 500        # classic tax
    unlock = 1 + min(29, int(((pi-100)/900.0) ** 1.6 * 30))
    reward = int(round(price * 0.045 / 100) * 100)

    # --- gearbox ------------------------------------------------------------
    if is_ev:
        gears, ratios = 1, [8.60]
    else:
        gears = 5 if (tier=="base" and hp < 180) else 6 if hp < 420 else 7 if hp < 900 else 8
        first = 3.60 - min(0.85, hp/2400.0)
        last  = 0.62 + (0.10 if top > 330 else 0.0)
        ratios = [round(first * (last/first) ** (i/(gears-1)), 3) for i in range(gears)]
    final = round(3.90 - min(1.05, hp / 1900.0), 2)

    # --- nitrous / boost (arcade) -------------------------------------------
    nitro = dict(
        capacity_s = {"base":3.0,"tuned":4.0,"super":5.0,"hyper":6.0}[tier],
        power_mult = round({"base":1.18,"tuned":1.22,"super":1.26,"hyper":1.32}[tier], 2),
        refill_s   = {"base":14.0,"tuned":12.0,"super":10.0,"hyper":9.0}[tier],
    )

    pal = MANUFACTURERS[mfr]["palette"]
    rng = seed_of(f"{mfr}{model}{idx}")
    ci2       = (ci + (rng >> 7) % 3) % len(pal)      # spread colours across the palette
    primary   = pal[ci2]
    accent    = pal[(ci2 + 2 + (rng % 2)) % len(pal)]

    cid = slug(mfr, model)
    sc = 1.0 + ((rng >> 5) % 60 - 30) / 1000.0          # +/-3% body-size variance
    length = round(b["L"] * sc, 3)
    width  = round(b["W"] * (1.0 + ((rng >> 11) % 40 - 20)/1000.0), 3)
    if livery == "racing_split" and tier in ("super","hyper"):
        width = round(width * 1.03, 3)

    return dict(
        id=cid, index=idx, name=f"{mfr} {model}", manufacturer=mfr, model=model,
        country=MANUFACTURERS[mfr]["country"], year=year, tier=tier,
        tier_label={"base":"Base","tuned":"Tuned","super":"Supercar","hyper":"Hypercar"}[tier],
        body_type=body, seats=b["seats"], blurb=blurb,
        engine=dict(code=eng, label=ENGINES[eng]["label"], cylinders=ENGINES[eng]["cyl"],
                    aspiration=("electric" if is_ev else
                                "supercharged" if "_sc" in eng else
                                "turbocharged" if "turbo" in eng or eng=="diesel_i4" else
                                "naturally aspirated"),
                    idle_rpm=ENGINES[eng]["idle"], redline_rpm=ENGINES[eng]["redline"],
                    sound_family=ENGINES[eng]["family"]),
        performance=dict(power_hp=hp, power_kw=int(round(hp*0.7457)), torque_nm=tq,
                         weight_kg=kg, power_to_weight_hp_per_tonne=round(hp/(kg/1000.0),1),
                         drivetrain=drive, top_speed_kmh=top, top_speed_mph=int(round(top*0.621371)),
                         accel_0_100_kmh_s=acc, accel_0_200_kmh_s=acc200,
                         braking_100_0_m=brake_m, lateral_g=g,
                         handling_rating=int(round(min(100, max(1, (g-0.68)/0.0117)))),
                         performance_index=pi, performance_class=cls),
        drivetrain_detail=dict(gears=gears, gear_ratios=ratios, final_drive=final,
                               tyre_compound=TIER_TYRE[tier]),
        nitro=nitro,
        economy=dict(price_credits=price, unlock_level=unlock, race_reward_credits=reward),
        dimensions=dict(length_m=length, width_m=width,
                        wheelbase_m=round(length*0.60, 3)),
        visual=dict(primary_color=primary, accent_color=accent, livery=livery,
                    has_wing=(tier in ("super","hyper") or livery=="racing_split" or
                              (tier=="tuned" and body in ("coupe","pony","trackcar","rally"))),
                    sprite=f"sprites/topdown/{cid}.png",
                    sprite_shadow=f"sprites/shadow/{cid}_shadow.png",
                    thumbnail=f"sprites/thumbs/{cid}_thumb.png"),
        audio=dict(engine_set=f"audio/engines/{ENGINES[eng]['family']}",
                   loops={k: f"audio/engines/{ENGINES[eng]['family']}/{ENGINES[eng]['family']}_{k}.wav"
                          for k in ("idle","low","mid","high","redline")},
                   rev_sweep=f"audio/engines/{ENGINES[eng]['family']}/{ENGINES[eng]['family']}_rev.wav",
                   startup=f"audio/engines/{ENGINES[eng]['family']}/{ENGINES[eng]['family']}_start.wav",
                   base_pitch_rpm=max(1, ENGINES[eng]["idle"] or 1200)),
        tags=sorted(set(filter(None, [
            tier, body, drive.lower(), MANUFACTURERS[mfr]["country"].lower(),
            "classic" if year < 2005 else None,
            "electric" if is_ev else None,
            "rotary" if "rotary" in eng else None,
            "turbo" if ("turbo" in eng) else None,
            "lightweight" if kg < 1100 else None,
            "heavy" if kg > 1900 else None,
            "track" if body=="trackcar" else None,
            "drift" if (drive=="RWD" and hp/(kg/1000.0) > 280) else None,
        ]))),
        seed=rng,
    )

cars = [derive(*row, i+1) for i, row in enumerate(C)]

# rescale the 0-100 handling rating so the grippiest car in the pack sits near
# the top of the scale and the softest near the bottom (lateral_g stays physical)
gs = [c["performance"]["lateral_g"] for c in cars]
glo, ghi = min(gs), max(gs)
for c in cars:
    g = c["performance"]["lateral_g"]
    c["performance"]["handling_rating"] = int(round(6 + 93*(g-glo)/(ghi-glo)))

os.makedirs(OUT, exist_ok=True)
db = dict(
    schema_version="1.0.0",
    generated="2026-09-08",
    notice="All manufacturers, models and liveries in this pack are original fiction. No real-world marks are used.",
    units=dict(power="hp", torque="Nm", weight="kg", speed="km/h", distance="m", currency="credits"),
    sprite=dict(pixels_per_metre=56, canvas_w=200, canvas_h=384, orientation="nose-up (north)"),
    tiers={t: dict(label=l, count=sum(1 for c in cars if c["tier"]==t))
           for t,l in [("base","Base"),("tuned","Tuned"),("super","Supercar"),("hyper","Hypercar")]},
    manufacturers={k: dict(v, models=sum(1 for c in cars if c["manufacturer"]==k)) for k,v in MANUFACTURERS.items()},
    engine_families={k: dict(label=v["label"], cylinders=v["cyl"], idle_rpm=v["idle"], redline_rpm=v["redline"])
                     for k,v in ENGINES.items()},
    cars=cars,
)
with open(os.path.join(OUT,"cars.json"),"w") as f:
    json.dump(db, f, indent=2)

os.makedirs(os.path.join(OUT,"data","cars"), exist_ok=True)
for c in cars:
    with open(os.path.join(OUT,"data","cars",c["id"]+".json"),"w") as f:
        json.dump(c, f, indent=2)

cols = ["index","id","name","manufacturer","model","year","tier","body_type","country"]
with open(os.path.join(OUT,"data","cars.csv"),"w",newline="") as f:
    w = csv.writer(f)
    w.writerow(cols+["engine","drivetrain","power_hp","torque_nm","weight_kg","hp_per_tonne",
                     "top_speed_kmh","0-100_s","0-200_s","braking_100-0_m","lateral_g",
                     "handling","PI","class","price_credits","unlock_level","sound_family"])
    for c in cars:
        p=c["performance"]
        w.writerow([c[k] for k in cols]+[c["engine"]["label"],p["drivetrain"],p["power_hp"],
            p["torque_nm"],p["weight_kg"],p["power_to_weight_hp_per_tonne"],p["top_speed_kmh"],
            p["accel_0_100_kmh_s"],p["accel_0_200_kmh_s"],p["braking_100_0_m"],p["lateral_g"],
            p["handling_rating"],p["performance_index"],p["performance_class"],
            c["economy"]["price_credits"],c["economy"]["unlock_level"],c["engine"]["sound_family"]])

print(f"{len(cars)} cars")
for t in ("base","tuned","super","hyper"):
    sub=[c for c in cars if c["tier"]==t]
    pis=[c["performance"]["performance_index"] for c in sub]
    pr=[c["economy"]["price_credits"] for c in sub]
    ac=[c["performance"]["accel_0_100_kmh_s"] for c in sub]
    ts=[c["performance"]["top_speed_kmh"] for c in sub]
    print(f"  {t:6s} n={len(sub):3d}  PI {min(pis)}-{max(pis)}  0-100 {min(ac)}-{max(ac)}s  "
          f"top {min(ts)}-{max(ts)}km/h  price {min(pr):,}-{max(pr):,}")
print("families:", len({c['engine']['sound_family'] for c in cars}))
