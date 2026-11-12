<script lang="ts">
  import { tick } from 'svelte';
  import { t, tf } from '../i18n/index.ts';
  import type { MessageKey } from '../i18n/messages.ts';
  import { sound } from '../audio/soundState.svelte.ts';
  import { modal } from '../theme/modal.ts';
  import './dialog.css';
  import KeysDialog from '../app/KeysDialog.svelte';
  import type { KeyAction } from '../app/keyBindings.ts';
  import { keyBindings } from '../app/keyBindingsState.svelte.ts';
  import Segments from '../app/Segments.svelte';
  import { MOTIONS, type Motion } from '../app/settings.ts';
  import { settings } from '../app/settingsState.svelte.ts';

  interface Props {
    open: boolean;
    onclose: () => void;
    /**
     * `ruleset_public.group_order` is set (DEC-48): the rows of the selection of several groups and
     * of the group order, no row of the release (items A7, K6).
     */
    groupOrder?: boolean;
    /** `ruleset_public.recruit.rally_point` (DEC-48, item H): the row of `P`. */
    rallyPoint?: boolean;
  }

  let { open, onclose, groupOrder = false, rallyPoint = false }: Props = $props();

  let done: HTMLButtonElement | undefined = $state();
  /** The keys dialog (#966) is open over the panel. */
  let editingKeys = $state(false);
  let keysActs: HTMLDivElement | undefined = $state();

  $effect(() => {
    if (open) void tick().then(() => done?.focus());
    else editingKeys = false;
  });

  /**
   * The keys: a label (the key itself, not a translation) and the dictionary key of its effect.
   * The planned order is on `E` (DEC-48, item K2); Shift selects several groups under the group order (item K1).
   * The rebindable keys show their current binding (#966); Shift, the mouse, `?` and Esc are fixed.
   */
  type KeyRow = readonly [string, MessageKey];
  const key = (action: KeyAction): string => keyBindings.label(action);
  const names = $derived(keyBindings.names());
  const keys = $derived<readonly KeyRow[]>([
    ['LMB', groupOrder ? 'help.key.groupOrder' : 'help.key.select'],
    ...(groupOrder
      ? ([
          ['Shift + LMB', 'help.key.selectSeveral'],
          ['Shift + drag', 'help.key.selectBox'],
        ] as const)
      : []),
    [`${key('planned')} + LMB`, 'help.key.planned'],
    [`${key('planned')} + wheel`, 'help.key.planWheel'],
    ...(groupOrder ? [] : ([[key('release'), 'help.key.release']] as const)),
    [key('cancel'), 'help.key.cancel'],
    [key('recruit'), 'help.key.recruit'],
    ...(rallyPoint ? ([[key('rally'), 'help.key.rally']] as const) : []),
    [key('fortify'), 'help.key.fortify'],
    [key('terrain'), 'help.key.terrain'],
    [key('split'), 'help.key.split'],
    [key('merge'), 'help.key.merge'],
    [key('stance'), 'help.key.stance'],
    [key('alert'), 'help.key.alert'],
    [key('fit'), 'help.key.fit'],
    [key('mute'), 'help.key.mute'],
    [key('mark'), 'help.key.mark'],
    ['?', 'help.key.settings'],
    ['Esc', 'help.key.escape'],
  ]);

  const MOTION_KEYS = {
    system: 'settings.motion.system',
    full: 'settings.motion.full',
    reduced: 'settings.motion.reduced',
  } as const;
  const motions = $derived(MOTIONS.map((m) => ({ value: m, label: t(MOTION_KEYS[m]) })));
</script>

