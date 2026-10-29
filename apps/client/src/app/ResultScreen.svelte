<script lang="ts">
  import { t, tf } from '../i18n/index.ts';
  import type { MatchEndMsg, PlayerId, RatingChange } from '../protocol.gen.ts';

  interface Props {
    me: PlayerId;
    end: MatchEndMsg;
    onreplay: () => void;
    onmenu: () => void;
  }

  let { me, end, onreplay, onmenu }: Props = $props();

  // Displayed rating (r - 2*RD) before and after a rated match; the server computed it.
  function ratingText(r: RatingChange): { before: number; after: number; delta: string } {
    const d = r.after - r.before;
    return { before: r.before, after: r.after, delta: d > 0 ? `+${String(d)}` : String(d) };
  }

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
    {#if end.rating}
      <p class="rating">{tf('result.rating', ratingText(end.rating))}</p>
    {/if}
    <!-- DEC-34: a match that did not change the rating says why; calibration shows its progress. -->
    {#if !end.rated && end.unrated_reason !== null}
      <p class="unrated" role="status">{t(`result.unrated.${end.unrated_reason}`)}</p>
    {/if}
    {#if end.calibration !== null}
      <p class="calibration">
        {tf('result.calibration', {
          played: end.calibration.played,
          total: end.calibration.total,
        })}
      </p>
      {#if end.rating === null}
        <p class="hint">{t('result.calibrationHidden')}</p>
      {/if}
    {/if}
    <div class="actions">
      <button type="button" class="primary" onclick={onreplay}>{t('result.replay')}</button>
      <button type="button" onclick={onmenu}>{t('result.menu')}</button>
    </div>
  </div>
</main>
