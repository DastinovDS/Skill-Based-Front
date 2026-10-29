<script lang="ts">
  import Icon from '../hud/Icon.svelte';
  import { t, tf } from '../i18n/index.ts';
  import type { Calibration } from '../protocol.gen.ts';

  interface Props {
    nick: string;
    hasPassword: boolean;
    /** Progress of the first ranked matches (DEC-34); null once it is over or for a guest. */
    calibration: Calibration | null;
    /** The displayed rating of a ranked account (#78), null while unknown; the chip then says "Ranked". */
    rating?: number | null;
    open: boolean;
    /** The chip only shows the player (the account menu is off, e.g. in a waiting room). */
    disabled?: boolean;
    ontoggle: () => void;
  }

  let { nick, hasPassword, calibration, rating = null, open, disabled = false, ontoggle }: Props = $props();
</script>

<!-- The rating and the calibration live here and nowhere else on the menu (#471). Calibration is
     cells (filled or empty) plus the numbers, never colour alone. -->
<button
  type="button"
  class="who"
  aria-haspopup="menu"
  aria-expanded={open}
  aria-controls="account-menu"
  {disabled}
  onclick={ontoggle}
>
  {#if !hasPassword}
    <Icon name="user" size={18} />
    <b class="nick">{nick}</b>
    <span class="chip">{t('menu.guest')}</span>
  {:else if calibration !== null}
    <b class="nick">{nick}</b>
    <span
      class="cells"
      role="img"
      aria-label={tf('menu.calibrationAria', {
        played: calibration.played,
        total: calibration.total,
      })}
    >
      {#each Array.from({ length: calibration.total }, (_, i) => i) as i (i)}
        <i class:on={i < calibration.played}></i>
      {/each}
    </span>
    <span class="cap"
      >{tf('menu.calibration', { played: calibration.played, total: calibration.total })}</span
    >
  {:else}
    <b class="nick">{nick}</b>
    {#if rating === null}
      <span class="cap">{t('menu.ranked')}</span>
    {:else}
      <span class="score"
        ><span class="num">{rating}</span><span class="cap">{t('menu.rating')}</span></span
      >
    {/if}
  {/if}
</button>
