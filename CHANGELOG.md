# Changelog

All notable changes to this project are recorded here. The top section collects
work that has not shipped in a tagged release yet.

## Unreleased

### Added
- The bomb route is drawn in the 3D map view, following the nav heights the bots actually walk at, with animated chevrons ahead of the bomb and a solid trail behind it. The Route toggle controls it in 3D as well as in 2D.
- 3D map view rendering engine.
- Skybox backdrop fills the empty geometry around the map render.
- Configurable template folders, searched for `#base` files alongside the popfile directory and the bundled bases.
- Popfiles reload automatically when they change on disk, with a small toast while the window is visible.
- `PointTemplate` entities are parsed and merged into the simulation: popfile-defined map geometry, spawn points, tank paths and immobile tanks.
- `func_nav_avoid` and `func_nav_prefer` volumes from `PointTemplate`s feed the pathing cost.
- Sentry guns and placed bosses are drawn as stationary map entities.
- Every SigMod and RafMod `TFBot` key from the mod source is recognized, guarded by a test.
- Multiple `TeleportWhere` entries, `StripItem`, `EventChangeAttributes` and fired relays are captured.
- Item-inherent move speed is applied for the GRU, Eviction Notice, Skullcutter and Powerjack.
- Root movement settings are wired: `BotPushaway`, `FlagCarrierMovementPenalty`, `MaxSpeedLimit`.
- `InterruptAction`, bot teleports and event-driven trigger outputs are simulated.
- The gate wait is visible on the map wave timeline.
- Medics heal their patients, crowded bots separate, and actor height is cued on the map.
- Tank class icons, BSP-packed map materials, kill-point resimulation and the live bot limit.
- Map materials resolve from the HL2 VPKs and through `Patch` includes.
- Flag escorts are capped and carrier health regenerates per the TF2 convars.

### Changed
- Despawn zones in the 3D map view are rebuilt as ground-conforming meshes tessellated at the height map's own resolution, with a screen-constant rim, a graded fill and a soft skirt, instead of a flat disc with a hairline outline.
- Map view controls reworked into two grouped toolbar rows with a consistent control system.
- Skybox backdrop toned down and cluster collapse steadied so icons stop jittering.
- LZMA lumps decode in a Rust WebAssembly kernel, 3x faster than the JavaScript decoder and byte-identical to it.
- The HDR lighting lump is read only when lightmaps are actually requested.
- Map icons scale with zoom and count badges no longer collide.
- `RandomChoice` picks an option at random instead of cycling through them.
- The crowd separation pass reuses typed arrays and costs less per step.
- Wave list enlarged.
- `TFBot` keys, blocks, attributes and flags are pluggable traits; spawner kinds, bot behaviours and per-step simulation work moved onto registries; popfile outputs route through a scheduled event bus.
- Wave rows are separated for readability.

### Fixed
- Times ending just short of a whole minute no longer display an impossible clock like `24:60`; a wave that runs 1499.7 seconds now reads `25:00`. This affected every time readout: the map playhead, wave durations, the truncation note, the timeline ruler and the actor card.
- Bomb path disable lists are applied, not just enable lists, so waves no longer all pick the same path on maps like Mannworks.
- An explicit `Where` to a start-disabled spawn is honoured (RafMod pulse-enable).
- Major and raw move-speed attribute name variants are recognized.
- The popfile spelling of the Vaccinator attributes is accepted.
- The `PointTemplate` extractor is guarded against malformed input.
- The dev server root route serves the app at `/` again.

### Removed
- The disk-conflict banner, its tab marker and the save block behind it. Files changed on disk have been auto-reloaded with your edits kept in undo since that behaviour changed, so none of it could ever appear.
- The Log panel and its toolbar button. Internal logging, diagnostics and error reporting are unchanged.
- Per-wave currency and the peak readouts.

## 1.1.0 - 2026-07-22

### Added
- Rust/WebAssembly VTF texture decoder.
- Source-accurate nav costs and nav mesh discovery.
- Bomb paths resolve from the map's own relays and re-roll per wave, the way the map actually does.
- Missing-nav handling covers the mission folder, parse errors and approximate meshes.

### Changed
- The app is dressed in TF2's own art, and the TF2 mark is drawn as the quartered circle it actually is.
- The wave bar matches the real icon geometry and bots stay on the nav mesh.
- The main process is split into modules and the leftover hardcodes are gone.

### Fixed
- CLI verification modes no longer write to the user's profile.
- The winCodeSign cache is repaired before packaging on Windows.

### Removed
- The money texture; icon strips are no longer clipped.

## 1.0.1 - 2026-07-21

### Added
- Rust/WebAssembly navigation kernel for the map simulation, loaded through IPC.

### Changed
- The content security policy allows WebAssembly.

## 1.0.0 - 2026-07-21

Initial release.
