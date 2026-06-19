# GRID WARS — Single Recreation Prompt

This is a single, self-contained prompt that specifies the entire **GRID WARS**
project so it can be regenerated from scratch. The original was built
incrementally over ~140 prompts (see [prompts.md](prompts.md)); this document
folds the end state into one structured spec.

> Paste everything below the line into a capable coding agent (e.g. Claude Code
> with Claude Opus). It describes the finished game as it stands today.

---

## PROMPT

Build **GRID WARS**, a turn-based 3D hexagonal strategy game themed after the
1982 film *TRON*, plus an online-multiplayer relay. Generate **all** code,
3D models, sound, and documentation — no external art or audio assets.

### Tech & constraints

- **three.js r0.160** loaded from a CDN via an ES-module import map; **no build
  step** and no bundler. Plain ES modules served statically.
- All unit/terrain/core **models are procedural** three.js geometry (no GLTF/art
  files). All **sound effects and music are synthesized at runtime** with the
  Web Audio API (no audio files). The only network asset is the three.js CDN and
  the Orbitron web font.
- Post-processing via `EffectComposer`: `RenderPass` → `UnrealBloomPass` →
  `OutputPass` → `FXAAShader` pass (FXAA, not MSAA, so additive-blended light
  walls stay bright) and a custom **posterize + Sobel-outline** `ShaderPass` for
  the classic mode.
- A small **Node server** (`server.js`, `ws` dependency only) that serves the
  static files **and** runs a dumb WebSocket relay for multiplayer (rooms +
  message routing only; never game rules). Ship a `Dockerfile`,
  `docker-compose.yml`, and `.dockerignore`.

### File layout

- `index.html` — markup, import map, all CSS/HUD, icon bar.
- `src/main.js` — renderer, post-processing, render modes, themes, cameras,
  picking, the game loop, screen flow.
- `src/game.js` — board, units, turn flow, actions, production, directional
  damage, altitudes, light walls, conquest, undo, serialize/restore, victory.
- `src/ai.js` — the MCP commander: flank- and wall-aware move/attack scoring,
  offensive jet play, and the build phase.
- `src/hex.js` — axial hex math, BFS movement, pathfinding.
- `src/models.js` — procedural cycles, jets, tanks, recognizers, cores, tiles
  (instanced hex-tile field shader with constant-screen-width borders).
- `src/effects.js` — explosions, lasers, rockets, light walls (Catmull-Rom
  ribbon), derez voxel shatter, materialize, floating damage text, particles.
- `src/preview3d.js` — the rotating 3D unit/target card models (hit reaction,
  battle-damage degradation, in-card detonation on death).
- `src/ui.js` — HUD, unit/target cards, scorecard, lobby roster, chat, the
  pre-game GAME RULES editor.
- `src/net.js` — multiplayer: event-lockstep over the relay, host authority,
  snapshots for late joiners.
- `src/audio.js` — synthesized SFX, per-unit voices, ambient hum, music cues.
- `src/constants.js` — unit stats, costs, tunable-rules plumbing, faction
  colours, map sizes, formation generator.
- `src/campaigns.js` — campaign/tutorial mission definitions.

### The Grid (board)

- A hexagonal arena of axial-coordinate hex tiles, radius selectable by map size.
  Six **beacon pylons** pulse at the corners; **energy streaks** race along the
  deep grid below; **data sparks** drift up off the floor; pulses zigzag along
  the gaps between tiles. The floor is an instanced shader with a single-colour,
  constant-width hex border.
- Terrain: dark **pits** and raised **plateaus**. Ground units cannot enter
  either; recognizers and jets fly over. Scattered **healing pads** (rising
  green motes).

### Units — exact default stats

Five unit types. The four buildable ones are tunable per match (HP, move,
damage, cost). Power = base attack damage. Range in hexes. Costs in energy ⚡.

| Unit          | HP | Move | Range | Power | Cost | Flies | Attack | Notes |
|---------------|----|------|-------|-------|------|-------|--------|-------|
| Light Cycle   | 5  | 4    | 1     | 3     | 4    | no    | dash   | Hit & run: one extra move after striking if move remains. Leaves a lethal light wall. Has velocity. Can conquer cores. |
| Light Jet     | 5  | 5    | 2     | 3     | 6    | yes   | laser  | Fast, fragile aerial strafer; glides over units; thin wingtip light walls; 4 altitude levels. |
| Battle Tank   | 9  | 2    | 4     | 4     | 7    | no    | rocket | Arcing energy rocket; ±60° controllable turret; rams cycles; demolishes light walls by driving through. |
| Recognizer    | 14 | 3    | 2     | 3     | 10   | yes   | laser  | Durable flier; 3 altitude levels; jumps terrain & units at 2 move/hex. |
| Control Core  | 24 | 0    | 0     | 0     | 0    | no    | —      | Builds units; pays energy each turn; destroy/capture to win. |

### Map sizes

`army` is the per-faction starting force `cycles·tanks·recos·jets`. Hex count of
a radius-R hexagon = `3R²+3R+1`.

