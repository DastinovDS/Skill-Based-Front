<script lang="ts">
  import { Api, ApiError, type LobbyEntry } from '../api/http.ts';
  import LapisButton from '../theme/LapisButton.svelte';
  import { formatClock } from '../hud/format.ts';
  import { t, tf, type MessageKey } from '../i18n/index.ts';
  import { apiErrorKey } from './appState.svelte.ts';
  import ColourPicker from './ColourPicker.svelte';
  import DockFrame from './DockFrame.svelte';
  import type { DockContext } from './dock.ts';
  import { startPolling } from './poll.ts';
  import type { PlayerColour } from '../protocol.gen.ts';

  interface Props {
    api: Api;
    token: string;
    dock: DockContext;
    /** To the map choice of a new public match. */
    oncreate: () => void;
    /** Joined a match: on to its waiting room. */
    onjoined: (code: string) => void;
    onback: () => void;
    /** How often the list is asked again, ms. */
    pollMs?: number;
    /** The colour asked for in matches (DEC-49); null while unknown. */
    colour?: PlayerColour | null;
    /** A new colour (`PUT /api/me/colour`); the answer is why it failed, or null. Without it no picker. */
    oncolour?: (colour: PlayerColour) => Promise<MessageKey | null>;
  }

  let {
    api,
    token,
    dock,
    oncreate,
    onjoined,
    onback,
    pollMs = 2000,
    colour = null,
    oncolour,
  }: Props = $props();

  // Keyboard keys are not words of a language: they are labelled the same in every locale.
  const KEY_CREATE = 'C';

  let entries = $state.raw<readonly LobbyEntry[] | null>(null);
  /** Why the list could not be loaded: the next answer clears it. */
  let failure = $state.raw<MessageKey | null>(null);
  /** Why a join did not work (taken, the server): it stays until the player tries again. */
  let joinFailure = $state.raw<MessageKey | null>(null);
  /** The code being joined: its row says so, the others wait. */
  let joining = $state<string | null>(null);
  let selectedCode = $state<string | null>(null);

  async function load(signal?: AbortSignal): Promise<readonly LobbyEntry[] | null> {
    try {
      return await api.lobby(token, signal);
    } catch (error) {
      failure = apiErrorKey(error);
      return null;
    }
  }

  $effect(() => {
    let current = true;
    async function poll(signal: AbortSignal): Promise<void> {
      const next = await load(signal);
      if (current && next !== null) {
        entries = next;
        failure = null;
      }
    }
    const stop = startPolling(poll, pollMs);
    return () => {
      current = false;
      stop();
    };
  });

  const selected = $derived(
    entries === null ? null : (entries.find((e) => e.code === selectedCode) ?? entries[0] ?? null),
  );
  const joiningEntry = $derived(
    joining === null ? null : (entries?.find((e) => e.code === joining) ?? null),
  );

  const head = $derived(
    joiningEntry !== null
      ? tf('lobby.joining', { nick: joiningEntry.host_nick })
      : entries === null
        ? t('common.loading')
        : entries.length === 0
          ? t('lobby.none')
          : tf('lobby.waiting', { count: entries.length }),
  );
  const alert = $derived(
    joinFailure !== null
      ? t(joinFailure)
      : failure === null
        ? null
        : failure === 'error.api.network' && entries === null
          ? t('lobby.networkRetry')
          : t(failure),
  );

  async function join(code: string): Promise<void> {
    if (joining !== null) return;
    joining = code;
    joinFailure = null;
    try {
      const invite = await api.joinInvite(token, code);
      onjoined(invite.code);
    } catch (error) {
      // Taken by someone else a moment ago, or the host left: the list is refreshed.
      joinFailure =
        error instanceof ApiError && (error.code === 'not_found' || error.code === 'conflict')
          ? 'error.lobby.taken'
          : apiErrorKey(error);
      const next = await load();
      if (next !== null) entries = next;
    } finally {
      joining = null;
    }
  }

  function enter(): void {
    if (selected !== null) void join(selected.code);
    else if (entries !== null && entries.length === 0) oncreate();
  }

  // Up and Down move the choice, C opens a match of your own. The letter keys of the modes
  // (B, I, L) are DockFrame's; a field or a button keeps its own keys.
  function onkeydown(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target;
    if (target instanceof Element && target.closest('input, textarea, select, a')) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (entries === null || entries.length === 0) return;
      const at = entries.findIndex((e) => e.code === selected?.code);
      const next =
        entries[
          Math.max(0, Math.min(entries.length - 1, at + (event.key === 'ArrowDown' ? 1 : -1)))
        ];
      if (next === undefined) return;
      event.preventDefault();
      selectedCode = next.code;
    } else if (event.key.toLowerCase() === KEY_CREATE.toLowerCase()) {
      if (target instanceof Element && target.closest('button')) return;
      event.preventDefault();
      oncreate();
    }
  }
</script>

<svelte:window {onkeydown} />

<DockFrame
  {dock}
  mode="lobby"
  eyebrow={t('menu.lobby')}
  {head}
  pause="none"
  {alert}
  {onback}
  onenter={enter}
>
  <!-- Open matches (Lapis, #845): one ruled row per match: the host, the map, the wait, Join. -->
  {#if entries === null}
    <div class="ents" aria-hidden="true">
      <i class="sk"></i><i class="sk"></i><i class="sk"></i>
    </div>
  {:else if entries.length === 0}
    <div class="empty">
      <p>{t('lobby.empty')}</p>
    </div>
  {:else}
    <ul class="ents" aria-label={t('lobby.listAria')}>
      {#each entries as entry (entry.code)}
        <li
          class="ent"
          class:sel={entry.code === selected?.code}
          class:busy={joining !== null && joining !== entry.code}
          onfocusin={() => {
            selectedCode = entry.code;
          }}
        >
          <span class="ln">{entry.host_nick}</span>
          <span class="lm">{entry.map_id}</span>
          <span class="lt">{tf('lobby.waitingFor', { time: formatClock(entry.age_s) })}</span>
          <LapisButton size="sm" disabled={joining !== null} onclick={() => join(entry.code)}
            >{joining === entry.code ? t('lobby.joinBusy') : t('lobby.join')}</LapisButton
          >
        </li>
      {/each}
    </ul>
  {/if}
  {#if oncolour !== undefined}
    <!-- The colour for the match about to be joined or created (DEC-49). -->
    <div class="colour">
      <ColourPicker value={colour} onchange={oncolour} compact />
    </div>
  {/if}
  {#snippet actions()}
    {#if entries !== null && entries.length === 0}
      <LapisButton variant="primary" onclick={oncreate}>{t('lobby.create')}</LapisButton>
    {:else}
      <LapisButton aria-keyshortcuts={KEY_CREATE} disabled={joining !== null} onclick={oncreate}
        >{t('lobby.create')}</LapisButton
      >
    {/if}
    <button type="button" class="lnk" aria-keyshortcuts="Escape" onclick={onback}>
      {t('common.back')}
    </button>
  {/snippet}
</DockFrame>

<style>
  .colour {
    margin-top: 18px;
  }
</style>
