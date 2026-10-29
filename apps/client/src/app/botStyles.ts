import type { BotLevel } from '../api/http.ts';
import type { MessageKey } from '../i18n/index.ts';

/**
 * What the screen says about each bot level: the style (the name of the bot behind the level),
 * a one-line description and the difficulty in cells. The `bot` ids are the four bots of
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
  easy: { bot: 'turtle', style: 'bot.style.easy', desc: 'bot.desc.easy', cells: 1 },
  normal: { bot: 'reactive', style: 'bot.style.normal', desc: 'bot.desc.normal', cells: 2 },
  hard: { bot: 'expander', style: 'bot.style.hard', desc: 'bot.desc.hard', cells: 3 },
  expert: { bot: 'rusher', style: 'bot.style.expert', desc: 'bot.desc.expert', cells: 4 },
};