| Size  | Radius | Hexes | Army (c·t·r·j) | Obstacles | Heal pads | Energy/turn | Max factions |
|-------|--------|-------|----------------|-----------|-----------|-------------|--------------|
| S     | 5      | 91    | 2·1·1·1        | 8         | 2         | 3           | 3            |
| M     | 7      | 169   | 3·2·1·1        | 15        | 3         | 3           | 4            |
| L     | 9      | 271   | 4·3·2·2        | 24        | 4         | 4           | 6            |
| XL    | 12     | 469   | 6·4·3·2        | 38        | 5         | 5           | 6            |
| XXL   | 18     | 1027  | 8·6·4·3        | 88        | 8         | 6           | 6            |
| EPIC  | 37     | 4219  | 16·12·8·6      | 360       | 16        | 8           | 6            |
| MANIC | 75     | 17101 | 32·24·16·12    | 1440      | 64        | 10          | 6            |

Camera near/far planes must scale with radius so MANIC isn't clipped.

### Combat math

`damage = max(1, round(Power × facing × flak × (1 + 0.25 × focus)) + exposed + overdrive)`

- **facing** (every unit shows a facing chevron): rear arc **×1.5** (REAR
  STRIKE); front arc **×0.75** (DEFLECTED); side ×1.0.
- **flak**: a rocket vs a HIGH recognizer ×1.5 (FLAK).
- **focus**: +25% per previous hit on the same target this turn.
- **exposed**: +2 flat if the target is a TOP-altitude recognizer.
- **overdrive**: +1 flat if the attacker is a light cycle at full speed.

### Unit mechanics

- **Light cycle velocity** (SLOW/CRUISE/FAST, carried between turns): straight
  riding accelerates; gentle 60° turns hold speed but are impossible at FAST;
  sharp 120° curves (+1 move) require SLOW; U-turns never. Long moves push you
  FAST (locked straight); short moves brake; idling coasts back to SLOW. A FAST
  cycle that isn't moved coasts on. Cycles ride smooth Bézier curves, not hex
  zigzags.
- **Overdrive**: a cycle spending its whole movement in one straight move slides
  +2 hexes and strikes +1 — uncontrollable; sliding into a pit or off the edge
  derezzes it.
- **Light walls**: a moving cycle extrudes a continuous curved glowing wall that
  stands until the start of its side's next turn. Same-team walls are solid to
  you; any enemy cycle hitting a wall is derezzed; a derezzed cycle's walls
  collapse immediately. Tanks breach walls by driving through (the disconnected
  stretch falls away). Player pathfinding routes around enemy walls; hexes
  reachable only by crossing a wall glow orange.
- **Core conquest**: a cycle adjacent to an enemy core channels CONQUEST as its
  special attack; two channels by the **same** cycle on consecutive turns flips
  that core and every unit it spawned to your colour (and its income to you).
  Destroying the channelling cycle resets it ("CONQUEST BROKEN").
- **Tank turret**: rotate in 30° steps up to ±60° off the hull (free action);
  targets must lie within 60° of the turret heading; turret holds world aim as
  the hull drives, and auto-swivels onto its target when firing.
- **Tank ram (PUSH MODE)**: shove an adjacent enemy cycle one hex — into a pit,
  an enemy wall, or off the Grid for instant derez; into its own wall and that
  wall shatters for only normal damage.
- **Recognizer altitude** (NORMAL→HIGH→TOP, one change/turn): HIGH = +1 range,
  immune to cycle strikes, but FLAK from rockets; TOP = +2 range, over
  everything, EXPOSED (+2/hit), can crash onto a unit below (3 crash damage to
  both). Below half structure it's crippled: flies low, can't climb.
- **Jet altitude** (GROUND→NORMAL→HIGH→TOP): every hit drops it one level; on
  the ground it's exposed like a cycle. Airborne jets glide over units and trail
  thin wingtip walls that kill other jets at the same altitude and are sheared
  by recognizers; grounded jet walls act like cycle walls (tank-breakable).
  Flying through a hostile jet wall at your altitude is fatal. A jet rolls 360°
  after a straight run.
- **Healing**: a unit that does nothing for a whole turn repairs +1; a unit that
  holds a heal pad for a full round is fully restored next turn (a repaired
  recognizer regains lift).

### Turn flow, economy, victory

- **Initiative** is rolled fresh each round (announced in chat), but a faction
  that did nothing the previous round gets a strong bias toward going first.
- **Economy**: each core pays its energy every turn; capturing a core adds its
  income. Build at the core; new units rez beside it and act next turn. The MCP
  builds reinforcements too.
- **Movement** can be split across several moves; attacking ends a unit's
  activation (cycles excepted — hit & run). A turn auto-ends when nothing can
  move, attack, or be built.
- **Victory**: a faction falls when all its cores are gone (destroyed or
  captured); its whole army then derezzes, core first. Allies (shared team) win
  together once every rival team's cores have fallen. Derezzed units leave
  glowing voxel wreckage that fades over three cycles.
