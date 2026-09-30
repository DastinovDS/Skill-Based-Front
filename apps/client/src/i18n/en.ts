import type { Messages } from './messages.ts';

// English UI dictionary. `satisfies Messages` makes a missing or an extra key a type error.
export const en = {
  'app.title': 'Skill-Based Front',
  'hud.map': 'Map',
  'hud.fitMap': 'Fit map',
  'hud.cameraHint': 'Drag: pan the map. Wheel: zoom at the cursor.',
  'hud.legend':
    'Blue with one ring: player 1, orange with a double ring: player 2, grey: nobody. Star: capital, number: VP. Icons: forest, mountains.',
  'hud.fps': 'FPS',
  'hud.language': 'Language',
  'language.self': 'English',
  'error.renderer': 'Could not start the map renderer',
} satisfies Messages;
