<script lang="ts">
  import { getLocale, isLocale, LOCALES, setLocale, t, translate } from '../i18n/index.ts';
</script>

<label>
  {t('hud.language')}
  <select
    value={getLocale()}
    onchange={(event) => {
      const next = event.currentTarget.value;
      if (isLocale(next)) {
        setLocale(next);
      }
    }}
  >
    {#each LOCALES as locale (locale)}
      <!-- Each language is named in itself, so a viewer finds theirs in any UI language. -->
      <option value={locale} lang={locale}>{translate(locale, 'language.self')}</option>
    {/each}
  </select>
</label>
