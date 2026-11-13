<script lang="ts">
  import { t } from '../../i18n/index.ts';
  import LapisButton from '../../theme/LapisButton.svelte';
  import { modal } from '../../theme/modal.ts';

  interface Props {
    /** "Start the tutorial" (true) or "Not now" / Esc (false), with the box "Don't show again". */
    onanswer: (start: boolean, off: boolean) => void;
  }

  let { onanswer }: Props = $props();

  let off = $state(false);
  const uid = $props.id();
</script>

<!-- The entry popup (#806, round 5; docs/design/tutorial.md section 3, "Entry"): the client's stone
     dialog over the main screen offers the tutorial; nothing is forced, the main button stays. -->
<div class="dim">
  <div
    class="stone-window rule-frame offer"
    role="dialog"
    aria-modal="true"
    aria-labelledby="{uid}-title"
    aria-describedby="{uid}-body"
    tabindex="-1"
    use:modal={{
      onclose: () => {
        onanswer(false, off);
      },
    }}
  >
    <p class="kicker">{t('tutorial.offer.eyebrow')}</p>
    <h2 class="dlg-h" id="{uid}-title">{t('tutorial.offer.title')}</h2>
    <p class="dlg-p body" id="{uid}-body">{t('tutorial.offer.body')}</p>
    <label class="check">
      <input type="checkbox" bind:checked={off} />
      <span class="box" aria-hidden="true"></span>
      {t('tutorial.offer.off')}
    </label>
    <div class="dlg-acts acts">
      <LapisButton
        onclick={() => {
          onanswer(false, off);
        }}>{t('tutorial.offer.later')}</LapisButton
      >
      <LapisButton
        variant="primary"
        onclick={() => {
          onanswer(true, off);
        }}>{t('tutorial.offer.start')}</LapisButton
      >
    </div>
  </div>
</div>

<style>
  /* The main screen stays in view, dimmed (the walkthrough's E.1), as under the match dialogs. */
  .dim {
    position: fixed;
    inset: 0;
    z-index: 30;
    display: grid;
    place-items: center;
    padding: 24px;
    background: rgb(8 7 6 / 58%);
  }

  .offer {
    width: min(560px, 100%);
    padding: 40px 46px 34px;
    text-align: center;
    animation: offer-in 0.5s var(--ease-settle) both;
  }

  @keyframes offer-in {
    from {
      opacity: 0;
      transform: translateY(12px);
    }
  }

  :global(:root[data-motion='reduced']) .offer {
    animation: none;
  }

  .offer .dlg-h {
    margin: 8px 0 12px;
    font-size: 30px;
    letter-spacing: 0.05em;
  }

  .body {
    margin: 0 0 20px;
    font-size: 19px;
    color: var(--ink-soft);
  }

  /* "Don't show again": a native checkbox drawn as an engraved box, an ivory check when ticked. */
  .check {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 12px;
    min-height: 44px;
    margin: 0 0 6px;
    font: 500 18px/1.2 var(--font-text);
    color: var(--ink-soft);
    cursor: pointer;
  }

  .check:hover {
    color: var(--ink);
  }

  .check input {
    position: absolute;
    left: 0;
    top: 50%;
    width: 20px;
    height: 20px;
    margin: -10px 0 0;
    opacity: 0;
    cursor: pointer;
  }

  .box {
    position: relative;
    flex: none;
    width: 20px;
    height: 20px;
    background: var(--plate);
    box-shadow:
      inset 0 0 0 1px var(--ink-soft),
      inset 0 0 0 3px var(--plate),
      inset 0 0 0 4px rgb(236 228 209 / 22%);
  }

  .check input:checked + .box {
    background: var(--ink);
    box-shadow:
      inset 0 0 0 1px var(--ink),
      0 0 0 1px var(--cut);
  }

  .check input:checked + .box::after {
    content: '';
    position: absolute;
    left: 6.5px;
    top: 2.5px;
    width: 5px;
    height: 10px;
    border: solid var(--stone-bg);
    border-width: 0 2px 2px 0;
    transform: rotate(45deg);
  }

  .check input:focus-visible + .box {
    outline: 2px solid var(--ink);
    outline-offset: 3px;
  }

  .acts {
    justify-content: center;
    margin-top: 18px;
  }
</style>
