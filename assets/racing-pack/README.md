# 100-Car Pack — assets for a racing game

A complete, engine-agnostic car set: **100 vehicles** across four tiers, each with a
top-down sprite, a matching engine sound, and balanced performance stats derived
from one consistent physics model.

Everything here is **original fiction** — invented manufacturers, models and liveries.
No real-world trademarks are used, so the pack is safe to ship commercially.

```
cars.json          master database (all 100 cars, manufacturers, engine families)
preview.html       offline browser — open it in any browser, no server needed
data/              cars.csv (spreadsheet view) + one JSON per car
sprites/           topdown/ · shadow/ · thumbs/ · atlas/ · contact_sheet.png
audio/             engines/<family>/ · sfx/ · audio_manifest.json   (.wav and .ogg)
code/              racing-audio.js (engine sound engine) · cars.js (query helpers)
```

Start with **`preview.html`** — double-click it. Every car is browsable, filterable
and sortable, and you can run each engine on an RPM slider to hear it.

---

## The roster

| Tier | Cars | Power | 0–100 km/h | Top speed | Perf. index | Price |
|---|---|---|---|---|---|---|
| **Base** — showroom-stock street cars | 30 | 84–265 hp | 5.8–11.3 s | 171–253 km/h | 240–490 | 19k–234k |
| **Tuned** — modified street & homologation | 30 | 260–620 hp | 3.2–6.1 s | 239–330 km/h | 531–715 | 319k–998k |
| **Supercar** | 25 | 640–800 hp | 2.3–3.3 s | 317–365 km/h | 758–842 | 1.20M–1.76M |
| **Hypercar** | 15 | 950–1900 hp | 1.6–2.2 s | 346–489 km/h | 875–959 | 2.03M–2.81M |

21 manufacturers with their own national character and colour palettes — Katsuro,
Ryuzaki and Ishara (Japan), Vorst, Grauwolf, Eisenbach and Krallmann (Germany),
Alviero, Scorpetti and Valdoro (Italy), Wexler, Marlowe, Ironvale and Apex Dynamics
(USA), Ashcombe and Thornbury (UK), plus Aveline, Norsken, Hanyu, Mishima and Tenjin.

Body types: city, hatch, sedan, wagon, coupe, roadster, muscle, pony, SUV, pickup,
rally, GT, supercar, hypercar, trackcar.

---

## Sprites

* **Top-down**, nose pointing **up (north)**, ready to rotate around the sprite centre.
* Canvas **200 × 384 px**, transparent PNG.
* **56 pixels per metre, constant across all 100 cars** — so a pickup really is
  bigger than a city car on screen without any per-car scaling. To change the world
  scale, scale every sprite by the same factor.
* Shadows ship **separately** in `sprites/shadow/` so you can offset them by sun
  angle, fade them under bridges, or skip them entirely. `sprites/topdown/` is the
  car alone with no shadow baked in.
* `sprites/atlas/atlas_<tier>.png` packs each tier into one texture, with an
  accompanying `.json` giving pixel frames per car id.
* `sprites/thumbs/` holds 128 × 128 icons for car-select and garage UI.
* `sprites/contact_sheet.png` is the whole set on one page for reference.

Each car's colours come from its manufacturer's palette, so a Wexler always looks
like a Wexler. Liveries: solid, centre stripe, dual stripe, two-tone, racing split
(with a race number) and rally.

---

## Audio

Sounds are **procedurally synthesised**, not sampled, so they're royalty-free and
consistent.

> **Two downloads.** This pack ships with **`.ogg`** audio (44.1 kHz mono) — small,
> and what browsers, Godot and Unity all read happily. The identical set as
> uncompressed **`.wav`** is a separate download, `racing-cars-pack-wav-audio.zip`;
> unzip it over this folder and the `.wav` files land beside their `.ogg` twins.
> Filenames and folders are identical, so nothing else changes.
>
> `audio_manifest.json` and `cars.json` reference `.wav` paths. `racing-audio.js`
> swaps the extension for you — `new RacingAudio('./audio', { format: 'ogg' })` is
> the default; pass `'wav'` once you've added the WAV set.

### Engine families

23 families (`i3`, `i4`, `i4_turbo`, `i4_sc`, `i4_vtec`, `diesel_i4`, `flat4`,
`i6_turbo`, `flat6`, `flat6_turbo`, `v6`, `v6_turbo`, `v8`, `v8_sc`, `v8_turbo`,
`v10`, `v12`, `v12_turbo`, `v16_turbo`, `rotary2`, `rotary2_turbo`, `rotary4`,
`electric`). Each car names its family in `engine.sound_family`.

Per family you get:

| File | What it is |
|---|---|
| `<fam>_idle.wav` … `<fam>_redline.wav` | five **seamless** looping bands |
| `<fam>_rev.wav` | idle → redline sweep, one-shot |
| `<fam>_decel.wav` | redline → idle overrun, one-shot |
| `<fam>_start.wav` | starter motor, catch, settle to idle |

