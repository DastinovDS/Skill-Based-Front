// Russian UI dictionary. Every user-visible string of the client lives here or in the dictionaries
// of the other languages (AGENTS.md §7.4); `en.ts` must have exactly the same keys.
export const ru = {
  'app.title': 'Skill-Based Front',
  'hud.map': 'Карта',
  'hud.fitMap': 'Вписать карту',
  'hud.cameraHint': 'Перетаскивание: сдвиг карты. Колесо: масштаб у курсора.',
  'hud.legend':
    'Синий с одним кольцом: игрок 1, оранжевый с двойным кольцом: игрок 2, серый: ничей. Звезда: столица, цифра: VP. Значки: лес, горы.',
  'hud.fps': 'FPS',
  'hud.language': 'Язык',
  // The name of the language in the language itself: the switcher shows each option this way.
  'language.self': 'Русский',
  'error.renderer': 'Не удалось запустить отрисовку карты',
} as const;
