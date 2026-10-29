<script lang="ts">
  import { Api, ApiError, type LobbyEntry } from '../api/http.ts';
  import Icon from '../hud/Icon.svelte';
  import { formatClock } from '../hud/format.ts';
  import { t, tf, type MessageKey } from '../i18n/index.ts';
  import { apiErrorKey } from './appState.svelte.ts';
  import DockFrame from './DockFrame.svelte';
  import type { DockContext } from './dock.ts';
  import MapThumb from './MapThumb.svelte';
  import { startPolling } from './poll.ts';

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
  }

  let { api, token, dock, oncreate, onjoined, onback, pollMs = 2000 }: Props = $props();

  // Keyboard keys are not words of a language: they are labelled the same in every locale.
  const KEY_CREATE = 'C';
  const KEY_BACK = 'Esc';

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

  // The thumbnails: every map of the list, fetched once and kept.
  $effect(() => {
    for (const entry of entries ?? []) void dock.maps.ensure(entry.map_id);
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
  const sub = $derived(
    entries !== null && entries.length === 0 ? t('lobby.empty') : t('lobby.intro'),
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
  {sub}
  pause="none"
  {alert}
  note={entries !== null && entries.length === 0 ? t('lobby.emptyNote') : null}
  {onback}
  onenter={enter}
>
  {#if entries === null}
    <div class="ents" aria-hidden="true">
      <i class="sk"></i><i class="sk"></i><i class="sk"></i>
    </div>
  {:else if entries.length > 0}
    <ul class="ents" class:scroll={entries.length > 5} aria-label={t('lobby.listAria')}>
      {#each entries as entry (entry.code)}
        <li
          class="ent"
          class:sel={entry.code === selected?.code}
          class:busy={joining !== null && joining !== entry.code}
          onfocusin={() => {
            selectedCode = entry.code;
          }}
        >
          <MapThumb map={dock.maps.get(entry.map_id)} />
          <span class="tx">
            <span class="nm">{entry.host_nick}</span>
            <small
              >{tf('lobby.entryInfo', { map: entry.map_id, time: formatClock(entry.age_s) })}</small
            >
          </span>
          <span class="go">
            <button
              type="button"
              class="btn pri"
              disabled={joining !== null}
              onclick={() => join(entry.code)}
              >{joining === entry.code ? t('lobby.joinBusy') : t('lobby.join')}</button
            >
          </span>
        </li>
      {/each}
    </ul>
  {/if}
  {#snippet actions()}
    {#if entries !== null && entries.length === 0}
      <button type="button" class="btn pri" onclick={oncreate}>
        {t('lobby.create')}<kbd class="k" aria-hidden="true">↵</kbd>
      </button>
    {:else}
      <button
        type="button"
        class="btn"
        aria-keyshortcuts={KEY_CREATE}
        disabled={joining !== null}
        onclick={oncreate}
      >
        <Icon name="plus" size={18} />{t('lobby.create')}<kbd class="k" aria-hidden="true"
          >{KEY_CREATE}</kbd
        >
      </button>
    {/if}
    <button type="button" class="btn link" aria-keyshortcuts="Escape" onclick={onback}>
      {t('common.back')}<kbd class="k" aria-hidden="true">{KEY_BACK}</kbd>
    </button>
  {/snippet}
</DockFrame>