The families are modelled, not just filtered: crossplane V8s and V10s carry real
half-order content (that's the muscle-car rumble), rotaries get the strong even
harmonics that give them their buzz, turbo families add a load-dependent whistle,
supercharged ones a blower whine, and the diesel clatters.

### Playing an engine

**Every loop is sample-exact seamless** — set `loop = true` and it will never click.
`audio/audio_manifest.json` gives the exact RPM each loop was rendered at:

```
playbackRate = targetRpm / loop.rpm
```

Cross-fade between the two bands that bracket your current RPM. `code/racing-audio.js`
does all of this for you:

```js
import { RacingAudio } from './code/racing-audio.js';

const audio  = new RacingAudio('./audio');
await audio.init();                                 // call from a user gesture
const engine = await audio.createEngine(car.engine.sound_family);
engine.start();

// in your frame loop
engine.setRpm(currentRpm);        // pitch + cross-fade handled internally
engine.setLoad(throttle);         // 0..1, opens the sound up under power
engine.setPan(-0.4);              // stereo position for rivals

audio.playSfx('tyre_skid_long', { volume: 0.7, pan: 0.3 });
```

### SFX (35, shared across all cars)

Tyres (`tyre_skid_short`, `tyre_skid_long`, `tyre_chirp`, `tyre_screech_loop`),
surfaces (`surface_gravel_loop`, `surface_wet_loop`, `wind_loop`), driveline
(`gearshift_up/down/sequential`, `turbo_spool`, `turbo_blowoff`, `turbo_flutter`,
`backfire_pop`, `exhaust_crackle`, `rev_limiter`, `brake_squeal`), impacts
(`collision_light/medium/heavy`, `scrape_loop`), nitrous (`nitro_activate`,
`nitro_loop`), horns (`horn_a`, `horn_b`, `horn_air`), and race/UI flow
(`countdown_beep`, `countdown_go`, `checkpoint`, `lap_complete`, `race_finish`,
`ui_select`, `ui_confirm`, `ui_back`, `ui_error`).

Anything ending in `_loop` is seamless; everything else is a one-shot.

---

## Stats

Every number is derived from power, weight, drivetrain, body type and tier by one
model, so the whole set is internally consistent and tiers never overlap awkwardly.

```jsonc
"performance": {
  "power_hp": 1600, "torque_nm": 1500, "weight_kg": 1370,
  "power_to_weight_hp_per_tonne": 1167.9,
  "drivetrain": "RWD",
  "top_speed_kmh": 475, "accel_0_100_kmh_s": 1.62, "accel_0_200_kmh_s": 4.24,
  "braking_100_0_m": 28.3, "lateral_g": 1.45,
  "handling_rating": 97,          // 0-100, scaled across the whole pack
  "performance_index": 959,       // 100-999, the single balance number
  "performance_class": "X"        // D C B A S1 S2 X
}
```

**`performance_index` is the number to build your game around.** It folds
acceleration, top speed, grip and braking into one figure, so you can gate races by
class, or use `matchmake()` in `code/cars.js` to build a grid of rivals within a few
points of the player's car.

Each car also carries `drivetrain_detail` (gear count, ratios, final drive, tyre
compound), `nitro` (capacity, boost multiplier, refill time), `economy`
(price, unlock level, race payout), `dimensions` (metres — matching the sprite
scale), `visual` (colours, livery, asset paths) and `tags` for filtering.

---

## Importing

**Web / canvas / WebGL** — `code/cars.js` and `code/racing-audio.js` are plain ES
modules with no dependencies. Serve the folder over http (ES modules and `fetch`
don't work from `file://`); `preview.html` is the exception and works offline.

**Godot 4** — drop `sprites/` and `audio/` into `res://`. In the import dock set
sprites to *Filter: Off* if you want a crisp pixel look. Parse `cars.json` with
`JSON.parse_string()` into a dictionary keyed by `id`. For engines, use five
`AudioStreamPlayer` nodes with `stream.loop = true` and drive `pitch_scale`
from `targetRpm / loop.rpm`.

**Unity** — put the folder under `Assets/`. Set sprite *Pixels Per Unit* to **56**
so one world unit is one metre and every car is correctly sized. Deserialise
`cars.json` with `JsonUtility` or Newtonsoft into a `ScriptableObject` per car.
For audio use five `AudioSource`s with `loop = true` and set `pitch`.

**Anything else** — `data/cars.csv` opens in a spreadsheet if you'd rather tune
balance there and re-export.

---

## Regenerating

`scripts/` contains the four generators (`gen_cars.py`, `gen_sprites.py`,
`gen_audio.py`, `gen_docs.py`). They need `numpy`, `scipy`, `pillow` and `ffmpeg`.
Everything is seeded and deterministic — the same input gives the same output — so
you can change a colour palette, a body profile or an engine's formants and re-run
to get a consistent new set.

## Licence

Public domain / CC0. The names, designs and sounds are original and generated for
this pack. Use them commercially, modify them, no attribution required.
