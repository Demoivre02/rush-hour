# Rush Hour

Arcade street racing in the browser. Pick a car, tune it in the garage and
race through city streets: nitro, drifting, takedowns and traffic, in the
spirit of the Asphalt games. Built with Three.js; no install and no build step.

## Events

- **Race:** first past the flag.
- **Elimination:** the last car is knocked out every 20 seconds.
- **Takedown Rush:** wreck 5 rivals in 2 minutes.
- **Drift Challenge:** score 3,000 drift points in 2 minutes.
- **Time Trial**, plus a **Formula** series with qualifying, pit stops and a
  24-round championship.

Disciplines: Street, GT, Hypercar, Stock and Formula. The street venues are
dressed as cities with buildings, people, parked cars and civilian traffic.

## Quick start

The game uses browser ES modules, so serve it over HTTP rather than opening
`index.html` directly:

```bash
git clone https://github.com/Demoivre02/rush-hour.git
cd rush-hour
python3 tools/devserver.py 8341 .
```

Open <http://localhost:8341>. On a Mac you can also double-click
`Play Rush Hour.command`.

## Controls

| Input | Action |
| --- | --- |
| `W` / `Up` | Throttle |
| `S` / `Down` | Brake (tap it while steering at speed to start a drift) |
| `A` `D` / `Left` `Right` | Steer |
| `Space` | Nitro |
| `Q` / `E` | Shift down / up in manual mode |
| `C` | Change camera |
| `H` | Show the controls |
| `Esc` | Pause |

Gamepads are supported: left stick to steer, triggers for throttle and brake;
the on-screen labels show the nitro and drift buttons for your pad.

## Development

Node.js 24 runs the headless validation suite.

```bash
npm ci
npm test
npm run build          # deployable static copy in dist/
npm run test:events    # arcade events and traffic
```

Real-brand car models and licensed city packs are used in-house only: they
live in the git-ignored `assets/cars/local-only/` and `assets/city-real/`
folders and are never part of the repository or the public build.
`tools/blender/export_city_pack.py` converts a Blender city pack for the game.

## Licensing and credits

Rush Hour is based on [APEX FORMULA 2026](https://github.com/ahacker-1/apex-formula-2026)
by Avi Hacker, used under the [Apache License 2.0](LICENSE); see [NOTICE](NOTICE).
The vendored Three.js files in `lib/` are MIT-licensed
([THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)). Asset sources are listed in
[ASSET_PROVENANCE.md](ASSET_PROVENANCE.md); the city kits are CC0 by Kenney.

This is an independent project, not affiliated with any real racing
organisation, team, car maker or sponsor. See [TRADEMARKS.md](TRADEMARKS.md).
