<script lang="ts">
  import { untrack } from 'svelte';
  import Icon from '../hud/Icon.svelte';
  import { t, type MessageKey } from '../i18n/index.ts';
  import type { MapFile } from '../protocol.gen.ts';
  import { failureText, passwordLengthOk, type AccountFailure } from './account.ts';
  import LocaleSelect from './LocaleSelect.svelte';
  import PasswordFields from './PasswordFields.svelte';
  import ScreenFrame from './ScreenFrame.svelte';
  import { reducedMotion } from '../render/motion.ts';
  import { claimIntro } from './introScene.ts';
  import { runIntro } from './introPlayer.ts';

  type Mode = 'guest' | 'login' | 'register';

  interface Props {
    /** An invite link was opened: the nick form leads straight into that match. */
    invited: boolean;
    notice: MessageKey | null;
    /** The map drawn behind the form, blurred (null: the plain dark page). */
    map?: MapFile | null;
    /** Play as a guest: a nick and nothing else. */
    onsubmit: (nick: string) => Promise<void>;
    /** Log in to an account (#374); why it failed, or null. */
    onlogin: (nick: string, password: string) => Promise<AccountFailure | null>;
    /** A new account: nick and password in one go (#374); why it failed, or null. */
    onregister: (nick: string, password: string) => Promise<AccountFailure | null>;
    /**
     * The first entry of the page (#826): the opening scene plays, once a browser session, unless
     * motion is reduced. Read once, when the screen opens.
     */
    intro?: boolean;
    /** The dev scene: the opening scene frozen at this moment (seconds). */
    introAt?: number | null;
  }

  let {
    invited,
    notice,
    map = null,
    onsubmit,
    onlogin,
    onregister,
    intro = false,
    introAt = null,
  }: Props = $props();

  // The opening scene: decided once when the screen opens (the session mark is taken then).
  const frozenAt = untrack(() => introAt);
  let playing = $state(
    untrack(
      () =>
        frozenAt !== null || (intro && claimIntro(() => window.sessionStorage, reducedMotion())),
    ),
  );
  let root: HTMLDivElement | undefined = $state();
  let title: HTMLHeadingElement | undefined = $state();
  let grainCanvas: HTMLCanvasElement | undefined = $state();
  let cover: HTMLDivElement | undefined = $state();
  let stageCanvas: HTMLCanvasElement | undefined = $state();
  let skipButton: HTMLButtonElement | undefined = $state();

  $effect(() => {
    if (!playing) return undefined;
    const screen = root;
    const heading = title;
    const canvas = grainCanvas;
    const stage = cover;
    if (screen === undefined || heading === undefined || canvas === undefined) return undefined;
    if (stage === undefined) return undefined;
    const pick = (selector: string): HTMLElement[] => [
      ...screen.querySelectorAll<HTMLElement>(selector),
    ];
    return untrack(() =>
      runIntro(
        {
          root: screen,
          title: heading,
          canvas,
          cover: stage,
          skip: skipButton ?? null,
          // The nick with Play first, then Log in and Create account with the language.
          steps: [pick('.gate > .invited, .gate > .field'), pick('.gate > .alt, .locale')],
          stage:
            stageCanvas === undefined || untrack(() => map) === null
              ? null
              : { canvas: stageCanvas, map: untrack(() => map) as MapFile },
        },
        {
          at: frozenAt,
          onend: () => {
            playing = false;
            const active = document.activeElement;
            if (active === null || active === document.body) {
              screen.querySelector<HTMLInputElement>('.gate input')?.focus();
            }
          },
        },
      ),
    );
  });

  /** The nick rule of the server (3 to 16 characters: letters, digits, _ and -), told inline. */
  const NICK_MIN = 3;
  const NICK_CHARS = /^[\p{L}\p{N}_-]*$/u;

  /** The server's refusals of a nick, said shortly on this screen (#629). */
  const NOTICES: Partial<Record<MessageKey, MessageKey>> = {
    'error.api.conflict': 'welcome.error.taken',
    'error.api.invalid': 'welcome.error.invalid',
  };

  let mode = $state<Mode>('guest');
  let nick = $state('');
  let password = $state('');
  let repeat = $state('');
  let failure = $state.raw<AccountFailure | null>(null);
  let busy = $state(false);
  /** The field was left or submitted once: a short nick is told only then, not while typing. */
  let touched = $state(false);

  const typed = $derived(nick.trim());
  const nickError = $derived<MessageKey | null>(
    !NICK_CHARS.test(typed)
      ? 'welcome.error.chars'
      : typed.length > 0 && typed.length < NICK_MIN
        ? 'welcome.error.short'
        : null,
  );
  // A guest nick is checked here first; login and registration ask the server as they did.
  const blocked = $derived(mode === 'guest' && (typed.length < NICK_MIN || nickError !== null));
  const shownError = $derived<string | null>(
    failure !== null
      ? failureText(failure)
      : mode === 'guest' && nickError !== null && (touched || nickError === 'welcome.error.chars')
        ? t(nickError)
        : notice !== null
          ? t(NOTICES[notice] ?? notice)
          : null,
  );

  function choose(next: Mode): void {
    mode = next;
    password = '';
    repeat = '';
    failure = null;
  }

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    touched = true;
    failure = null;
    if (blocked) return;
    if (mode === 'register') {
      if (!passwordLengthOk(password)) {
        failure = { key: 'error.account.passwordLength' };
        return;
      }
      if (password !== repeat) {
        failure = { key: 'error.account.mismatch' };
        return;
      }
    }
    busy = true;
    try {
      if (mode === 'guest') await onsubmit(typed);
      else if (mode === 'login') failure = await onlogin(typed, password);
      else failure = await onregister(typed, password);
    } finally {
      busy = false;
    }
  }

  // The title in cut capitals: the words, with the interpunct between them (Lapis, #845).
  const words = $derived(t('app.title').split(' '));

  const cta = $derived(
    mode === 'login'
      ? t('welcome.login')
      : mode === 'register'
        ? t('welcome.register')
        : invited
          ? t('welcome.join')
          : t('welcome.start'),
  );
