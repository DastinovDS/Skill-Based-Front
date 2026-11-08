<script lang="ts">
  import { BOT_LEVELS, type BotLevel } from '../api/http.ts';
  import { t, tf } from '../i18n/index.ts';
  import { BOT_CELLS, BOT_STYLES } from './botStyles.ts';

  interface Props {
    value: BotLevel;
    onchange: (level: BotLevel) => void;
  }

  let { value, onchange }: Props = $props();

  /** Arrow keys move the level, like a radio group. */
  function onkeydown(event: KeyboardEvent): void {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (step === 0) return;
    const next =
      BOT_LEVELS[Math.max(0, Math.min(BOT_LEVELS.length - 1, BOT_LEVELS.indexOf(value) + step))];
    if (next === undefined) return;
    event.preventDefault();
    onchange(next);
    const group = event.currentTarget;
    if (group instanceof HTMLElement) {
      queueMicrotask(() => {
        group.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
      });
    }
  }
</script>

<!-- The four levels in a row (Lapis, #845): the difficulty as lozenges, the level, the style of
     the bot in italics. Spare captions: no description. -->
<!-- svelte-ignore a11y_interactive_supports_focus -->
<div class="sg levels" role="radiogroup" aria-label={t('bot.level')} {onkeydown}>
  {#each BOT_LEVELS as level (level)}
    {@const style = BOT_STYLES[level]}
    <button
      type="button"
      class="level"
      role="radio"
      aria-checked={value === level}
      tabindex={value === level ? 0 : -1}
      onclick={() => {
        onchange(level);
      }}
    >
      <span
        class="pips"
        role="img"
        aria-label={tf('bot.difficultyAria', { level: style.cells, total: BOT_CELLS })}
      >
        {#each Array.from({ length: BOT_CELLS }, (_, i) => i) as i (i)}
          <i class:on={i < style.cells}></i>
        {/each}
      </span>
      <span class="lv">{t(`bot.level.${level}`)}</span>
      <span class="ls">{t(style.style)}</span>
    </button>
  {/each}
</div>
