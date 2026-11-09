<script lang="ts">
  import { t } from '../i18n/index.ts';
  import LapisButton from '../theme/LapisButton.svelte';
  import StoneOverlay from '../theme/StoneOverlay.svelte';

  interface Props {
    /** Set a password first: the way to keep the account. */
    onpassword: () => void;
    onlogout: () => void;
    /** Stay logged in (the button, or Esc). */
    onstay: () => void;
  }

  let { onpassword, onlogout, onstay }: Props = $props();
</script>

<!-- A guest without a password loses the account by logging out: a dialog on the stone asks once
     before that (Lapis, #845). The account chip and the settings (#871) open it. -->
<StoneOverlay label={t('menu.logoutTitle')} role="alertdialog" onclose={onstay}>
  <p class="kicker">{t('account.eyebrow')}</p>
  <h2 class="dlg-h">{t('menu.logoutTitle')}</h2>
  <p class="dlg-p">{t('menu.logoutWarning')}</p>
  <div class="dlg-acts">
    <LapisButton variant="primary" onclick={onpassword}>{t('menu.setPassword')}</LapisButton>
  </div>
  <div class="dlg-acts">
    <LapisButton danger onclick={onlogout}>{t('menu.logoutConfirm')}</LapisButton>
    <button type="button" class="lnk" onclick={onstay}>{t('menu.logoutCancel')}</button>
  </div>
</StoneOverlay>
