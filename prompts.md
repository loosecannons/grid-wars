# GRID WARS — Prompt History

This file is the (lightly cleaned) sequential record of the natural-language
prompts that produced **GRID WARS**, an AI-generated TRON-themed 3D hex
strategy game. The entire project — code, models, sound, docs — was generated
by an AI from these prompts alone; there was no hand-written code.

> ⚠️ See the disclaimer in [README.md](README.md): this is untested,
> AI-generated software, provided **as is**, for novelty/experimentation only.

## Models used

| Phase | Model | Prompts |
|-------|-------|---------|
| 1 — Initial creation | **Claude Fable 5** (`claude-fable-5`) | 19 |
| 2 — Expansion & polish | **Claude Opus 4.8** (1M context, `claude-opus-4-8`) | 123 |

Tooling: [Claude Code](https://claude.com/claude-code). The prompts below are
verbatim user messages in order; routine continuations, slash-commands, and
tool chatter have been removed. Light typos are the user's own.

---

## Phase 1 — Initial creation (Claude Fable 5)

1. create a game using three.js for one player and an AI that lets you play a turn-based stragtegy game on a 3D map with hexagonal playng fields using elements from the TRON movies, such as lightbikes, recognizers, rockets, lasers and more. The elements should be 3D modelled and be able to target each other. Each turn should be animated with elaborate explosions and sound effects. The style should be closer to the original movie.

2. nice. can you extend the number of units possible and add sizes of maps S, M, L and XL. the main base should be able to create new units. Also the game seems to reset after a few turns, the game should only end, if the opposing base/tower is destroyed or the there are no more units to move. damage calculation should take direction of attack into consideration.

3. lightcycle should have one additional move after the attack, if not the maximum distance was used. lifecycle move should be slighlty increased. the terrain should be more varried with holes and a higher level, which only recognizers can overcome but with a movement penalty. the turn should automatically end, if no unit can be moved or units can be created. drezed particles should fade very slowly and only vanish after a few turns.

4. lifecycle barriers should stay longer and derez other lifecycles. lifecycles should have a velocity. making harder turns more costly or impossible. recognizers can jump other units, but with the same cost when climbing terrain, this should be reflected in there animation. recognizers should not fly through other units or terrain. the should be a starting animation flying into the map after selecting the size. tank strike distance should be slightly increased.

5. barries of derezzed lightcycles should disappear immediatly. barries should use bezier curves to improve the animation. no flashing of the barriers. when a unit is selected a high-res version is displayed next to the stats. This version should reflect damage and slowly rotate 360 degrees. Going full distance for a unit increases the velocity and therefore the range, however turns can become impossiblte. A land unit can exit the map this way but derezzez automatically when colliding with the outer wall, or can also fall into the holes, which derezzez them also.  The models should have more details and look closer to the original tron design.

6. lightcycle can not cross walls from own team. there are gabs in the walls, but they should always be continues.  models should be even more details. tanks should not slide. turrets of tanks should be turnable and can only move very little, preventing them shooting in all directions. holes should be more visible. animation should be a little bit slower and increases very slightly per cycle.

7. There should be a bonus for attacking the same target more by multiple units per turn. mcp still sometimes moves the lightcycles through its own walls. recognizers should be a bit more armor. sometimes the model in the preview has no highlights. turets should be controlable.

8. damage in the unit card should also be visual. sound for each unit should reflect damage. heavy hit recognizers should have trouble flying and not be able to climb hights. cores must have more armor. walls should be smother, taking previous movements into accound for the bezier calculation. add a highscore system and add another map size which is quadrupal that of large. indicate velocity and also highlight unmoved units with a ui to cycle through them. allow to restart the same map and also quit the game. tanks should destroy walls by driving through them.

9. add healing hexes. non moving units can heal themselves, but very slowly. allow users to enter three letters for highscore name, if a new record has been reached. make damage animations visible in the unit cards.

10. make derezzing animations proportionate to the size of units. Allways show the derezzing of cores of the loosing side at the end of the game. Add multiplayer with simple logins (no passwords, just name). Allow to select if an opponent is an MCP or a player. Allow for all players being MCPs. Selecting the colour selects the sides. Allow for up many colours. A game is won, when all opposing cores have been destroyed. Add a real mcp interface to allow playing the game as a player. lightcycles should check for alternative routes before running into walls, if possible. starting side should be random. hight of recognizern should be controllable just as with tanks and turrets. Increasing the hight makes it unattackable from lightcycles, but they get more damage from rockets, yet the attack range of the recognizer increases.

11. players can be joined in fractions, winning together when all other cores are defeated. a score-card should be visible showing all fractions and players. a second unit card should show the targeted unit and the effect the hit has. sounds should vary more. each unit should have distinct base sounds. A core can also be conquered by a lightcycle. This requires a subsequent special attaclks for two turns and is a special attack. After a core has bgeen conquered it and all units of that core changes colour and become part of the conquering army. Tanks get a special push attack, which can push lightcycles into holes or walls.

12. the ai should use push and conquest. can you add ransom more music cues in the style of wendy carlos?  source and target unit cards should be shown.  add a few more light effects on the map.

13. can you add single player campaigns including a tutorial for units and their uses. Also a multichat system for players with optional audio which is also used for comments from the mcps on successful hits eyc, such as a simple "Yes/No" or "derezzed" all in the style of the first movie.

14. can you add energy streaks effects going through the hex grid gaps, just like with the square background-grid. can you also add the first 4 bars of the title music from tron as a random cue.

15. when an mcp ist part of a fraction with players, it should say things more in line with tron, i.e. "I fight for the users". The game should handle sessions for multiple games at once.  the top highscores should be displayed on the start screen. The synthetic voice seems to be not set to english. the flashes in the hex grid do not fully align with the gird, this seems to be a height issue. the chat window should be hideable, as well as other controls should be grouped in a menu.

16. can you support multiple players and games,  i.e. by generating unique urls which can be used to join a starting game, or to watch the game while it unfolds. the flash animation on the grid still seems wrong.

17. the invite button does not seem to work. can you add a pre-game lobby with a join url?

18. it should say "your turn" when you can control the units.

19. the turning mechanism for lightcycles should be refined to not allow 30 degree turns when going very fast going fast should require slowing before making extreem curves. The velocity should be kept between turns.  a longer sprint followed by a short step should enable controlling the speed.

## Phase 2 — Expansion, features & polish (Claude Opus 4.8)

20. change that the conquere success is limited to the same lightcycle. Once that is destroyed, the core defendet itself and the coquere count is reset.

21. can you add a build process creating a runnable docker image.

22. when a cycle is  pushed by a tank against its own wall, normal damage is applied and the wall is removed.

23. the scoring card should be sorted with the winner at the top. credits to spend should be awarded per core, so that when a core is conquered, it adds the per round credits. conquering a core, does not conquere all cores of the player.

24. a unit spawned by a core should also be conquered by the conquering player.

25. beginning of every round initialtive should be determined by random order, however not having done any action in the previous round gives a bonus for being first

26. when a tank turns, its turret should not follow automatically. 
   can you add more notes from the wendy carlos score.
   health hex should heal a unit completely after one round on top of it. the animation of the health hex should have a slow green particle stream going upwards.
   can you add a slow rotating animation for cores.
   when a tank cuts a wall, all parts not connected to the cycle are removed.

27. when starting the start animation should focus on your corner of the grid.
   when adding a combatant, the Team is TNaN or Tundefined, this is a bug.

28. target card should also show the model with stats, especially after the hit. if possible show the hit in more detail with variation on the destruction.

29. can you place the transmission underneath the highscore window and the target window on the right hand sind, making the menu next und end turn buttons central to the screen

30. turning turret buttons should be swapped.

31. i.e. the functions not the images

32. the animation in the card is not reflecting the turret change and restarts the animation with an anoying beep. please corrcect this and maybe add a low engine noise for rotating the turret.

33. reduce the movement of cycles to 4. 
   make sure that the whole map stays visible in the viewport, when zooming in at the start.

34. when creating units, they should be created to the selected core.

35. can you add some music very close to the original Theme from Tron (From "TRON"/Score) by Wendy Carlos to the start screen. Also a small "Created by Hauke von Bremen using Fabel 5 and Opus 4.8" at the bottom of the screen.

36. can you add an optional game-mode, where every combatant has to plan their moves and attacks and then these are executed simultainously

37. for simultainous mode, the execution phase must be sequentials, so not all explosion animations are at once. Maybe like in a chain-like fire-crackers for a fun effect.

38. for simultaineous mode, there is no need for initiative, i.e. output in the chat/transmissions.
   In sequential mode, the current initiative-order should be displayed more prominently at the top, but smaller that the top line with the turn info.

39. there is a bug with switching between game-modes, the enter lobby does not always reappear

40. can you add transitions between the menu screens, so it feels a bit like flying through the screen?

41. screens do not seem to be animated, maybe to quick?

42. hmm, not quite. It flashes to the game screen when going to a map size and back. the animation now fills the screen top to bottom, which is not right.

43. still looks like building top to bottom, not like a fly-through

44. can you make this more extreem, i.e. scaling to the point where one flies through the letters?

45. again, no animation is noticable. I can see it when you test it in the preview, but the running game does not exhibit any fly-through.

46. yes, its there now, however not quite correct: when you klick on large (for example) it should zoom in and switch, at the moment it zooms in and then back and then switches to the next screen. Which is more of a wobble effect.

47. nice! can you make the back and quit to menu transition in reverse so it feels like flying out again?

48. add another height level for recognizers. when at top level, the range increases by two, but any damage the get is increased by two as well. when at the top level, they can fly over other units. they can only go up or down one level per turn. health points do not work at top level. they can not fly over cores. when damaged they drop a level. if there is a unit underneath them when they drop down, both units take damage. tank turrets can be rotated up to 60 degrees per action.

49. yes improve the ai to use altitude. yes, I meant a budget for the turrets.

50. when the player controls the turrets they can be adjusted back and forth, but only to the maximum degree. so.

51. time to improve some animations: when tanks turn, this should be visible, turning like a real tank on the spot first. there are some decorative light beams poles outside of the actual map, can you add tesla-like flashes happening from time to time. tanks can also tilt when haven taken damage. cycles should have a little wobble, when damages, including the created walls.

52. the model for the wobbling cycle seems broken, can you fix it? Also destruction particles for cycles are now limited to a little square

53. the wall itself should not wobble, just when a damaged cycle creates a wall, it should be a little bit wavey. also reduce the woblle a bit, i.e. make it slower.

54. recognizers should also have a little swing/tilt motion, when turning, like a little bit of gravity effect.
   when removing a game from the start screen, it should not zoom in and out.
   when a cycle hits an enemy in overdrive it adds one damage.

55. yes, old behaviour of gliding over units should be reinstated

56. soften/reduce the titling of recognizers and slow it down, i.e. make it use something like bezier curves to smooth it out.

57. does not feel heavy enough. recognizers should have animation slowed and the tilt even more reduced.

58. recognizer sound should be much lower. recognizers do not turn before moving now.

59. when a core is attacked or when first conquered all connected units should flicker off and on

60. add another map size "EPIC" with 4x the hex from Gigantic

61. on epic maps animations should not be slowed down as much

62. can you create a demo-reel/video for the game, showcasing features and strategies for playing it?

63. can you create a classic mode, whereby everything looks like a 16bit isometric game?

64. can you add a replay option at the end, replaying the battle as it happened with a time-slider and special events marked such as core destructions etc? replays can also be saved and replayed in an extyra screen for replays. Camera movement should be like the demo-reel.

65. transition in and out of replays screen is missing

66. When recognizers turn to shoot, there is no rotation animation, or it is not visible.

67. can you make the timebar interactive in the replays, so one can click on it and it jumps to that time? atm this restarts the replay.

68. can you add another flying unit type that makes sense in the context of tron

69. nice,  the light jet needs smoother animation, when banking left and right and also should be creating two walls from the wing tips, but smaller. It should also be able to fly to the next levels up and downd. It should be immune from cycle attacks, except when on the ground. Basically, it is always flying until damaged. The walls have the same effects on cycles, when on the ground-level. jet walls can also be broken on the ground level with tanks.

70. jet walls should stay just as cycle walls do

71. jet walls must stay connected and form smooth curves, atm every move is a seoarate broken part.

72. jets need to be limited to their possible turning circle

73. the jet walls are now connected but when turning do not stay smooth. Use bezier cuirve to smooth them out

74. still jagged after stopping and selecting another target hex

75. when in 16bit mode, we need to be able to rotate the map

76. if a a jet or cycle have reached a higher velocity, they will have to move at least one hex in the next round. If they are not moved, then they will just go straight for one hex automatically, even if that means destruction

77. all models have a black colour with an additional highlight colour, can you change the black to a dark grey for better visibility

78. when flying for 4 hex straight, the animation of the jet should slowly rotate 360 degrees around the directionsal axis. this must also effect the walls and should give a nice flair.

79. jets must only be able to hit hexes in front of them so that no extra turning to shoot is unnecessay.

80. can you make the models even lighter, It still seems to be black

81. yes a bit darker please

82. a little bit darker

83. add another game mode, where the order is determined by per unit initiative.

84. intiative and simultaneous mode should also work with replay and remote play

85. can you expand the campaign to have more maps, but also add special units for different maps. One map should include a neutral core, that is idle until conquered. This map would be a capture the flag type campaign. Also add maps, where one one type of unit is present.

86. The title screen title "Grid Wars" is not quite aligned with the next row of buttons. Same with "Skirmish - Select Grid Size". Can you fix this?

87. can you optimize the drawing of the map by switching to using a shader to improve performance

88. the hex drawn by the shader are misalign and need to be rotated by one side

89. the cycle count at the top of the screen does not update when in simultaneous mode and epic map

90. in the campaign, the cycle does also not update

91. can you remove the sound on/off menu item and make it a button at the top right of every screen (use a small icon)

92. the third campaign map is not winable, maybe give the player more units.

93. let the mcp barks be displayed as fading text above the respective cores and keep the transmissions chat for players

94. yes, please broadcast all barks and chat messages to all

95. can you add another icon to the top of the game screen (next to the sound on/off toggle) for toggling the instructions on and off  (info icon)

96. can you add an undo mechanism and button, that allows you to undo a unit-moves, but only enable it if the units have not been damaged, destroyed or have attackt other units and of cause if units have been moved,.

97. the instruction icon should only be visible while playing the game, not on the start screens etc.

98. camera movement when focussing on an unit (for example when doing undo or next unit) should not rotate, as it disorients the player

99. on the replay screen, there is a button for save, which makes no sense, Replace the button with an option to restart the map as a new game.

100. When starting a game add an option to change settings for the game: this should include unit values for damage, costs, movements and  build credits etc.

101. is the game reactive, i.e. works on small screens? does it support touch?

102. yes, all

103. do the jet walls actually prevent flying through?

104. yes, recos can break them, just like tanks for cycles. fly through is deadly.

105. please make AI aware of the jet-walls

106. please add offensive ai behaviour

107. when rejoining an active grid, the units orientation is reset and as originally. I think the game does not keep the orientation when saving the active grid

108. are walls also restored? if not, please add them.

109. yes please store the per-segment control points. It would also be nice to store particles, or maybe an approximation...

110. it seems impossible to win in 5. campain grid. any suggestions?

111. when a last player exists a game, does that game continue running?

112. yes

113. Can you add another size map "Manic" with 4 times the size of Epic.

114. the manic map is sometimes cut off, so the viewport depth needs to be increased

115. the sound icon for no sound looks wrong, I think the slash should go across the loadspeaker icon?

116. can you swap the order of the campain and proving ground buttons on the start screen.
   can you add a light/dark-mode icon toggle next to the sound icon  and implement a light mode with light gray background with dark writing a more classic 3D application look (see lightwave for the Amiga)

117. for the 16bit visuals, can you find a to improve the visuals, for example add dark borders around units and add definition to the hex map.

118. 16bit is still very fuzzy, any ideas to improve it?

119. This seems worse. Maybe a higher resolution and better colours.

120. jfor 16bit mode the base tile colour should be light grey in both modes

121. maybe try dark blue

122. can you reduce the border colour for the map hexes to a single colour?

123. 16bit still is not clean for the map hex borders, this is probably due to zooming out

124. rendering of cycle walls generates zaggy lines, no more smooth bezier curves

125. can you remove the camera control restrictions in classic mode

126. the zagged cycle walls are a problem of modern mode only. classic mode is fine

127. still no smooth walls in modern mode and also jets are missing the waals

128. when a unit is destroyed the target card vanishes, could we have an explosion animation of the model instead?

129. can you keep the target card a bit longer before hiding it

130. also keep target card visible longer after just damaging the target

131. can update the readme with all the additions that have been made. Also add a section on the battle mechanics including the default values for units etc.

132. can you use git to commit your changes?

133. yes add a github remote

134. done

135. go

136. try again

137. go

138. can you create the docker file on docker hub with an instructional setup readme?

139. go

140. can you add a disclaimer to the readme and docker md formally warning that this is untested software fully generated by an ai and not fit for any purpose... i.e. use at own risk.

141. can you add screenshots to the repository description? (and if possible to docker hub)

142. can you extract all the prompts and models used to generate this project into a sequential prompts.md file? Maybe create a extensive createPrompt.md file that could be used to recreate the whole project as is in a single structured prompt. Can you also add instructions and links to docker hub for easy installation to the readme.
   can you add an info screen, displaying the readme within the game.

---

_Total: 142 prompts. Generated from the Claude Code session
transcripts for this project._
