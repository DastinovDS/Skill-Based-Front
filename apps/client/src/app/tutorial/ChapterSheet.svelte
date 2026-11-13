<script lang="ts">
  import { t, tf, type MessageKey } from '../../i18n/index.ts';
  import type { ChapterId, MapFile } from '../../protocol.gen.ts';
  import { chapterOf, numeral } from '../../tutorial/chapters.ts';
  import MenuBackdrop from '../MenuBackdrop.svelte';
  import ChapterMap from './ChapterMap.svelte';
  import { chapterLength, chapterName, chapterWhy, goalsOf } from './texts.ts';

  interface Props {
    chapter: ChapterId;
    /** The map behind the blurred stone (the main screen's). */
    map: MapFile | null;
    /** Start: a fresh match of the chapter; the answer is the line to show when it failed. */
    onstart: () => Promise<MessageKey | null>;
    /** "All chapters" and Esc: the chapter select. */
    onchapters: () => void;
  }

  let { chapter, map, onstart, onchapters }: Props = $props();

  const file = $derived(chapterOf(chapter));
  const main = $derived(file.road === 'main');
  let busy = $state(false);
  let failure = $state<MessageKey | null>(null);
  let start: HTMLButtonElement | undefined = $state();

  $effect(() => {
    start?.focus();
  });

  async function go(): Promise<void> {
    if (busy) return;
    busy = true;
    failure = null;
    try {
      failure = await onstart();
    } finally {
      busy = false;
    }
  }

  function onkeydown(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.key !== 'Escape') return;
    event.preventDefault();
    onchapters();
  }
</script>

<svelte:window {onkeydown} />

<!-- The intro of a chapter (Sheet, docs/design/tutorial.md section 8): a stone sheet on the blurred
     main screen, the goals and a crop of the chapter's map with them ringed; no row of chapters. -->
<main class="front intro">
  <MenuBackdrop {map} phase="idle" />
  <div class="blurstone"></div>
  <section class="sheet rule-frame" aria-labelledby="sheet-title">
    <div class="text">
      <p class="kicker">
        {tf(main ? 'tutorial.sheet.kicker' : 'tutorial.sheet.kickerAdvanced', { n: numeral(file) })}
      </p>
      <h1 id="sheet-title">{chapterName(file)}</h1>
      <p class="why">{chapterWhy(file)}</p>
      <p class="kicker lapis-section goal">{t('tutorial.sheet.goal')}</p>
      <ul class="goals">
        {#each goalsOf(chapter) as goal, i (i)}
          <li><span class="lz" aria-hidden="true"></span>{goal}</li>
        {/each}
      </ul>
      {#if failure !== null}
        <p class="failure" role="alert">{t(failure)}</p>
      {/if}
      <div class="acts">
        <button
          type="button"
          class="lapis-btn primary"
          disabled={busy}
          aria-busy={busy}
          onclick={() => {
            void go();
          }}
          bind:this={start}
          >{busy ? t('tutorial.sheet.starting') : t('tutorial.sheet.start')}</button
        >
        <button type="button" class="quiet" onclick={onchapters}>{t('tutorial.allChapters')}</button
        >
      </div>
    </div>
    <ChapterMap chapter={file} caption={chapterLength(file)} />
  </section>
</main>

<style>
  .intro {
    position: fixed;
    inset: 0 0 var(--legal-footer-h);
    overflow: auto;
  }

  .blurstone {
    position: absolute;
    inset: 0;
    background: var(--stone-tex) rgb(22 19 15 / 80%);
    backdrop-filter: blur(9px) saturate(0.55);
  }

  .sheet {
    position: absolute;
    left: 50%;
    top: 50%;
    box-sizing: border-box;
    width: min(980px, calc(100% - 32px));
    transform: translate(-50%, -50%);
    display: grid;
    grid-template-columns: 1fr 420px;
    column-gap: 46px;
    padding: 44px 52px 40px;
    background: var(--stone-tex) var(--stone-panel);
    box-shadow: 0 30px 60px rgb(0 0 0 / 50%);
    color: var(--ink);
    animation: sheet-in 0.7s var(--ease-settle) both;
  }

  @keyframes sheet-in {
    from {
      opacity: 0;
      transform: translate(-50%, -46%);
    }
  }

  .kicker {
    margin: 0;
    font: 500 11.5px/1.3 var(--font-display);
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--ink-dim);
  }

  h1 {
    margin: 10px 0 14px;
    font: 500 44px/1.06 var(--font-display);
    letter-spacing: 0.04em;
  }

  .why {
    margin: 0 0 22px;
    font: italic 500 20px/1.38 var(--font-text);
    color: var(--ink-soft);
  }

  .goal {
    margin-bottom: 12px;
  }

  .goals {
    display: grid;
    gap: 9px;
    margin: 0 0 26px;
    padding: 0;
    list-style: none;
  }

  .goals li {
    display: flex;
    align-items: center;
    gap: 12px;
    font: 500 19px/1.25 var(--font-text);
  }

  .lz {
    flex: none;
    width: 7px;
    height: 7px;
    transform: rotate(45deg);
    box-shadow: 0 0 0 1px var(--ink-soft);
  }

  .failure {
    margin: -10px 0 16px;
    font: italic 500 17px/1.3 var(--font-text);
    color: var(--warn);
  }

  .acts {
    display: flex;
    align-items: center;
    gap: 28px;
  }

  .quiet {
    border: 0;
    background: none;
    padding: 2px 0;
    color: var(--ink-soft);
    font: italic 500 18px/1.2 var(--font-text);
    text-decoration: underline;
    text-decoration-thickness: 1px;
    text-underline-offset: 4px;
    text-decoration-color: var(--rule);
    cursor: pointer;
  }

  .quiet:hover {
    color: var(--ink);
    text-decoration-color: var(--ink-soft);
  }

  .quiet:focus-visible {
    outline: 2px solid var(--ink);
    outline-offset: 3px;
  }

  @media (max-width: 900px) {
    .sheet {
      grid-template-columns: 1fr;
      row-gap: 24px;
      top: 24px;
      transform: translateX(-50%);
    }

    .sheet :global(.mapcard) {
      width: 100%;
    }
  }

  :global(:root[data-motion='reduced']) .sheet {
    animation: none;
  }
</style>
