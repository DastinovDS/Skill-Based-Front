<script lang="ts">
  import { t } from '../i18n/index.ts';
</script>

<!-- New tab: following the link must not end a running match. -->
<nav class="legal-footer" aria-label={t('legal.nav')}>
  <a href="/impressum" target="_blank" rel="noopener">{t('legal.impressum')}</a>
  <a href="/privacy" target="_blank" rel="noopener">{t('legal.privacy')}</a>
</nav>

<style>
  .legal-footer {
    position: fixed;
    right: 8px;
    bottom: 4px;
    z-index: 20;
    display: flex;
    gap: 12px;
    padding: 2px 8px;
    border-radius: 4px;
    background: var(--scrim);
    font-size: 12px;
  }

  .legal-footer a {
    color: var(--text-dim);
  }

  .legal-footer a:hover,
  .legal-footer a:focus-visible {
    color: var(--text);
  }

  .legal-footer a:focus-visible {
    outline: 2px solid var(--paper);
    outline-offset: 2px;
  }
</style>
