<script lang="ts">
  import type { RecordTally } from '../api/http.ts';
  import { getLocale, t, type MessageKey } from '../i18n/index.ts';

  interface Props {
    label: string;
    record: RecordTally;
  }

  let { label, record }: Props = $props();

  const WORDS = {
    wins: { one: 'profile.wins.one', other: 'profile.wins.other' },
    losses: { one: 'profile.losses.one', other: 'profile.losses.other' },
    draws: { one: 'profile.draws.one', other: 'profile.draws.other' },
  } as const satisfies Record<keyof RecordTally, Record<'one' | 'other', MessageKey>>;

  /** The word for a count by the plural rules of the UI language ("1 win", "2 wins"). */
  function word(count: number, kind: keyof RecordTally): string {
    const form = new Intl.PluralRules(getLocale()).select(count) === 'one' ? 'one' : 'other';
    return t(WORDS[kind][form]);
  }

  const parts = $derived(
    (['wins', 'losses', 'draws'] as const).map((kind) => ({
      kind,
      count: record[kind],
      word: word(record[kind], kind),
    })),
  );
</script>

<div class="record">
  <div class="cap">{label}</div>
  <div class="tally">
    {#each parts as part (part.kind)}
      <span><b>{part.count}</b> {part.word}</span>
    {/each}
  </div>
</div>

<style>
  .record {
    padding: 8px 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: rgb(13 17 23 / 55%);
  }

  .cap {
    font-size: 11px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-dim);
  }

  .tally {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 9px;
    margin-top: 2px;
    font-size: 14px;
    color: var(--text-dim);
    font-variant-numeric: tabular-nums;
  }

  b {
    margin-right: 2px;
    font-size: 18px;
    font-weight: 800;
    color: var(--text);
  }
</style>
