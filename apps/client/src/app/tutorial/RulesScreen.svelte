<script lang="ts">
  import SheetFrame from '../../board/SheetFrame.svelte';
  import { getLocale, t } from '../../i18n/index.ts';
  import type { MapFile, RulesetPublic } from '../../protocol.gen.ts';
  import { reducedMotion } from '../../render/motion.ts';
  import RuleFrame from '../../theme/RuleFrame.svelte';
  import { rulesSections } from '../../tutorial/rules.ts';

  interface Props {
    nick: string;
    hasPassword: boolean;
    map: MapFile | null;
    /** The numbers of the main ruleset (`GET /api/ruleset`). */
    load: () => Promise<RulesetPublic>;
    onprofile: () => void;
    /** "Back to chapters" and Esc: the chapter select it was opened from. */
    onback: () => void;
  }

  let { nick, hasPassword, map, load, onprofile, onback }: Props = $props();

  let rules = $state.raw<RulesetPublic | null>(null);
  let failed = $state(false);

  async function read(): Promise<void> {
    failed = false;
    try {
      rules = await load();
    } catch {
      failed = true;
    }
  }

  $effect(() => {
    void read();
  });

  const sections = $derived(rules === null ? [] : rulesSections(rules, getLocale()));

  function onkeydown(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key !== 'Escape') return;
    event.preventDefault();
    onback();
  }
</script>

<svelte:window {onkeydown} />

<!-- The rules reference (#806, docs/design/tutorial.md section 6, walkthrough R.4): one stone sheet
     of short sections in two columns, the numbers from the main ruleset. -->
<SheetFrame
  {map}
  label={t('rules.title')}
  player={{ nick, guest: !hasPassword, onprofile }}
  onhelp={onback}
  helpHere
>
  <RuleFrame
    as="section"
    class={reducedMotion() ? 'rules still' : 'rules'}
    aria-labelledby="rules-title"
  >
    <header>
      <div>
        <p class="kicker">{t('rules.eyebrow')}</p>
        <h2 id="rules-title">{t('rules.title')}</h2>
      </div>
      <button type="button" class="quiet" aria-keyshortcuts="Escape" onclick={onback}
        >{t('rules.back')}</button
      >
    </header>
    {#if rules !== null}
      <div class="cols">
        {#each sections as section (section.id)}
          <section aria-labelledby="rules-{section.id}">
            <h3 id="rules-{section.id}">{section.title}</h3>
            <p>{section.text}</p>
          </section>
        {/each}
      </div>
    {:else if failed}
      <p class="state" role="alert">
        {t('rules.failed')}
        <button
          type="button"
          class="quiet"
          onclick={() => {
            void read();
          }}>{t('rules.retry')}</button
        >
      </p>
    {:else}
      <p class="state" role="status">{t('rules.loading')}</p>
    {/if}
  </RuleFrame>
</SheetFrame>

<style>
  :global(.front.sheet .rules) {
    box-sizing: border-box;
    max-width: 1280px;
    margin: 0 auto;
    padding: 28px 44px 24px;
    color: var(--ink);
    box-shadow: 0 26px 60px rgb(0 0 0 / 55%);
    animation: rules-in 0.5s var(--ease-settle) both;
  }

  @keyframes rules-in {
    from {
      opacity: 0;
    }
  }

  header {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 24px;
    margin-bottom: 16px;
  }

  h2 {
    margin: 6px 0 0;
    font: 500 34px / 1.05 var(--font-display);
    letter-spacing: 0.05em;
  }

  .cols {
    columns: 2;
    column-gap: 44px;
  }

  section {
    break-inside: avoid;
    margin: 0 0 11px;
  }

  h3 {
    margin: 0 0 3px;
    font: 500 12px / 1.3 var(--font-display);
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: var(--ink-dim);
  }

  p {
    margin: 0;
    font: 500 15.5px / 1.3 var(--font-text);
    color: var(--ink);
    text-wrap: pretty;
  }

  .state {
    padding: 24px 0;
    color: var(--ink-soft);
  }

  .quiet {
    flex: none;
    border: 0;
    background: none;
    padding: 2px 0;
    color: var(--ink-soft);
    font: italic 500 17px / 1.2 var(--font-text);
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

  @media (max-width: 899px) {
    :global(.front.sheet .rules) {
      padding: 22px 20px 18px;
    }

    .cols {
      columns: 1;
    }
  }

  /* "Less motion" (#871): the sheet is there at once. */
  :global(.front.sheet .rules.still) {
    animation: none;
  }
</style>
