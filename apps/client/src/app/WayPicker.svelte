<script lang="ts">
  import type { Snippet } from 'svelte';
  import { t } from '../i18n/index.ts';
  import { stepWay, WAY_LABEL, WAYS, type Way } from './play.ts';
  import WaySign from './WaySign.svelte';

  interface Props {
    way: Way;
    onchoose: (way: Way) => void;
    /** A match is running: the ways are shown, not chosen. */
    disabled?: boolean;
    /** The options line under the ways (the pause rule, the queue lock). */
    options: Snippet;
  }

  let { way, onchoose, disabled = false, options }: Props = $props();

  const at = $derived(WAYS.indexOf(way));
  /** The way under the pointer: a hollow marker over it (#919, item 8). */
  let hover = $state<number | null>(null);
  let group: HTMLElement | undefined = $state();

  /** Arrow keys move the choice, like a radio group. */
  function onkeydown(event: KeyboardEvent): void {
    const step =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? -1
          : 0;
    if (step === 0 || disabled) return;
    event.preventDefault();
    const next = stepWay(way, step);
    if (next === way) return;
    onchoose(next);
    queueMicrotask(() => {
      group?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
    });
  }
</script>

<!-- The three ways (#919, III Plinth): a radio group; the chosen one is ink with the marker (a
     lozenge on a rule) over it, the others dim, so the choice is shape and brightness, never colour
     alone: the signs (an hourglass, a cog, a chain link, #968) are ink only. The marker travels to a new choice; the hovered way gets a hollow marker. -->
<div class="mode">
  <!-- svelte-ignore a11y_interactive_supports_focus -->
  <div
    bind:this={group}
    class="segs"
    role="radiogroup"
    aria-label={t('play.ways')}
    aria-disabled={disabled}
    {onkeydown}
    style:--at={at}
    style:--hover={hover ?? at}
  >
    <span class="mk" aria-hidden="true"></span>
    <span class="mk ghost" class:on={hover !== null && hover !== at} aria-hidden="true"></span>
    {#each WAYS as id, i (id)}
      <button
        type="button"
        class="seg"
        role="radio"
        aria-checked={id === way}
        tabindex={id === way ? 0 : -1}
        {disabled}
        onpointerenter={() => {
          hover = i;
        }}
        onpointerleave={() => {
          hover = null;
        }}
        onclick={() => {
          if (id !== way) onchoose(id);
        }}
      >
        <span class="icons" aria-hidden="true">
          <WaySign way={id} />
        </span>
        <span class="sl ink">{t(WAY_LABEL[id])}</span>
      </button>
    {/each}
  </div>
  <div class="optl">{@render options()}</div>
</div>
