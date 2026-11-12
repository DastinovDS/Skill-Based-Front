<script lang="ts">
  import { sound as pageSound, type SoundState } from '../audio/soundState.svelte.ts';
  import SheetFrame from '../board/SheetFrame.svelte';
  import {
    getLocale,
    hasLocaleChoice,
    LOCALES,
    setLocale,
    t,
    tf,
    translate,
    type Locale,
  } from '../i18n/index.ts';
  import type { MapFile } from '../protocol.gen.ts';
  import LapisButton from '../theme/LapisButton.svelte';
  import KeysDialog from './KeysDialog.svelte';
  import { keyBindings as pageBindings, type KeyBindingsState } from './keyBindingsState.svelte.ts';
  import LogoutDialog from './LogoutDialog.svelte';
  import Segments from './Segments.svelte';
  import {
    INTRO_CHOICES,
    MOTIONS,
    UI_SCALES,
    type IntroChoice,
    type Motion,
    type UiScale,
  } from './settings.ts';
  import { settings as pageSettings, type SettingsState } from './settingsState.svelte.ts';
  import { SETTINGS_KEYS } from './settingsKeys.ts';

  interface Props {
    nick: string;
    hasPassword: boolean;
    map: MapFile | null;
    /** The bar: the nick opens the profile, the "?" How to play (#919). */
    onprofile: () => void;
    onhowto: () => void;
    /** The display settings and the sound of the page; tests pass their own. */
    settings?: SettingsState;
    sound?: SoundState;
    /** The key bindings of the page (#966); tests pass their own. */
    bindings?: KeyBindingsState;
    onpassword: () => void;
    onlogout: () => void;
    /** Esc: back to the screen the settings were opened from. */
    onback: () => void;
  }

  let {
    nick,
    hasPassword,
    map,
    settings = pageSettings,
    sound = pageSound,
    bindings = pageBindings,
    onpassword,
    onlogout,
    onback,
    onhowto,
    onprofile,
  }: Props = $props();

  let confirmingLogout = $state(false);
  /** The keys dialog is open (#966). */
  let editingKeys = $state(false);
  /** Holds the button that opens the keys dialog: the focus goes back to it on close. */
  let keysActs: HTMLDivElement | undefined = $state();

  function onkeydown(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
    // Under a dialog (theme/modal.ts) the screen's keys do not arrive at all.
    if (event.key === 'Escape') {
      event.preventDefault();
      onback();
    }
  }

  function logout(): void {
    if (hasPassword) onlogout();
    else confirmingLogout = true;
  }

  const MOTION_KEYS = {
    system: 'settings.motion.system',
    full: 'settings.motion.full',
    reduced: 'settings.motion.reduced',
  } as const;
  const INTRO_KEYS = { session: 'settings.intro.session', off: 'settings.intro.off' } as const;

  const scales = $derived(
    UI_SCALES.map((n) => ({ value: n, label: tf('settings.scale.value', { n }) })),
  );
  const motions = $derived(MOTIONS.map((m) => ({ value: m, label: t(MOTION_KEYS[m]) })));
  const intros = $derived(INTRO_CHOICES.map((c) => ({ value: c, label: t(INTRO_KEYS[c]) })));
  // Each language is named in itself, so a viewer finds theirs in any UI language.
  const locales = LOCALES.map((l) => ({ value: l, label: translate(l, 'language.self') }));
</script>

<svelte:window {onkeydown} />

<SheetFrame
  {map}
  label={t('settings.title')}
  player={{ nick, guest: !hasPassword, onprofile }}
  onhelp={onhowto}