- **Undo**: an UNDO button reverses the last unit's **move only**, enabled only
  while nothing has been damaged/destroyed/attacked since.

### Game modes & setup

- **Tutorial** — five guided lessons (cycles, tanks, recognizers, energy &
  conquest, graduation), each with a briefing; unlock in order.
- **Campaign — The Grid War** — five escalating missions ending at the heart of
  the MCP with Tron fighting at your side; progress saved; winning offers the
  next mission. (Balance the missions so each is winnable.)
- **Skirmish** — pick a map size and set up 2–6 combatants: each has a name
  (login), a colour (the colour *is* the side), a controller (PLAYER or MCP), and
  a team (T1–T6). Allies can't damage each other and win together. Factions spawn
  on their own edge.
- **TURN MODE** toggle: **SEQUENTIAL** (initiative order) or **SIMULTANEOUS
  (WeGo)** — plan all orders, COMMIT, then moves resolve together (collisions by
  initiative) and attacks fire as a batch.
- **GAME RULES** editor: tune per-unit HP/move/damage/cost and the build-credits
  (income) before a match; persisted; RESET to stock; never leaks into the next
  game.

### UI & presentation

- Top-right **icon bar on every screen**: 🔊 sound mute (a slash crosses the
  speaker when muted), 🌓 light/dark theme, ⓘ info (toggles instructions; only
  during a game). In-game: ↶ UNDO, ☰ MENU (restart/quit/invite), NEXT UNIT (Tab)
  to cycle units that can still act (pulsing ring), END TURN.
- **Unit card**: a slowly rotating high-res 3D model of the selected unit with
  visible battle damage, beside its stats. **Target card**: appears when hovering
  a hittable enemy — rotating model, structure/range/power, exact predicted
  damage and modifiers, whether the hit derezzes (the doomed slice of the health
  bar blinks red). On a kill, the target's model **detonates inside the card**
  (parts fly apart and fade) and the card lingers on DEREZZED before clearing.
- **Scorecard** (top-right): sorted leader-first; per-combatant score, team,
  core count and army size.
- **Render styles** (toggle live): **Modern** (bloom + FXAA) and **Classic
  16-bit** (orthographic iso camera, posterised palette, dark Sobel outlines,
  dark-blue tiles). Classic camera orbits/pans/zooms freely.
- **Themes**: dark TRON-night, and a light "Amiga LightWave" workstation look
  (light-grey background, dark text, softened bloom).
- **Responsive & touch**: works on phones/tablets — fluid layout, tap to select,
  tap-to-preview / tap-again-to-confirm, finger-sized targets.
- Focusing the camera on a unit pans **without rotating** (no disorientation).
- Drag to orbit, scroll to zoom.

### Audio

- Every unit has a distinct synthesized voice (cycles whine, tanks rumble on
  sub-bass, recognizers drone), each subtly detuned per play; weapons and engines
  sound rougher as a unit loses structure.
- A generative score in the spirit of Wendy Carlos's TRON soundtrack: dark minor
  pads, square-wave arpeggios with ghost echoes, brass swells with opening
  filters, low ostinati, plus cues quoting the **main title**, an **Anthem**-like
  rising line, and a tense chromatic descent — dropping in every 20–40s.
- Optional **VOICE**: speak all transmissions aloud in a flat machine-like
  English voice via browser speech synthesis.

### Multiplayer & chat

- A collapsible transmissions panel lets human players chat between turns; chat
  and AI "barks" are broadcast to everyone. AI factions talk in the film's
  dialect — hostile MCP ("YES.", "NO.", "DEREZZED.", "END OF LINE.") and Tron
  for AIs on a human's team ("I FIGHT FOR THE USERS."). AI barks also float as
  fading text above the speaking faction's core.
- **Online**: a pre-game lobby with a room code and JOIN/WATCH links, or
  mid-game INVITE/SPECTATE. The host browser is authoritative and runs the MCP
  factions; clients run the same deterministic simulation and only actions travel
  the wire. Joiners get a live snapshot and take over an unclaimed human faction
  from its next turn; disconnects hand control back to the host. `?join=ROOM` and
  `?watch=ROOM` URLs.

### Persistence

- Every running game **auto-saves each turn** under ACTIVE GRIDS on the start
  screen — multiple concurrent games, resume or discard freely; finished games
  clean themselves up. Saves restore the **full board state**: unit
  facing/altitude, every standing light wall (per-segment control points), and an
  approximation of the ambient particle life. Top-5 highscores per map size in
  localStorage. The end-of-game replay screen can restart the same (seeded) map
  as a fresh game.

### Polish details

- Combat animations start deliberately slow and quicken slightly each game cycle.
- Derez explosions scale with the unit's physical size — a falling core is an
  event; every explosion is built from randomised parameters (fountaining embers,
  shrapnel, a vertical derez column, scatter) so no two look alike.
- The MCP plays to win: flanks for rear damage, rams cycles into pits/walls,
  channels and renews core conquests, and flies jets offensively to wall you off.

Deliver it polished, atmospheric, and faithful to the original film's look and
sound.
