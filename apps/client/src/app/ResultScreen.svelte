<script lang="ts">
  import { t, tf } from '../i18n/index.ts';
  import type { MatchEndMsg, PlayerId } from '../protocol.gen.ts';

  interface Props {
    me: PlayerId;
    end: MatchEndMsg;
    onreplay: () => void;
    onmenu: () => void;
  }

  let { me, end, onreplay, onmenu }: Props = $props();

  const verdict = $derived(
    end.winner === null ? 'result.draw' : end.winner === me ? 'result.victory' : 'result.defeat',
  );
  // Final VP of both players, by player id: ours first.
  const mine = $derived(end.vp[me]);
  const enemy = $derived(end.vp[me === 0 ? 1 : 0]);
</script>

<main class="screen">
  <div class="card">
    <h1>{t(verdict)}</h1>
    <p>{t(`result.reason.${end.reason}`)}</p>
    <p>{tf('result.vp', { mine, enemy })}</p>
    <div class="actions">
      <button type="button" class="primary" onclick={onreplay}>{t('result.replay')}</button>
      <button type="button" onclick={onmenu}>{t('result.menu')}</button>
    </div>
  </div>
</main>
