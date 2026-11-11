<script lang="ts">
  import { t, tf } from '../i18n/index.ts';
  import LapisButton from '../theme/LapisButton.svelte';
  import StoneOverlay from '../theme/StoneOverlay.svelte';
  import { DEFAULT_KEYS, KEY_ACTIONS, keyLabel, type KeyAction } from './keyBindings.ts';
  import { keyBindings as pageBindings, type KeyBindingsState } from './keyBindingsState.svelte.ts';
  import { FIXED_KEYS } from './settingsKeys.ts';

  interface Props {
    /** Done, or Esc while no key is being captured. */
    onclose: () => void;
    /** The bindings of the page; tests pass their own. */
    bindings?: KeyBindingsState;
  }

  let { onclose, bindings = pageBindings }: Props = $props();

  /** The action whose new key is awaited; `null`: none. */
  let capturing = $state<KeyAction | null>(null);
  /** What the last change did, read out by the live region (a swap, a refused key). */
  let message = $state('');
  /**
   * The key just taken: its `keyup` is swallowed, so a captured Space or Enter does not click the
   * button again and start a new capture.
   */
  let taken: string | null = null;

  const name = (action: KeyAction): string => t(`keys.action.${action}`);

  function start(action: KeyAction): void {
    if (capturing === action) return;
    capturing = action;
    message = tf('keys.capture', { action: name(action) });
  }

  function stop(): void {
    if (capturing === null) return;
    capturing = null;
    message = t('keys.cancelled');
  }

  /** The key pressed while capturing: Esc cancels, Tab leaves, any other key is the new binding. */
  function capture(event: KeyboardEvent, action: KeyAction): void {
    if (capturing !== action) return;
    // Tab moves on as usual; leaving the button cancels the capture.
    if (event.code === 'Tab') return;
    event.preventDefault();
    // The screen behind and the dialog must not see it (Esc would close them).
    event.stopPropagation();
    if (event.repeat) return;
    if (event.code === 'Escape') {
      stop();
      return;
    }
    const result = bindings.bind(action, event.code);
    if (result.kind === 'refused') {
      message = tf('keys.refused', { key: keyLabel(event.code, bindings.layout) });
      return;
    }
    capturing = null;
    taken = event.code;
    const key = bindings.label(action);
    if (result.kind === 'bound' && result.swapped !== null) {
      message = tf('keys.swapped', {
        action: name(action),
        key,
        other: name(result.swapped),
        otherKey: bindings.label(result.swapped),
      });
    } else {
      message = tf('keys.bound', { action: name(action), key });
    }
  }

  function release(event: KeyboardEvent): void {
    if (taken === null || event.code !== taken) return;
    taken = null;
    event.preventDefault();
  }

  function reset(action: KeyAction): void {
    const result = bindings.reset(action);
    const key = bindings.label(action);
    message =
      result.kind === 'bound' && result.swapped !== null
        ? tf('keys.swapped', {
            action: name(action),
            key,
            other: name(result.swapped),
            otherKey: bindings.label(result.swapped),
          })
        : tf('keys.bound', { action: name(action), key });
  }

  function resetAll(): void {
    capturing = null;
    bindings.resetAll();
    message = t('keys.allReset');
  }
</script>

