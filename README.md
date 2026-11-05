# FPV Drone Sim

A lightweight browser FPV drone simulator that teaches real Mode 2 flying skills.
Plain HTML + JS modules, no build step. Three.js and simplex-noise load from a CDN.

## Run / deploy (Cloudflare Pages, Git integration)
1. Push this repo to GitHub.
2. Cloudflare dashboard → Workers & Pages → Create → **Pages** → Connect to Git → pick this repo.
3. Production branch `main`, framework preset **None**, build command **empty**, output directory `/`.
4. Every pushed branch gets a preview URL (e.g. `phase-1.<project>.pages.dev`); `main` is production.

No wrangler or API tokens are needed.

## Controls (Mode 2)
| | Gamepad | Keyboard |
|---|---|---|
| Throttle | left stick ↕ | W / S |
| Yaw | left stick ↔ | A / D |
| Pitch | right stick ↕ | ↑ / ↓ |
| Roll | right stick ↔ | ← / → |
| Arm / disarm (throttle down!) | B | Space |
| Reset | A | R |
| Angle / Acro | X | M |
| Chase cam | Y | C |
| Analog video effect | BACK | V |
| Mute | | N |
| Menu | START | Esc / P |

Use **Controller Test** in the menu to check that your sticks are mapped correctly.

## Modes
- **Flight School**: 15 lessons from "what do the sticks do" to Acro flips (progress saved)
- **Free Flight**: infinite world; pick a biome + seed in Settings (meadows & city, mountains, neon night city, forest, canyon)
- **Gap Challenge**: thread the tunnels through buildings; gaps get narrower as you score
- **Gate Race**: seeded course of 12 gates, best time + ghost saved per seed, +3 s per missed gate
- **Daily Challenge**: same race course for everyone today (seed from the UTC date)
- **Battery Challenge**: how far can you fly on one battery (with voltage sag)
- Share a race result: the finish screen copies a link like `?seed=42&time=55.50` that challenges a friend

## Files
- `js/config.js`: settings (saved in localStorage) + physics constants
- `js/input.js`: gamepad + keyboard → 4 channels (deadzone, expo, invert)
- `js/drone.js`: quadcopter physics (Angle + Acro, Betaflight-style rates)
- `js/world.js`: infinite chunked seeded world: terrain, forests, city blocks, tunnels, arches, ring gates, collision
- `js/audio.js`: synthesized motor / prop / wind / crash sound (Web Audio)
- `js/osd.js`: goggle-style on-screen display
- `js/video.js`: analog video + fisheye shader (one fullscreen pass)
- `js/settingsMenu.js`: settings screen
- `js/school.js`: Flight School, 15 lessons (steps + automatic checks)
- `js/gates.js`: gates/rings: pass detection + collision
- `js/modes.js`: game modes (lesson runner, race + ghost, gaps, battery, daily seed)
- `js/controllerTest.js`: calibration screen
- `js/main.js`: scene, loop, camera, menus

## Credits
- [three.js](https://threejs.org) (MIT)
- [simplex-noise](https://github.com/jwagner/simplex-noise.js) (MIT)

No asset files are used; everything is generated in code.
