<script lang="ts">
  import { tick } from 'svelte';
  import { t } from '../i18n/index.ts';
  import type { Chapter } from '../protocol.gen.ts';
  import { modal } from '../theme/modal.ts';
  import { numeral } from '../tutorial/chapters.ts';
  import SealMark from '../app/tutorial/SealMark.svelte';
  import { chapterKicker, chapterName } from '../app/tutorial/texts.ts';

  interface Props {
    chapter: Chapter;
    /** The chapter's clock ran out (IV): won by VP, said under the title (#1054). */
    byClock?: boolean;
    /** "All chapters" (primary): the chapter select. */
    onchapters: () => void;
    /** "Replay chapter" (secondary): the chapter again at once. */
    onreplay: () => void;
  }

  let { chapter, byClock = false, onchapters, onreplay }: Props = $props();

  let primary: HTMLButtonElement | undefined = $state();
  $effect(() => {
    void tick().then(() => primary?.focus());
  });
</script>

<!-- The chapter result (Seal, docs/design/tutorial.md section 8): a stone window over the chapter's
     last moment, the seal with the chapter numeral, "Complete" and two buttons (round 4: no "Next
     chapter", no "First match"; the player goes on from the chapter select). The result only: the
     lessons went with the attention review (#1075), the next chapter's actions are the review. -->
<div class="dim">
  <div
    class="window rule-frame"
    role="dialog"
    aria-modal="true"
    aria-labelledby="seal-title"
    aria-describedby={byClock ? 'seal-lab seal-by-clock' : 'seal-lab'}
    tabindex="-1"
    use:modal={{ onclose: onchapters }}
  >
    <SealMark n={numeral(chapter)} advanced={chapter.road === 'advanced'} />
    <p class="lab" id="seal-lab">{chapterKicker(chapter)} · {chapterName(chapter)}</p>
    <h2 id="seal-title">{t('tutorial.result.title')}</h2>
    {#if byClock}
      <p class="by-clock" id="seal-by-clock">{t('tutorial.result.byClock')}</p>
    {/if}
    <div class="acts">
      <button type="button" class="lapis-btn primary" bind:this={primary} onclick={onchapters}
        >{t('tutorial.allChapters')}</button
      >
      <button type="button" class="lapis-btn secondary" onclick={onreplay}
        >{t('tutorial.result.replay')}</button
      >
    </div>
  </div>
</div>

<style>
  .dim {
    position: absolute;
    inset: 0;
    z-index: 25;
    display: grid;
    place-items: center;
    padding: 16px;
    background: rgb(8 7 6 / 58%);
    pointer-events: auto;
  }

  .window {
    position: relative;
    box-sizing: border-box;
    width: min(660px, 100%);
    padding: 58px 52px 40px;
    background: var(--stone-tex) var(--stone-panel);
    box-shadow: 0 30px 60px rgb(0 0 0 / 55%);
    color: var(--ink);
    text-align: center;
    animation: sheet-in 0.7s var(--ease-settle) both;
  }

  .window:focus {
    outline: none;
  }

  .window > :global(.seal) {
    position: absolute;
    left: 50%;
    top: 0;
    transform: translate(-50%, -50%);
  }

  @keyframes sheet-in {
    from {
      opacity: 0;
      transform: translateY(16px);
    }
  }

  .lab {
    margin: 0;
    font: 500 11.5px/1.3 var(--font-display);
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--ink-dim);
  }

  h2 {
    margin: 6px 0 10px;
    font: 500 34px/1.1 var(--font-display);
    letter-spacing: 0.06em;
  }

  .by-clock {
    margin: 0;
    font: italic 500 17px/1.35 var(--font-text);
    color: var(--ink);
  }

  .acts {
    display: flex;
    margin-top: 30px;
    flex-wrap: wrap;
    justify-content: center;
    gap: 14px 20px;
  }

  .acts .lapis-btn {
    height: 50px;
    min-width: 210px;
  }

  :global(:root[data-motion='reduced']) .window {
    animation: none;
  }
</style>
