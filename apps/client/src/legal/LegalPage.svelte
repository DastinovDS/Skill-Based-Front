<script lang="ts">
  import { getLocale, t } from '../i18n/index.ts';
  import { hasPlaceholders, LEGAL_CONTENT, type LegalPageId } from '../i18n/legal/index.ts';
  import LocaleSelect from '../app/LocaleSelect.svelte';
  import Icon from '../hud/Icon.svelte';

  interface Props {
    page: LegalPageId;
  }

  let { page }: Props = $props();

  const doc = $derived(LEGAL_CONTENT[getLocale()][page]);
  const other: Record<LegalPageId, LegalPageId> = { impressum: 'privacy', privacy: 'impressum' };
</script>

<main class="legal">
  <header class="bar">
    <a class="back" href="/"><span aria-hidden="true">←</span>{t('legal.game')}</a>
    <LocaleSelect />
  </header>
  <article>
    <h1>{doc.title}</h1>
    {#if hasPlaceholders(doc)}
      <p class="draft" role="note">
        <Icon name="alert" size={18} /><span>{t('legal.draft')}</span>
      </p>
    {/if}
    {#each doc.sections as section (section.heading)}
      <section>
        <h2>{section.heading}</h2>
        {#each section.body as paragraph (paragraph)}
          <p>{paragraph}</p>
        {/each}
        {#if section.items !== undefined}
          <ul>
            {#each section.items as item (item)}
              <li>{item}</li>
            {/each}
          </ul>
        {/if}
      </section>
    {/each}
    <section class="licenses" aria-labelledby="licenses-title">
      <h2 id="licenses-title">{t('legal.licenses')}</h2>
      <p>{t('legal.licenses.intro')}</p>
      <p>{t('legal.licenses.lucide')}</p>
      <p>
        {t('legal.licenses.libraries')}
        <a href="/third-party-licenses.txt" target="_blank" rel="noopener"
          >{t('legal.licenses.libraries.link')}</a
        >.
      </p>
    </section>
    <nav class="links" aria-label={t('legal.nav')}>
      <a href="/{other[page]}">{t(`legal.${other[page]}`)}</a>
    </nav>
  </article>
</main>

<style>
  /* Section 13.8 of ui-style.md: the text is 680 px wide, 16 px, line height 1.5; the way back and
     the language sit in the header. Tokens of app.css only. */
  .legal {
    position: fixed;
    inset: 0;
    overflow: auto;
    box-sizing: border-box;
    padding: 0 16px 32px;
    background: var(--bg);
    color: var(--text);
    font-size: 16px;
    line-height: 1.5;
  }

  .bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    max-width: 680px;
    min-height: 64px;
    margin: 0 auto;
    color: var(--text-dim);
    font-size: 14px;
  }

  .bar :global(label) {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .bar :global(select) {
    height: 32px;
    padding: 0 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--surface-2);
    color: var(--text);
    font: inherit;
  }

  article {
    max-width: 680px;
    margin: 0 auto;
  }

  h1 {
    margin: 8px 0 16px;
    font-size: 32px;
    line-height: 1.2;
    font-weight: 800;
    letter-spacing: -0.02em;
  }

  h2 {
    margin: 32px 0 8px;
    font-size: 20px;
    line-height: 1.3;
    font-weight: 700;
  }

  p {
    margin: 0 0 8px;
  }

  ul {
    margin: 0 0 8px;
    padding-left: 24px;
  }

  .draft {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 10px 14px;
    border: 1px solid var(--warn);
    border-radius: 8px;
    background: var(--surface);
    color: var(--warn);
    font-size: 15px;
  }

  .draft :global(svg) {
    flex: none;
    margin-top: 3px;
  }

  .links {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 24px;
    margin: 32px 0 0;
    padding-top: 16px;
    border-top: 1px solid var(--border);
  }

  a {
    color: var(--you);
    text-underline-offset: 3px;
  }

  a:hover {
    color: var(--paper);
  }

  a:focus-visible,
  .bar :global(select:focus-visible) {
    outline: 2px solid var(--paper);
    outline-offset: 2px;
  }

  .back {
    display: inline-flex;
    gap: 8px;
    text-decoration: none;
  }
</style>