<!-- The keys of a match (#966): every rebindable action with its key; a click (or Enter, Space) on
     the key waits for the new one, Esc cancels. A key another action has is swapped. -->
<StoneOverlay label={t('keys.title')} wide onclose={capturing === null ? onclose : undefined}>
  <p class="kicker">{t('keys.kicker')}</p>
  <h2 class="dlg-h">{t('keys.title')}</h2>
  <p class="dlg-p hint">{t('keys.hint')}</p>

  <ul class="binds">
    {#each KEY_ACTIONS as action (action)}
      {@const label = bindings.label(action)}
      {@const changed = bindings.keys[action] !== DEFAULT_KEYS[action]}
      <li>
        <span class="name">{name(action)}</span>
        <button
          type="button"
          class="cap"
          class:capturing={capturing === action}
          aria-label={tf('keys.cap', { action: name(action), key: label })}
          aria-pressed={capturing === action}
          onclick={() => {
            start(action);
          }}
          onkeydown={(event) => {
            capture(event, action);
          }}
          onkeyup={release}
          onblur={() => {
            if (capturing === action) stop();
          }}
        >
          {capturing === action ? t('keys.press') : label}
        </button>
        {#if changed}
          <button
            type="button"
            class="lnk reset"
            aria-label={tf('keys.resetOne', {
              action: name(action),
              key: keyLabel(DEFAULT_KEYS[action], bindings.layout),
            })}
            onclick={() => {
              reset(action);
            }}>{t('keys.reset')}</button
          >
        {/if}
      </li>
    {/each}
  </ul>

  <p class="msg" role="status">{message}</p>

  <h3 class="sec">{t('keys.fixed')}</h3>
  <dl class="fixed">
    {#each FIXED_KEYS as [key, what] (key)}
      <div>
        <dt><kbd>{key}</kbd></dt>
        <dd>{t(what)}</dd>
      </div>
    {/each}
  </dl>

  <div class="dlg-acts">
    <LapisButton variant="primary" onclick={onclose}>{t('keys.done')}</LapisButton>
    <button type="button" class="lnk" onclick={resetAll}>{t('keys.resetAll')}</button>
  </div>
</StoneOverlay>

<style>
  .hint {
    color: var(--ink-dim);
  }

  /* Two columns of rows: the action, its key, and a reset once it is not the default. */
  .binds {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0 48px;
    margin: 22px 0 0;
    padding: 0;
    list-style: none;
  }

  .binds li {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto 64px;
    align-items: center;
    gap: 12px;
    min-height: 40px;
    border-top: 1px solid rgb(61 55 45 / 50%);
  }

  .name {
    font-size: 17px;
  }

  /* The key: a cap of cut capitals, as the key lists of the screen; awaiting a key it inverts. */
  .cap {
    min-width: 58px;
    box-sizing: border-box;
    padding: 4px 10px 3px;
    border: 1px solid var(--line);
    background: none;
    color: var(--ink);
    font: 500 12px / 1.3 var(--font-display);
    letter-spacing: 0.1em;
    text-align: center;
    text-transform: uppercase;
    cursor: pointer;
  }

  .cap:hover {
    border-color: var(--ink-soft);
  }

  .cap:focus-visible {
    outline: 2px solid var(--ink);
    outline-offset: 3px;
  }

  .cap.capturing {
    border-color: var(--ink);
    background: var(--ink);
    color: var(--stone-bg);
  }

  .reset {
    justify-self: start;
    font-size: 15px;
  }

  .msg {
    min-height: 1.45em;
    margin: 14px 0 0;
    color: var(--ink-dim);
    font-size: 16px;
    font-style: italic;
  }

  .sec {
    display: flex;
    align-items: center;
    gap: 18px;
    margin: 18px 0 10px;
    font: 500 11.5px / 1.3 var(--font-display);
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--ink-dim);
  }

  .sec::after {
    content: '';
    flex: 1;
    border-top: 1px solid var(--cut);
    box-shadow: 0 1px 0 var(--line);
  }

  .fixed {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 28px;
    margin: 0;
  }

  .fixed div {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .fixed dd {
    margin: 0;
    color: var(--ink-dim);
    font-size: 16px;
  }

  kbd {
    display: inline-block;
    min-width: 34px;
    box-sizing: border-box;
    padding: 3px 8px 2px;
    border: 1px solid var(--line);
    color: var(--ink-dim);
    font: 500 12px / 1.3 var(--font-display);
    letter-spacing: 0.1em;
    text-align: center;
  }

  .dlg-acts {
    margin-top: 22px;
  }

  /* A narrow window: one column of rows. */
  @media (max-width: 760px) {
    .binds {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
