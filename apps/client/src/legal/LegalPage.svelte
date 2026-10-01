<script lang="ts">
  import { getLocale, t } from '../i18n/index.ts';
  import { hasPlaceholders, LEGAL_CONTENT, type LegalPageId } from '../i18n/legal/index.ts';
  import LocaleSelect from '../app/LocaleSelect.svelte';

  interface Props {
    page: LegalPageId;
  }

  let { page }: Props = $props();

  const doc = $derived(LEGAL_CONTENT[getLocale()][page]);
  const other: Record<LegalPageId, LegalPageId> = { impressum: 'privacy', privacy: 'impressum' };
</script>

<main class="legal">
  <article>
    <h1>{doc.title}</h1>
    {#if hasPlaceholders(doc)}
      <p class="draft" role="note">{t('legal.draft')}</p>
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
    <nav class="links" aria-label={t('legal.nav')}>
      <a href="/{other[page]}">{t(`legal.${other[page]}`)}</a>
      <a href="/">{t('legal.game')}</a>
    </nav>
    <LocaleSelect />
  </article>
</main>

<style>
  .legal {
    position: fixed;
    inset: 0;
    overflow: auto;
    padding: 16px;
    box-sizing: border-box;
  }

  article {
    max-width: 720px;
    margin: 0 auto;
    line-height: 1.5;
  }

  h1 {
    font-size: 24px;
  }

  h2 {
    margin: 24px 0 8px;
    font-size: 17px;
  }

  p {
    margin: 0 0 8px;
  }

  .draft {
    padding: 8px 12px;
    border: 1px solid #d29922;
    border-radius: 6px;
    color: #e3b341;
  }

  .links {
    display: flex;
    gap: 16px;
    margin: 24px 0 16px;
  }

  a {
    color: #58a6ff;
  }
</style>
