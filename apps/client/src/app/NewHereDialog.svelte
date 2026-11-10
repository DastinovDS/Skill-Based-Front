<script lang="ts">
  import { t } from '../i18n/index.ts';
  import LapisButton from '../theme/LapisButton.svelte';
  import StoneOverlay from '../theme/StoneOverlay.svelte';
  import DrawingGraph from './DrawingGraph.svelte';

  interface Props {
    /** "Learn how to play" (true) or "Not now" (false), with the "Don't show this again" tick. */
    onclose: (learn: boolean, never: boolean) => void;
  }

  let { onclose }: Props = $props();

  let never = $state(false);
</script>

<!-- "New here? Learn how to play" (#919, item 6), right after the nick is entered: a window on the
     blurred stone with the finished drawing sketch. Off until the tutorial round (#806) exists:
     `NEW_HERE_ENABLED` in play.ts. -->
<StoneOverlay
  label={t('newHere.title')}
  onclose={() => {
    onclose(false, never);
  }}
>
  <div class="pic"><DrawingGraph width={200} still /></div>
  <h2 class="dlg-h">{t('newHere.title')}</h2>
  <p class="dlg-p">{t('newHere.text')}</p>
  <div class="dlg-acts">
    <LapisButton
      variant="primary"
      onclick={() => {
        onclose(true, never);
      }}>{t('newHere.learn')}</LapisButton
    >
    <LapisButton
      onclick={() => {
        onclose(false, never);
      }}>{t('newHere.later')}</LapisButton
    >
  </div>
  <label class="chk">
    <input type="checkbox" bind:checked={never} />
    {t('newHere.never')}
  </label>
</StoneOverlay>

<style>
  .pic {
    display: flex;
    justify-content: center;
    margin: -8px 0 20px;
  }

  .chk {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-top: 22px;
    font-size: 17px;
    color: var(--ink-soft);
    cursor: pointer;
  }

  /* The tick: a small square in the quiet frame, an ink check when it is on (not colour alone). */
  .chk input {
    appearance: none;
    flex: none;
    width: 18px;
    height: 18px;
    margin: 0;
    background:
      linear-gradient(var(--rule), var(--rule)) 0 0 / 100% 1px no-repeat,
      linear-gradient(var(--rule), var(--rule)) 0 100% / 100% 1px no-repeat,
      linear-gradient(var(--rule), var(--rule)) 0 0 / 1px 100% no-repeat,
      linear-gradient(var(--rule), var(--rule)) 100% 0 / 1px 100% no-repeat;
    cursor: pointer;
  }

  .chk input:checked {
    background:
      linear-gradient(var(--ink), var(--ink)) 0 0 / 100% 1px no-repeat,
      linear-gradient(var(--ink), var(--ink)) 0 100% / 100% 1px no-repeat,
      linear-gradient(var(--ink), var(--ink)) 0 0 / 1px 100% no-repeat,
      linear-gradient(var(--ink), var(--ink)) 100% 0 / 1px 100% no-repeat,
      linear-gradient(var(--ink), var(--ink)) 4px 4px / 8px 8px no-repeat;
  }

  .chk input:focus-visible {
    outline: 2px solid var(--ink);
    outline-offset: 3px;
  }
</style>
