<script lang="ts">
  import SheetFrame from '../board/SheetFrame.svelte';
  import HowToPlay from '../howto/HowToPlay.svelte';
  import { t } from '../i18n/index.ts';
  import type { MapFile } from '../protocol.gen.ts';
  import LapisButton from '../theme/LapisButton.svelte';

  interface Props {
    nick: string;
    hasPassword: boolean;
    map: MapFile | null;
    /** The nick of the bar opens the profile. */
    onprofile: () => void;
    /** "Back" and Esc: the screen the page was opened from. */
    onback: () => void;
  }

  let { nick, hasPassword, map, onprofile, onback }: Props = $props();

  function onkeydown(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key !== 'Escape') return;
    event.preventDefault();
    onback();
  }
</script>

<svelte:window {onkeydown} />

<!-- The page of the rules (CLI-13, #72), opened by the "?" of the bar (#919): a sheet on the
     blurred stone, like the profile. -->
<SheetFrame
  {map}
  label={t('help.howTo')}
  player={{ nick, guest: !hasPassword, onprofile }}
  onhelp={() => undefined}
  helpHere
>
  <div class="howto">
    <div class="sheethead">
      <p class="kicker">{t('howto.eyebrow')}</p>
      <h2>{t('help.howTo')}</h2>
      <p class="sub">{t('menu.tagline')}</p>
    </div>
    <HowToPlay />
    <p class="copyright">{t('howto.copyright')}</p>
    <div class="acts">
      <LapisButton variant="primary" aria-keyshortcuts="Escape" onclick={onback}
        >{t('common.back')}</LapisButton
      >
    </div>
  </div>
</SheetFrame>

<style>
  .howto {
    max-width: 1024px;
  }

  .sheethead p {
    margin: 0;
  }

  .sheethead .sub {
    margin-top: 10px;
  }

  .copyright {
    margin: 24px 0 0;
    font-size: 14px;
    color: var(--ink-dim);
  }
</style>