{#if open}
  <!-- The settings of a match (owner 2026-11-12): the keys with their rebinding, the sound and the
       motion, as the Settings screen offers them; no legend and no rules (the match is not the
       place to learn them). The match runs on under it (nothing pauses). -->
  <div class="dlg-backdrop fit">
    <div
      class="dlg rule-frame panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby="mset-title"
      tabindex="-1"
      use:modal={{ onclose, passKeys: true }}
    >
      <p class="dlg-eyebrow">{t('mset.eyebrow')}</p>
      <h2 class="dlg-title" id="mset-title">{t('settings.title')}</h2>
      <div class="body">
        <div class="cols">
          <section aria-labelledby="mset-keys">
            <h3 class="sec" id="mset-keys">{t('settings.keys')}</h3>
            <dl class="keys">
              {#each keys as [label, text] (text)}
                <dt><kbd>{label}</kbd></dt>
                <dd>{tf(text, names)}</dd>
              {/each}
            </dl>
            <p class="note">{t('help.camera')}</p>
            <div class="keys-acts" bind:this={keysActs}>
              <button
                type="button"
                class="dlg-btn"
                onclick={() => {
                  editingKeys = true;
                }}>{t('settings.keys.change')}</button
              >
            </div>
          </section>
          <div class="right">
            <section aria-labelledby="mset-sound">
              <h3 class="sec" id="mset-sound">{t('settings.sound')}</h3>
              <div class="set">
                <span class="sl" id="mset-sound-label">{t('settings.sound')}</span>
                <button
                  type="button"
                  class="switch"
                  role="switch"
                  aria-checked={!sound.muted}
                  aria-labelledby="mset-sound-label"
                  onclick={() => {
                    sound.toggleMute();
                  }}
                >
                  <i aria-hidden="true"></i><span
                    >{sound.muted ? t('settings.sound.off') : t('settings.sound.on')}</span
                  >
                </button>
              </div>
              <div class="set">
                <span class="sl" id="mset-volume-label">{t('settings.volume')}</span>
                <span class="range">
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="5"
                    value={sound.volume}
                    aria-labelledby="mset-volume-label"
                    oninput={(event) => {
                      sound.setVolume(Number(event.currentTarget.value));
                    }}
                  />
                  <span class="num" aria-hidden="true">{sound.volume}</span>
                </span>
              </div>
            </section>
            <section aria-labelledby="mset-display">
              <h3 class="sec" id="mset-display">{t('settings.display')}</h3>
              <div class="set">
                <span class="sl">{t('settings.motion')}</span>
                <Segments
                  label={t('settings.motion')}
                  options={motions}
                  value={settings.motion}
                  onchange={(motion: Motion) => {
                    settings.set({ motion });
                  }}
                />
              </div>
            </section>
          </div>
        </div>
      </div>
      <div class="dlg-acts">
        <button type="button" class="dlg-btn pri" bind:this={done} onclick={onclose}>
          {t('keys.done')}
        </button>
      </div>
    </div>
  </div>
  {#if editingKeys}
    <KeysDialog
      onclose={() => {
        editingKeys = false;
        // The focus goes back to the button that opened the dialog.
        keysActs?.querySelector('button')?.focus();
      }}
    />
  {/if}
{/if}

<style>
  /* The grid cell is the backdrop's height, so the panel's `max-height` has something to be a share of. */
  .fit {
    grid-template: minmax(0, 1fr) / minmax(0, 1fr);
  }

  /* The frame (`.rule-frame`) is drawn outside the box, so the box itself never scrolls: its body does. */
  .dlg.panel {
    width: min(940px, 100%);
    max-height: calc(100% - 8px);
    padding: 34px 40px 30px;
  }

  .body {
    min-height: 0;
    overflow: auto;
  }

  .cols {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
    gap: 0 56px;
    margin-top: 6px;
  }

  .sec {
    display: flex;
    align-items: center;
    gap: 18px;
    margin: 22px 0 12px;
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

  .keys {
    display: grid;
    grid-template-columns: auto 1fr;
    align-items: baseline;
    gap: 8px 14px;
    margin: 0;
  }

  dt {
    text-align: right;
    white-space: nowrap;
  }

  dd {
    margin: 0;
    font-size: 16px;
    line-height: 1.3;
  }

  kbd {
    display: inline-block;
    min-width: 34px;
    box-sizing: border-box;
    padding: 3px 8px 2px;
    border: 1px solid var(--line);
    font: 500 12px / 1.3 var(--font-display);
    letter-spacing: 0.1em;
    text-align: center;
  }

  .note {
    margin: 12px 0 0;
    font-size: 15px;
    font-style: italic;
    color: var(--ink-dim);
  }

  .keys-acts {
    margin-top: 16px;
  }

  /* One setting: its name, then its control, over a faint rule (the Settings screen's rows). */
  .set {
    display: grid;
    grid-template-columns: 130px minmax(0, 1fr);
    align-items: center;
    gap: 12px;
    padding: 12px 0;
    border-top: 1px solid rgb(61 55 45 / 50%);
  }

  .sl {
    font: 500 11.5px / 1.3 var(--font-display);
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--ink-dim);
  }

  /* The sound switch: a frame with a square knob that sits right when on, and the word. */
  .switch {
    justify-self: start;
    display: inline-flex;
    align-items: center;
    gap: 10px;
    padding: 4px 0;
    border: 0;
    background: none;
    color: var(--ink);
    font: italic 400 18px var(--font-text);
    cursor: pointer;
  }

  .switch:focus-visible {
    outline: 2px solid var(--ink);
    outline-offset: 3px;
  }

  .switch i {
    position: relative;
    display: block;
    width: 38px;
    height: 20px;
    box-sizing: border-box;
    border: 1px solid var(--ink);
  }

  .switch i::after {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 14px;
    height: 14px;
    background: var(--ink-dim);
  }

  .switch[aria-checked='true'] i::after {
    left: auto;
    right: 2px;
    background: var(--ink);
  }

  .range {
    display: inline-flex;
    align-items: center;
    gap: 12px;
  }

  .range input {
    width: 180px;
    max-width: 100%;
    accent-color: var(--ink);
  }

  .range .num {
    min-width: 3ch;
    font-variant-numeric: tabular-nums;
  }

  /* A short window: the sheet closes up, and scrolls inside its frame where it still does not fit. */
  @media (max-height: 760px) {
    .dlg.panel {
      padding: 24px 32px 22px;
    }

    .sec {
      margin: 14px 0 8px;
    }

    .set {
      padding: 8px 0;
    }
  }
</style>