>
  <!-- The settings of this browser (#871, Lapis round 2 `settings`): display and language, sound
       and the account, then the keys, the way to the rules and the licences. -->
  <div class="settings">
    <div class="sheethead">
      <p class="kicker">{t('settings.kicker')}</p>
      <h2>{t('settings.title')}</h2>
    </div>
    <div class="cols">
      <div class="col">
        <section class="grp" aria-labelledby="set-display">
          <h3 class="sec" id="set-display">{t('settings.display')}</h3>
          <div class="set">
            <span class="sl">{t('settings.scale')}</span>
            <Segments
              label={t('settings.scale')}
              options={scales}
              value={settings.scale}
              onchange={(scale: UiScale) => {
                settings.set({ scale });
              }}
            />
          </div>
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
          <div class="set">
            <span class="sl">{t('settings.intro')}</span>
            <Segments
              label={t('settings.intro')}
              options={intros}
              value={settings.intro}
              onchange={(intro: IntroChoice) => {
                settings.set({ intro });
              }}
            />
          </div>
          <div class="set">
            <span class="sl">{t('hud.language')}</span>
            {#if hasLocaleChoice()}
              <Segments
                label={t('hud.language')}
                options={locales}
                value={getLocale()}
                onchange={(locale: Locale) => {
                  setLocale(locale);
                }}
              />
            {:else}
              <!-- One language ships: it is shown as the chosen segment, with nothing to choose. -->
              <span class="only" lang={getLocale()}>{translate(getLocale(), 'language.self')}</span>
            {/if}
          </div>
        </section>

        <section class="grp" aria-labelledby="set-keys">
          <h3 class="sec" id="set-keys">{t('settings.keys')}</h3>
          <dl class="keys">
            {#each SETTINGS_KEYS as [key, what] (what)}
              <div>
                <dt><kbd>{typeof key === 'string' ? key : bindings.label(key.action)}</kbd></dt>
                <dd>{t(what)}</dd>
              </div>
            {/each}
          </dl>
          <div class="acts keys-acts" bind:this={keysActs}>
            <LapisButton
              onclick={() => {
                editingKeys = true;
              }}>{t('settings.keys.change')}</LapisButton
            >
          </div>
        </section>
      </div>

      <div class="col">
        <section class="grp" aria-labelledby="set-sound">
          <h3 class="sec" id="set-sound">{t('settings.sound')}</h3>
          <div class="set">
            <span class="sl" id="set-sound-label">{t('settings.sound')}</span>
            <button
              type="button"
              class="switch"
              role="switch"
              aria-checked={!sound.muted}
              aria-labelledby="set-sound-label"
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
            <span class="sl" id="set-volume-label">{t('settings.volume')}</span>
            <span class="range">
              <input
                type="range"
                min="0"
                max="100"
                step="5"
                value={sound.volume}
                aria-labelledby="set-volume-label"
                oninput={(event) => {
                  sound.setVolume(Number(event.currentTarget.value));
                }}
              />
              <span class="num" aria-hidden="true">{sound.volume}</span>
            </span>
          </div>
        </section>

        <section class="grp" aria-labelledby="set-account">
          <h3 class="sec" id="set-account">{t('settings.account')}</h3>
          <div class="set">
            <span class="sl nick">{nick}</span>
            <span class="sv"
              >{hasPassword ? t('settings.account.password') : t('settings.account.guest')}</span
            >
          </div>
          <div class="acts">
            <LapisButton onclick={onpassword}
              >{hasPassword ? t('menu.changePassword') : t('menu.setPassword')}</LapisButton
            >
            <button type="button" class="lnk danger" onclick={logout}>{t('menu.logout')}</button>
          </div>
        </section>

        <section class="grp" aria-labelledby="set-learn">
          <h3 class="sec" id="set-learn">{t('settings.learn')}</h3>
          <div class="acts first">
            <LapisButton onclick={onhowto}>{t('help.howTo')}</LapisButton>
          </div>
        </section>

        <section class="grp" aria-labelledby="set-about">
          <h3 class="sec" id="set-about">{t('settings.about')}</h3>
          <p class="small">
            {t('settings.about.licences')}
            <a class="lnk" href="/impressum#licenses-title" target="_blank" rel="noopener"
              >{t('legal.licenses')}</a
            >
          </p>
          <p class="small">{t('howto.copyright')}</p>
        </section>
      </div>
    </div>
  </div>

  {#snippet overlay()}
    {#if editingKeys}
      <KeysDialog
        {bindings}
        onclose={() => {
          editingKeys = false;
          // The focus goes back to the button that opened the dialog.
          keysActs?.querySelector('button')?.focus();
        }}
      />
    {/if}
    {#if confirmingLogout}
      <LogoutDialog
        onpassword={() => {
          confirmingLogout = false;
          onpassword();
        }}
        {onlogout}
        onstay={() => {
          confirmingLogout = false;
        }}
      />
    {/if}
  {/snippet}
</SheetFrame>

<style>
  .settings {
    max-width: 1100px;
  }

  .sheethead p {
    margin: 0;
  }

  /* Two columns, as the mockup: Display and the keys, then the sound, the account and the rest;
     one column where the sheet is narrow (a small window or a large interface scale). */
  .cols {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(440px, 1fr));
    gap: 0 88px;
  }

  .grp + .grp {
    margin-top: 6px;
  }

  .sl,
  .sec {
    font: 500 11.5px / 1.3 var(--font-display);
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--ink-dim);
  }

  /* A section label with its incised rule running to the right edge. */
  .sec {
    display: flex;
    align-items: center;
    gap: 18px;
    margin: 34px 0 14px;
  }

  .col > .grp:first-child .sec {
    margin-top: 0;
  }

  .sec::after {
    content: '';
    flex: 1;
    border-top: 1px solid var(--cut);
    box-shadow: 0 1px 0 var(--line);
  }

  /* One setting: its name, then its control, over a faint rule. */
  .set {
    display: grid;
    grid-template-columns: 190px minmax(0, 1fr);
    align-items: center;
    gap: 12px;
    padding: 12px 0;
    border-top: 1px solid rgb(61 55 45 / 50%);
  }

  .sl.nick {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--ink);
    font-size: 13px;
    letter-spacing: 0.16em;
  }

  .sv {
    color: var(--ink-dim);
    font-style: italic;
  }

  .only {
    justify-self: start;
    padding: 8px 14px 7px;
    border: 1px solid var(--ink);
    background: var(--ink);
    color: var(--stone-bg);
    font: 500 11px / 1.3 var(--font-display);
    letter-spacing: 0.16em;
    text-transform: uppercase;
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
    width: 220px;
    max-width: 100%;
    accent-color: var(--ink);
  }

  .range .num {
    min-width: 3ch;
    font-variant-numeric: tabular-nums;
  }

  .acts {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 16px;
    margin-top: 20px;
  }

  .acts.first {
    margin-top: 0;
  }

  .lnk.danger {
    color: var(--enemy-lapis);
  }

  .keys {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px 24px;
    margin: 0;
  }

  .keys div {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .keys dd {
    margin: 0;
    font-size: 17px;
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

  .small {
    margin: 0 0 8px;
    color: var(--ink-dim);
    font-size: 17px;
  }

  .small .lnk {
    font-size: 17px;
  }

  /* A short window (1280 x 720): the sections close up so the page needs no scroll bar (#928). */
  @media (max-height: 760px) {
    .sec {
      margin: 20px 0 8px;
    }

    .set {
      padding: 8px 0;
    }

    .acts {
      margin-top: 14px;
    }
  }
</style>
