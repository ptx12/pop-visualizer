# pop visualizer

*by ptyx*

A desktop timeline visualizer, editor and wave simulator for Team Fortress 2 **Mann vs. Machine** popfiles — vanilla and rafmod (sigsegv-mvm).

Open a `.pop` and every WaveSpawn becomes a bar on a time axis: when it starts, how fast it ticks out robots, what it waits for, what it pays. Then watch the wave actually play out on the real map.

![timeline](docs/timeline.png)

## Install

Grab a build from [Releases](https://github.com/ptx12/pop-visualizer/releases) — Windows installer or portable `.exe`, Linux AppImage or tarball. Both x64.

Or run from source:

```
git clone https://github.com/ptx12/pop-visualizer
cd pop-visualizer
npm install
npm start
```

Open a `.pop` with the Open button, drag-drop onto the window, or the bundled vanilla mission browser (all 29 Valve missions in `vanilla/`, stock bot templates in `base/`).

Team Fortress 2 does not need to be running, but if it is installed the app finds it automatically and pulls robot icons, map geometry, navigation meshes, materials and fonts straight out of it. Detection covers the Steam registry key on Windows and the usual Steam locations on Linux and macOS — including Flatpak and Snap — then follows `libraryfolders.vdf` to any secondary library. If your install lives somewhere unusual, point at it under Settings → Robot icons → TF folder.

## Platform support

| | Windows | Linux | macOS |
|---|---|---|---|
| Everything except dock mode | yes | yes | untested |
| Dock mode | yes | no | no |
| Prebuilt binaries | yes | yes | no |

Dock mode follows another window around the screen, which needs Win32 window APIs; the button is hidden where it cannot work. macOS should run — the code has no Windows-only assumptions left outside dock mode — but nothing has been tested there and no build is published.

## Timeline

- **One bar per WaveSpawn.** Width is the authored spawn window — `TotalCount`, `SpawnCount`, `WaitBetweenSpawns(AfterDeath)`, `WaitBeforeStarting`. Ticks mark each spawn. Same-named WaveSpawns (Valve's `WaitForAllDead` grouping pattern) merge into one row showing every member's class icon.
- **Dependency arrows.** `WaitForAllSpawned` solid, `WaitForAllDead` dashed; the gate wait is drawn as a dashed lead-in to the bar. Cycles and dangling references are reported.
- **Support** wavespawns run to the edge of the view and fade out.
- **Logic wavespawns** (no robots — outputs, sounds, timing anchors) are amber diamonds, kept out of robot counts.
- **Gated wavespawns.** RafMod missions pause and resume spawning at runtime (`pop_interface $PauseWaveSpawn`, spawn points disabled at map load, relay chains, VScript `EntFire`). Those rows get a GATED badge; give one a manual trigger time and the simulation reruns with it.
- **Editing.** Drag a bar to retime (snaps to other bars, Shift off, Alt fine), drag the right edge for `WaitBetweenSpawns`, drag the link dot onto another row to create a dependency, Ctrl+click for multi-select group moves, right-click for duplicate / move to wave / copy / paste, double-click a name to rename. Full form editors for wavespawns, bots, tanks, waves and missions, plus a raw KeyValues editor on any block for everything the forms do not cover.
- **Activity strip** above the rows: concurrent robots over the wave, plus cumulative cash.
- **Export** writes the whole graph to PNG at the current zoom, including what is scrolled off screen.

The right panel analyses the selected wave and only shows a section when it has something to report: composition (what is actually in the wave), throttling when peak load hits the robot limit, dead-air gaps, and spawn gates.

## Map simulation

![map](docs/map.png)

Switch any wave to **Map** and it plays out on the actual map.

- **Full** renders a top-down image baked from the map's BSP — real materials, lit by the baked lightmap, with roofs culled away from the playable area. **Layout** draws the navigation mesh instead. No TF2 install, no map, or no textures each degrade one step gracefully.
- **Bot movement is ported from Valve's Source SDK 2013**, not invented: the MvM scenario behaviour tree, flag fetch / carry / deploy, escorting, squads with leader promotion, spy teleports, engineer nests, and per-class speeds through `mult_player_movespeed` attributes.
- **Routing** honours `func_nav_prefer` and `func_nav_avoid` brushes, so the path bots take reflects the map's own routing volumes. Maps with switchable route sets get a Nav path selector; the active bomb route is drawn on the map.
- **Gate maps** (Mannhattan and friends) only spawn from the tiers open at wave start; closed-gate spawn points are drawn dim.
- **Death models.** Robots despawn at the hatch by default. Alternatively model defenders as damage zones (auto profile or hand-painted per area, with an adjustable team DPS) or use fixed lifetimes. Kill points can be placed anywhere on the map to cull bots there.
- The right panel becomes a rotated timeline windowed on the current playback time, so you can see which wavespawns are live right now.

## Other views

- **Overview** — waves, robots, tanks, HP, robot limit and currency at a glance.
- **Support missions** and **Templates** (merged across the whole `#base` chain, searchable, with resolved class, health and giant status).
- **Relays** — every output target fired by waves and wavespawns, grouped, each firer clickable.
- **Compare versions** — diff against another open tab or the version currently on disk: setting changes, per-wave currency/robot/HP shifts, added, removed and changed wavespawns.
- **Models** — browse local model folders or the potato.tf index, with an in-app MDL viewer (skinned, textured, animated) and handoff to HLMV++ when it is installed.
- **Command palette** — Ctrl+K for every view, wave and toggle.

## Tank travel times are measured, not guessed

The app locates the mission's BSP, decompresses the entity lump (Valve LZMA included), walks the `path_track` chain from each tank's `StartingPathTrackNode` and divides by that tank's `Speed`. Start nodes that do not exist in the map (Valve ships pops naming `boss_path_a1` where the map has `boss_path_1`) are fuzzy-matched. Per-node distances are shown in the inspector.

## Editing safety

- The KeyValues parser is **formatting-preserving**. Every node keeps the exact source bytes it came from; saving re-emits them verbatim and regenerates only what you actually edited. Opening and saving a file you did not touch produces a byte-identical file — comments, indentation, quirks and all. The whole test corpus (70 files, including 600 KB rafmod missions) round-trips byte-exact.
- Files are read and written latin1, so odd bytes survive untouched. Saves are atomic, and are blocked before writing if an edit introduced characters that cannot round-trip.
- Undo/redo, dirty tracking, multi-file tabs, external-change detection with a reload/keep-mine banner, and crash backups.

## Dock mode (Windows only)

Pick any open window (editors sort first) and the app shrinks to just the diagram, glues itself to that window's edge, stays on top and follows it around. Clicking a row jumps your editor to that line (VS Code `--goto`, Notepad++ `-n`, Sublime `file:line`). The diagram reloads whenever the popfile is saved on disk.

## Robot icons

Icons are **not bundled** — they are read from your own TF2 install, in this order:

1. the mission's folder and its `materials/hud`
2. extra folders added in Settings
3. `tf/download/materials/hud`
4. `tf/custom/*/materials/hud`
5. `tf2_textures_dir.vpk`

`.vtf` files are decoded in-process (DXT1/3/5 and uncompressed), so no VTFEdit is needed. Missing `_giant` style variants fall back to the base icon, then the class icon, then a coloured chip. The built-in icon browser lists everything found across all sources.

## No dependencies

The app ships with **zero runtime npm dependencies**. Every binary format it touches — VTF, VPK, BSP, MDL/VVD/VTX, NAV, LZMA, PNG — is decoded by hand in pure JavaScript under `shared/`. Electron and the packager are the only devDependencies.

## Building

```
npm run dist     # installers for the host platform into dist/
npm run pack     # unpacked app directory only
```

`npm run dist` builds for whatever OS you are on: Windows produces the NSIS installer and the portable exe, Linux produces the AppImage and tarball. Cross-building Linux artifacts from Windows needs Docker, so the practical route is to build each on its own machine or in CI.

## Tests

```
npm test
```

Three suites: byte-exact round-trip over the mission corpus, semantic model and simulation checks, and adversarial parser-hardening cases (the decoders read files downloaded from community servers, so they are bounds-checked against malformed input).

`npm run dev` serves the renderer in a normal browser on port 5317 for UI work, without Electron IPC — no save-to-disk, no dock, no map data.

## CLI

Useful for scripting and screenshots:

```
electron . --open <file.pop> [--wave N]
           [--view overview|missions|templates|relays|diff|settings|map|models]
           [--time SECONDS]        preset the map playback clock
           [--screenshot out.png]  render and quit
           [--export out.png]      write the full wave graph and quit
```

## Caveats

- The simulation knows spawn timing exactly, because it is authored. It cannot know how fast your team kills things, so `MaxActive` throttling and death timing affect the simulation only — never the drawn spawn schedule.
- Mission-block bots (support snipers, spies, sentry busters) are not simulated; wavespawns are.
- Gate capture timing is player-driven and therefore unknowable, so the map sim uses the spawn points open at wave start.
- Maps with no navigation mesh anywhere fall back to the nearest-named one and say so.

## Licence

MIT — see [LICENSE](LICENSE).

Unofficial fan tool, not affiliated with Valve. Team Fortress 2 and Mann vs. Machine are trademarks of Valve Corporation. See [NOTICE](NOTICE) for the bundled Valve mission scripts and templates.

Bot behaviour is modelled on the publicly released [Source SDK 2013](https://github.com/ValveSoftware/source-sdk-2013); rafmod support targets [sigsegv-mvm](https://github.com/sigsegv-mvm/sigsegv-mvm).
