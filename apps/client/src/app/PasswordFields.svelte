<script lang="ts">
  import { t } from '../i18n/index.ts';
  import { PASSWORD_MAX, PASSWORD_MIN } from './account.ts';

  interface Props {
    /** The new password and its repeat: the form compares them before it asks the server. */
    password?: string;
    repeat?: string;
  }

  let { password = $bindable(''), repeat = $bindable('') }: Props = $props();
</script>

<label>
  {t('account.passwordNew')}
  <input
    type="password"
    name="new-password"
    bind:value={password}
    required
    minlength={PASSWORD_MIN}
    maxlength={PASSWORD_MAX}
    autocomplete="new-password"
  />
</label>
<label>
  {t('account.passwordRepeat')}
  <input
    type="password"
    name="new-password-repeat"
    bind:value={repeat}
    required
    maxlength={PASSWORD_MAX}
    autocomplete="new-password"
  />
</label>
<p class="hint">{t('account.passwordHint')}</p>
