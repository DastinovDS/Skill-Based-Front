<script lang="ts">
  import { BOT_LEVELS, type BotLevel } from '../api/http.ts';
  import { t, tf } from '../i18n/index.ts';
  import { BOT_CELLS, BOT_STYLES } from './botStyles.ts';

  interface Props {
    value: BotLevel;
    onchange: (level: BotLevel) => void;
  }

  let { value, onchange }: Props = $props();

  const style = $derived(BOT_STYLES[value]);

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

<!-- svelte-ignore a11y_interactive_supports_focus -->
<div class="sg" role="radiogroup" aria-label={t('bot.level')} {onkeydown}>
  {#each BOT_LEVELS as level (level)}
    <button
      type="button"
      role="radio"
      aria-checked={value === level}
      tabindex={value === level ? 0 : -1}
      class:on={value === level}
      onclick={() => {
        onchange(level);
      }}>{t(`bot.level.${level}`)}</button
    >
  {/each}
</div>
<div class="lvdesc" aria-live="polite">
  <div class="l1">
    <b>{t(style.style)}</b>
    <span
      class="cells d"
      role="img"
      aria-label={tf('bot.difficultyAria', { level: t(`bot.level.${value}`), total: BOT_CELLS })}
    >
      {#each Array.from({ length: BOT_CELLS }, (_, i) => i) as i (i)}
        <i class:on={i < style.cells}></i>
      {/each}
    </span>
  </div>
  <div class="ds">{t(style.desc)}</div>
</div>
