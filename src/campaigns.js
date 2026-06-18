// Single-player campaigns. Each mission fixes the map (size + seed), the
// combatants, and optionally overrides armies and world parameters —
// the tutorial uses tiny focused armies to teach one system at a time.
// Colours: 0 cyan, 1 orange, 2 green, 3 magenta, 4 yellow, 5 red, 6 purple, 7 white.

export const CAMPAIGNS = {
  tutorial: {
    name: 'BASIC TRAINING',
    missions: [
      {
        title: 'FIRST RIDE — LIGHT CYCLES',
        size: 'S', seed: 110101,
        factions: [
          { name: 'YOU', color: 0, controller: 'human', team: 1 },
          { name: 'TRAINER', color: 1, controller: 'ai', team: 2 },
        ],
        mods: {
          world: { income: 0, obstacles: 6, heals: 1 },
          armies: { 0: { cycle: 3, tank: 0, reco: 0 }, 1: { cycle: 2, tank: 0, reco: 0 } },
        },
        briefing: [
          'The LIGHT CYCLE is speed itself: 6 movement, but it carries velocity.',
          'Gentle 60° turns are free, hard 120° turns cost +1 — and no U-turns.',
          'Every move extrudes a LIGHT WALL behind you. Enemy cycles that touch it derez instantly. You cannot cross your own team\'s walls.',
          'Spend ALL 6 movement in one move and you OVERDRIVE: sliding 2 extra hexes straight on. Mind the pits and the map edge — red highlights mean death.',
          'After striking (range 1) a cycle may keep moving — hit and run.',
          'OBJECTIVE: derez both trainer cycles.',
        ],
      },
      {
        title: 'ARMORED DIVISION — TANKS',
        size: 'S', seed: 110202,
        factions: [
          { name: 'YOU', color: 0, controller: 'human', team: 1 },
          { name: 'TRAINER', color: 1, controller: 'ai', team: 2 },
        ],
        mods: {
          world: { income: 0, obstacles: 8, heals: 1 },
          armies: { 0: { cycle: 1, tank: 2, reco: 0 }, 1: { cycle: 3, tank: 0, reco: 0 } },
        },
        briefing: [
          'The BATTLE TANK is slow (2 movement) but fires rockets to range 4.',
          'Its turret swivels only ±60° from the hull — use the ⟲ ⟳ buttons to pre-aim (a free action). Nothing can be shot in the rear arc: protect your back.',
          'Attacks into an enemy\'s REAR are +50%; into their FRONT only 75%.',
          'A tank beside an enemy cycle can PUSH it one hex instead of shooting — into a pit, a wall or off the Grid for an instant derez.',
          'Tanks also demolish light walls by simply driving through them.',
          'OBJECTIVE: derez the trainer cycles. Try at least one push.',
        ],
      },
      {
        title: 'AIR PATROL — RECOGNIZERS',
        size: 'S', seed: 110303,
        factions: [
          { name: 'YOU', color: 0, controller: 'human', team: 1 },
          { name: 'TRAINER', color: 1, controller: 'ai', team: 2 },
        ],
        mods: {
          world: { income: 0, obstacles: 10, heals: 2 },
          armies: { 0: { cycle: 2, tank: 0, reco: 1 }, 1: { cycle: 2, tank: 1, reco: 0 } },
        },
        briefing: [
          'The RECOGNIZER flies. It JUMPS over units, pits and plateaus — at 2 movement per hop instead of 1.',
          'Use the ▲ ▼ ALTITUDE buttons: flying HIGH grants +1 laser range and light cycles cannot touch you — but enemy rockets hit you for +50% (FLAK).',
          'Below half structure a recognizer is CRIPPLED: it flies low, wobbles, and cannot climb plateaus until repaired.',
          'Units that spend a turn idle self-repair +1; the glowing green pads heal +2 more.',
          'OBJECTIVE: derez the trainer force. Beware its tank while flying high.',
        ],
      },
      {
        title: 'POWER PLAY — ENERGY & CONQUEST',
        size: 'M', seed: 110404,
        factions: [
          { name: 'YOU', color: 0, controller: 'human', team: 1 },
          { name: 'TRAINER', color: 1, controller: 'ai', team: 2 },
        ],
        mods: {
          world: { income: 4 },
          armies: { 0: { cycle: 2, tank: 1, reco: 1 }, 1: { cycle: 2, tank: 1, reco: 1 } },
        },
        briefing: [
          'Your CONTROL CORE is a factory. Select it to build: cycles 4⚡, tanks 7⚡, recognizers 10⚡. Energy income arrives every turn.',
          'FOCUS FIRE: each additional hit on the same target in one turn strikes +25% harder. Gang up.',
          'CONQUEST: park a light cycle beside the enemy core and channel CONQUER on two consecutive turns — the core AND its entire army defect to you.',
          'The game ends only when a side\'s cores are gone.',
          'OBJECTIVE: destroy or CONQUER the trainer\'s core.',
        ],
      },
      {
        title: 'GRADUATION',
        size: 'M', seed: 110505,
        factions: [
          { name: 'YOU', color: 0, controller: 'human', team: 1 },
          { name: 'PROCTOR', color: 5, controller: 'ai', team: 2 },
        ],
        mods: null,
        briefing: [
          'Full armies, no training wheels. Everything you have learned applies:',
          'velocity and walls, turret arcs and pushes, altitude and flak, healing pads, focus fire, overdrive — and conquest.',
          'The PROCTOR will use all of it against you.',
          'OBJECTIVE: end its line.',
        ],
      },
    ],
  },

  grid_war: {
    name: 'THE GRID WAR',
    missions: [
      {
        title: 'I. OUTER SECTOR',
        size: 'S', seed: 220101,
        factions: [
          { name: 'FLYNN', color: 0, controller: 'human', team: 1 },
          { name: 'SENTRY', color: 1, controller: 'ai', team: 2 },
        ],
        mods: null,
        briefing: [
          'The MCP\'s outer defence grid is thin here. A single sentry program holds the sector.',
          'Break through. Leave nothing running.',
        ],
      },
      {
        title: 'II. LIGHT WALL CANYONS',
        size: 'M', seed: 220202,
        factions: [
          { name: 'FLYNN', color: 0, controller: 'human', team: 1 },
          { name: 'WARDEN', color: 1, controller: 'ai', team: 2 },
        ],
        mods: { world: { obstacles: 26 } },
        briefing: [
          'A shattered sector — pits and plateaus everywhere. Cycle walls turn the canyons into kill boxes.',
          'The WARDEN knows this ground. Make it regret that.',
        ],
      },
      {
        title: 'III. TWIN CORES',
        size: 'M', seed: 220303,
        factions: [
          { name: 'FLYNN', color: 0, controller: 'human', team: 1 },
          { name: 'MCP-EAST', color: 1, controller: 'ai', team: 2 },
          { name: 'MCP-WEST', color: 5, controller: 'ai', team: 2 },
        ],
        // Two enemy cores (default M army each) badly out-number a lone player
        // on the default army — so command rezzes FLYNN a reinforced wing.
        // MCP-EAST / MCP-WEST have no army entry and fall back to config.army.
        mods: { armies: { 0: { cycle: 5, tank: 3, reco: 2, jet: 2 } } },
        briefing: [
          'Two allied MCP cores share this sector. Both must fall — or be conquered.',
          'Command has rezzed you a reinforced wing, but two cores still out-build one.',
          'Strike fast: conquest of a single core turns its whole army on the other.',
        ],
      },
      {
        title: 'IV. ALLIED PROGRAMS',
        size: 'L', seed: 220404,
        factions: [
          { name: 'FLYNN', color: 0, controller: 'human', team: 1 },
          { name: 'TRON', color: 7, controller: 'ai', team: 1 },
          { name: 'SARK', color: 1, controller: 'ai', team: 2 },
          { name: 'ICP-9', color: 5, controller: 'ai', team: 2 },
        ],
        mods: null,
        briefing: [
          'TRON fights beside you — an independent program on your team.',
          'SARK commands the MCP\'s shock troops. Coordinate with your ally; you win and fall together.',
        ],
      },
      {
        title: 'V. HEART OF THE MCP',
        size: 'XL', seed: 220505,
        factions: [
          { name: 'FLYNN', color: 0, controller: 'human', team: 1 },
          { name: 'TRON', color: 7, controller: 'ai', team: 1 },
          { name: 'MCP', color: 1, controller: 'ai', team: 2 },
          { name: 'SARK', color: 5, controller: 'ai', team: 2 },
          { name: 'ICP-PRIME', color: 6, controller: 'ai', team: 2 },
        ],
        // Two cores (you + TRON) against three out-build you 3:2, so the default
        // XL army can't survive long enough to break in. Rez both allies a
        // reinforced, cycle-heavy wing (cycles channel conquest) — the enemies
        // keep the stock XL army, so you start near-even and must flip a core
        // fast before their extra core grinds you down.
        mods: {
          world: { income: 6 },
          armies: {
            0: { cycle: 10, tank: 5, reco: 3, jet: 3 },
            1: { cycle: 8, tank: 5, reco: 4, jet: 3 },
          },
        },
        briefing: [
          'The cone of the Master Control Program itself, ringed by Sark\'s legions.',
          'THREE cores stand against you and TRON\'s two — they out-build you. Don\'t trade blows: CONQUER.',
          'Channel a light cycle on an enemy core for two straight turns and that core AND its army defect — flipping the war 3-on-2 your way. Then end the rest.',
        ],
      },
    ],
  },

  // Themed trials: each map fields ONE kind of program (so you master it in
  // isolation), then a capture-the-flag map around a neutral core, then a
  // combined-arms finale.
  proving: {
    name: 'PROVING GROUNDS',
    missions: [
      {
        title: 'I. CYCLE BLITZ — LIGHT CYCLES ONLY',
        size: 'S', seed: 330101,
        factions: [
          { name: 'FLYNN', color: 0, controller: 'human', team: 1 },
          { name: 'SARK', color: 1, controller: 'ai', team: 2 },
        ],
        mods: {
          buildable: ['cycle'],
          world: { income: 5, obstacles: 12, heals: 2 },
          armies: { 0: { cycle: 4 }, 1: { cycle: 4 } },
        },
        briefing: [
          'Light cycles and nothing else. Pure velocity, walls and overdrive.',
          'Box the enemy in with light walls; ride your own at speed; never U-turn into a corner.',
          'Your core can only rez more cycles here.',
          'OBJECTIVE: derez the enemy cycles, or take their core.',
        ],
      },
      {
        title: 'II. SIEGE LINE — BATTLE TANKS ONLY',
        size: 'M', seed: 330202,
        factions: [
          { name: 'FLYNN', color: 0, controller: 'human', team: 1 },
          { name: 'WARDEN', color: 1, controller: 'ai', team: 2 },
        ],
        mods: {
          buildable: ['tank'],
          world: { income: 8, obstacles: 22, heals: 2 },
          armies: { 0: { tank: 3 }, 1: { tank: 3 } },
        },
        briefing: [
          'An artillery duel. Tanks only — range 4 rockets, but a turret that slews just ±60° a turn.',
          'Pre-aim with the ⟲ ⟳ arc, never expose your rear, and use the plateaus for cover.',
          'OBJECTIVE: out-gun the Warden\'s line.',
        ],
      },
      {
        title: 'III. PATROL WING — RECOGNIZERS ONLY',
        size: 'M', seed: 330303,
        factions: [
          { name: 'FLYNN', color: 0, controller: 'human', team: 1 },
          { name: 'ICP-9', color: 5, controller: 'ai', team: 2 },
        ],
        mods: {
          buildable: ['reco'],
          world: { income: 10, obstacles: 28, heals: 3 },
          armies: { 0: { reco: 2 }, 1: { reco: 2 } },
        },
        briefing: [
          'Recognizers rule this broken sector — they glide over every pit and plateau.',
          'Climb to HIGH or TOP for reach and safety, but watch the flak; dive to repair when crippled.',
          'OBJECTIVE: clear the patrol wing.',
        ],
      },
      {
        title: 'IV. DOGFIGHT — LIGHT JETS ONLY',
        size: 'M', seed: 330404,
        factions: [
          { name: 'FLYNN', color: 0, controller: 'human', team: 1 },
          { name: 'SARK', color: 1, controller: 'ai', team: 2 },
        ],
        mods: {
          buildable: ['jet'],
          world: { income: 7, obstacles: 16, heals: 2 },
          armies: { 0: { jet: 3 }, 1: { jet: 3 } },
        },
        briefing: [
          'Fast, fragile jets. They bank through wide turns, barrel-roll down the straights, and fire only at what\'s dead ahead.',
          'Stay airborne and you\'re untouchable by cycles — but one hit drops you to the deck.',
          'OBJECTIVE: win the dogfight.',
        ],
      },
      {
        title: 'V. CAPTURE THE CORE',
        size: 'L', seed: 330505,
        factions: [
          { name: 'FLYNN', color: 0, controller: 'human', team: 1 },
          { name: 'MCP', color: 4, controller: 'ai', team: 2 },
          { name: 'THE GRID', color: 6, controller: 'neutral', team: 0 },
        ],
        mods: {
          world: { income: 4, obstacles: 18, heals: 3 },
          armies: {
            0: { cycle: 2, tank: 1, reco: 0, jet: 1 },
            1: { cycle: 2, tank: 1, reco: 0, jet: 1 },
            2: { cycle: 3 },
          },
        },
        briefing: [
          'A dormant CONTROL CORE idles at the centre of the Grid, ringed by neutral guard cycles. It belongs to no one.',
          'It can\'t be shot down — only CAPTURED: park a light cycle beside it and channel CONQUER for two straight turns.',
          'Take it and the core (and its guards) defect to you, doubling your output. The MCP is racing for it too.',
          'OBJECTIVE: capture the neutral core, then end the MCP.',
        ],
      },
      {
        title: 'VI. COMBINED ARMS',
        size: 'L', seed: 330606,
        factions: [
          { name: 'FLYNN', color: 0, controller: 'human', team: 1 },
          { name: 'TRON', color: 7, controller: 'ai', team: 1 },
          { name: 'MCP', color: 4, controller: 'ai', team: 2 },
          { name: 'SARK', color: 1, controller: 'ai', team: 2 },
        ],
        mods: { world: { income: 6 } },
        briefing: [
          'No restrictions. Every program, every trick you\'ve drilled — cycles, tanks, recognizers and jets together.',
          'TRON flies with you against the MCP and Sark. Combine arms and finish it.',
          'OBJECTIVE: end both enemy cores.',
        ],
      },
    ],
  },
};
