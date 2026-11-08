<script lang="ts">
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

  let {
    nick,
    hasPassword,
    calibration,
    rating = null,
    open,
    disabled = false,
    ontoggle,
  }: Props = $props();
</script>

<!-- The player in the corner (Lapis, #845): the nick in cut capitals, the standing in italics
     ("Guest", "Calibration 3/5", the rating). The words carry the state, never colour alone. -->
<button
  type="button"
  class="who"
  aria-haspopup="menu"
  aria-expanded={open}
  aria-controls="account-menu"
  {disabled}
  onclick={ontoggle}
>
  <b class="nick">{nick}</b>
  {#if !hasPassword}
    <span class="st">{t('menu.guest')}</span>
  {:else if calibration !== null}
    <span class="st"
      >{tf('menu.calibration', { played: calibration.played, total: calibration.total })}</span
    >
  {:else if rating === null}
    <span class="st">{t('menu.ranked')}</span>
  {:else}
    <span class="st" title={t('menu.rating')}>{rating}</span>
  {/if}
</button>
