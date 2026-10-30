import type { BotLevel } from '../api/http.ts';
import type { MessageKey } from '../i18n/index.ts';

/**
 * What the screen says about each bot level: the style (the registry name of the smart bot behind the level, with its tempo level),
 * a one-line description and the difficulty in cells. The `bot` ids are the four bots (`personality@level`) of
 * `LEVEL_BOTS` in apps/server/src/gow_server/botmatch.py; `apps/server/tests/test_bot_styles.py` fails
 * when the server maps a level to another bot, so the lines cannot drift silently.
 */
export interface BotStyle {
  readonly bot: string;
  readonly style: MessageKey;
  readonly desc: MessageKey;
  /** Difficulty, 1 to `BOT_CELLS`. */
  readonly cells: number;
}

export const BOT_CELLS = 4;

export const BOT_STYLES: Readonly<Record<BotLevel, BotStyle>> = {
  easy: { bot: 'smart_turtle@easy', style: 'bot.style.easy', desc: 'bot.desc.easy', cells: 1 },
  normal: {
    bot: 'smart_reactive@easy',
    style: 'bot.style.normal',
    desc: 'bot.desc.normal',
    cells: 2,
  },
  hard: { bot: 'smart_strangler@hard', style: 'bot.style.hard', desc: 'bot.desc.hard', cells: 3 },
  expert: {
    bot: 'smart_expander@hard',
    style: 'bot.style.expert',
    desc: 'bot.desc.expert',
    cells: 4,
  },
};