</script>

<!-- The entry screen (#629; Lapis, #845): the title in cut capitals with its rule, the nick with
     Play beside it, the map dim behind. Logging in or creating an account opens a framed sheet of
     stone under the title. This is the still, final state; the opening scene is its own piece. -->
<ScreenFrame {map} label={t('app.title')} entry>
  <div class="welcome" class:intro={playing} bind:this={root}>
    {#if playing}
      <!-- The opening scene: the dark stage over the map (it fades as the title rises), with the
           pools of light of the fights at the edges cut into it (#839). -->
      <div class="cover" bind:this={cover} aria-hidden="true">
        <canvas class="stage" bind:this={stageCanvas}></canvas>
      </div>
    {/if}
    <h1 class="title" bind:this={title}>
      <!-- The space before a word is in its text, for assistive technology; the interpunct shows.
           The grain canvas draws the letters while they form; it holds no text. -->
      {#if playing}<canvas class="grain" bind:this={grainCanvas} aria-hidden="true"
        ></canvas>{/if}{#each words as word, i (i)}{#if i > 0}<span class="sp"></span>{/if}<span
          class="w">{i > 0 ? ` ${word}` : word}</span
        >{/each}
    </h1>
    {#if mode === 'guest'}
      <form class="gate" onsubmit={submit}>
        {#if invited}
          <p class="invited"><span class="chip inv">{t('welcome.invitedChip')}</span></p>
        {/if}
        <div class="field" class:bad={shownError !== null}>
          <div class="box">
            <label class="nick">
              <span class="label">{t('welcome.nick')}</span>
              <!-- svelte-ignore a11y_autofocus -->
              <input
                bind:value={nick}
                autofocus
                required
                maxlength="16"
                name="username"
                placeholder={t('welcome.nickPlaceholder')}
                autocomplete="nickname"
                spellcheck="false"
                aria-invalid={shownError !== null}
                aria-describedby={shownError === null ? undefined : 'welcome-error'}
                onblur={() => {
                  if (typed.length > 0) touched = true;
                }}
              />
            </label>
            <button type="submit" class="go lapis-btn primary" disabled={busy || blocked}
              >{cta}</button
            >
          </div>
          {#if shownError !== null}
            <p class="err" id="welcome-error" role="alert">
              <Icon name="alert" size={15} />{shownError}
            </p>
          {/if}
        </div>
        <div class="alt">
          <button
            type="button"
            class="small"
            onclick={() => {
              choose('login');
            }}>{t('welcome.toLogin')}</button
          >
          <button
            type="button"
            class="small"
            onclick={() => {
              choose('register');
            }}>{t('welcome.toRegister')}</button
          >
        </div>
      </form>
    {:else}
      <form class="gate sheet rule-frame" onsubmit={submit}>
        <h2 class="formh">
          {mode === 'login' ? t('welcome.login') : t('welcome.registerTitle')}
        </h2>
        {#if shownError !== null}
          <p class="err" id="welcome-error" role="alert">
            <Icon name="alert" size={15} />{shownError}
          </p>
        {/if}
        <label class="field">
          <span class="label">{t('welcome.nick')}</span>
          <span class="box">
            <!-- svelte-ignore a11y_autofocus -->
            <input
              bind:value={nick}
              autofocus
              required
              maxlength="16"
              name="username"
              autocomplete="username"
              spellcheck="false"
              aria-invalid={shownError !== null}
            />
          </span>
        </label>
        {#if mode === 'login'}
          <label class="field">
            <span class="label">{t('account.password')}</span>
            <span class="box">
              <input
                type="password"
                name="password"
                bind:value={password}
                required
                maxlength="1024"
                autocomplete="current-password"
              />
            </span>
          </label>
        {:else}
          <div class="pw"><PasswordFields bind:password bind:repeat /></div>
        {/if}
        <button type="submit" class="lapis-btn primary wide" disabled={busy}>{cta}</button>
        <div class="alt">
          <button
            type="button"
            class="small"
            onclick={() => {
              choose('guest');
            }}>{t('welcome.toGuest')}</button
          >
          {#if mode !== 'login'}
            <button
              type="button"
              class="small"
              onclick={() => {
                choose('login');
              }}>{t('welcome.toLogin')}</button
            >
          {:else}
            <button
              type="button"
              class="small"
              onclick={() => {
                choose('register');
              }}>{t('welcome.toRegister')}</button
            >
          {/if}
        </div>
      </form>
    {/if}
    <div class="locale"><LocaleSelect /></div>
    {#if playing && frozenAt === null}
      <button type="button" class="skip" bind:this={skipButton}>{t('welcome.introSkip')}</button>
    {/if}
  </div>
</ScreenFrame>

<style>
  .welcome {
    display: flex;
    flex-direction: column;
    align-items: center;
    box-sizing: border-box;
    min-height: 100%;
    padding: clamp(28px, 19vh, 150px) 24px 40px;
  }

  /* The title (ui-style 51): Cinzel with the Atlas rule under it and an interpunct between the words. */
  .title {
    position: relative;
    margin: 0;
    font: 400 67px / 1.1 var(--font-display);
    letter-spacing: 0.15em;
    white-space: nowrap;
    text-align: center;
    color: var(--ink);
    text-shadow:
      0 -1px 0 #000,
      0 2px 0 rgb(236 228 209 / 12%);
  }

  .title::after {
    content: '';
    position: absolute;
    left: 50%;
    top: 100%;
    /* --sp grows the rule and the interpunct in the opening scene; 1 is the still screen. */
    width: calc(var(--sp, 1) * 180px);
    margin: 4px 0 0 calc(var(--sp, 1) * -90px);
    border-top: 1.5px solid var(--ink);
    box-shadow: 0 -1px 0 rgb(0 0 0 / 85%);
    opacity: calc(0.35 + 0.65 * var(--sp, 1));
  }

  .title .w {
    display: inline-block;
  }

  .title .sp {
    position: relative;
    display: inline-block;
    width: 0.62em;
  }

  .title .sp::after {
    content: '';
    position: absolute;
    left: 50%;
    top: -0.5em;
    margin-left: -0.07em;
    border-left: 0.07em solid transparent;
    border-right: 0.07em solid transparent;
    border-top: 0.12em solid var(--ink);
    opacity: var(--sp, 1);
  }

  /* The nick and Play on one incised line. */
  .gate {
    display: grid;
    width: min(470px, 100%);
    margin-top: 94px;
  }

  .invited {
    margin: 0 0 18px;
    text-align: center;
  }

  .invited .chip {
    border-color: var(--own-lapis);
    color: var(--own-lapis);
  }

  .gate .field input {
    font-size: 24px;
  }

  .nick {
    display: grid;
    flex: 1;
    gap: 6px;
    min-width: 0;
  }

  .go.lapis-btn {
    align-self: flex-end;
    margin-bottom: 6px;
    height: 46px;
    margin-left: 14px;
    padding: 0 26px;
    font-size: 14px;
    letter-spacing: 0.24em;
  }

  .err {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 6px 0 0;
    color: var(--warn);
    font-size: 16px;
    font-style: italic;
  }

  .alt {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    align-items: center;
    margin-top: 26px;
  }

  .small {
    padding: 6px 2px;
    border: 0;
    background: none;
    color: var(--ink-dim);
    font: 500 12px / 1.2 var(--font-display);
    letter-spacing: 0.22em;
    text-transform: uppercase;
    cursor: pointer;
  }

  .small:hover {
    color: var(--ink);
  }

  .small + .small::before {
    content: '';
    display: inline-block;
    margin: 0 20px;
    border-left: 3px solid transparent;
    border-right: 3px solid transparent;
    border-top: 4px solid var(--ink-dim);
    vertical-align: 4px;
  }

  /* Log in, create an account: a sheet of stone in the Double rule frame. */
  .gate.sheet {
    gap: 18px;
    box-sizing: border-box;
    width: min(540px, 100%);
    margin-top: 44px;
    padding: 34px 50px 30px;
    background:
      linear-gradient(rgb(24 21 17 / 60%), rgb(24 21 17 / 60%)),
      var(--stone-tex) rgb(24 21 17 / 90%);
  }

  .formh {
    margin: 0;
    padding-bottom: 6px;
    font: 400 22px / 1.2 var(--font-display);
    letter-spacing: 0.16em;
    text-align: center;
  }

  .sheet .alt {
    margin-top: 8px;
  }

  .wide {
    width: 100%;
  }

  /* The new-password fields of PasswordFields: the same labels and incised lines. */
  .pw {
    display: grid;
    gap: 18px;
  }

  .pw :global(label) {
    display: grid;
    gap: 6px;
    font: 500 11.5px / 1.3 var(--font-display);
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--ink-dim);
  }

  .pw :global(input) {
    box-sizing: border-box;
    width: 100%;
    padding: 8px 0 10px;
    border: 0;
    border-bottom: 1px solid var(--cut);
    border-radius: 0;
    box-shadow: 0 1px 0 var(--line);
    background: none;
    color: var(--ink);
    font: 400 20px / 1.2 var(--font-text);
    letter-spacing: 0.02em;
  }

  .pw :global(input:focus-visible) {
    outline: none;
    border-bottom-color: var(--ink);
    box-shadow: 0 1px 0 var(--ink);
  }

  .pw :global(.hint) {
    margin: -10px 0 0;
    font-size: 15px;
  }

  /* ---- The opening scene (#826, intro B Grain): its frames are set by introPlayer.ts. ---- */
  .cover {
    position: fixed;
    inset: 0;
    background: #0b0a08;
    pointer-events: none;
  }

  /* The stage canvas paints the dark, with the pools of the fights cut into it (#839). */
  .cover:global(.staged) {
    background: none;
  }

  .stage {
    display: block;
    width: 100%;
    height: 100%;
  }

  .intro > :is(.title, .gate, .locale) {
    position: relative;
    z-index: 1;
  }

  .intro .title {
    --sp: 0;

    transform-origin: 50% 0;
  }

  /* While the letters form, the grain canvas draws them; the real title shows once they are solid. */
  .intro .title:not(:global(.solid)) {
    color: transparent;
    text-shadow: none;
  }

  .grain {
    position: absolute;
    left: 0;
    top: 0;
    pointer-events: none;
  }

  .intro .gate > :global(*),
  .intro .locale {
    opacity: var(--q, 0);
    transform: translateY(calc((1 - var(--q, 0)) * 10px));
  }

  .skip {
    position: fixed;
    right: 40px;
    bottom: 32px;
    padding: 6px 2px;
    border: 0;
    background: none;
    color: var(--ink-dim);
    font: 500 12px / 1.2 var(--font-display);
    letter-spacing: 0.3em;
    text-transform: uppercase;
    cursor: pointer;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.3s;
  }

  .skip:global(.shown) {
    opacity: 1;
    pointer-events: auto;
  }

  .skip:hover,
  .skip:focus-visible {
    color: var(--ink);
  }

  @media (max-height: 719px) {
    .gate {
      margin-top: 56px;
    }

    .gate.sheet {
      margin-top: 30px;
      padding: 26px 40px 24px;
      gap: 14px;
    }
  }

  @media (max-width: 699px) {
    .title {
      font-size: 40px;
    }

    .gate.sheet {
      padding: 26px 24px 24px;
    }
  }
</style>
