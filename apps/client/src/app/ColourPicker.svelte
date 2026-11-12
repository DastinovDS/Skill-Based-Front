<script lang="ts">
  import { t, tf, type MessageKey } from '../i18n/index.ts';
  import type { PlayerColour } from '../protocol.gen.ts';
  import { PLAYER_COLOUR_IDS, colourVar } from '../theme/tokens.ts';
  import HelmetIcon from '../units/HelmetIcon.svelte';

  interface Props {
    /** The colour the player asks for (DEC-49); null while unknown (Lapis is the server default). */
    value: PlayerColour | null;
    /** Saves a choice (`PUT /api/me/colour`); the answer is why it failed, or null. */
    onchange: (colour: PlayerColour) => Promise<MessageKey | null>;
    /** Smaller helmets (the lobby, where the list comes first). */
    compact?: boolean;
  }

  let { value, onchange, compact = false }: Props = $props();

  const uid = $props.id();
  const current = $derived(value ?? 'lapis');
  let buttons: HTMLButtonElement[] = $state([]);
  /** Why the last choice was not saved; the next choice clears it. */
  let failure = $state.raw<MessageKey | null>(null);
  /** The colour just saved, read out once (a screen reader hears the choice was kept). */
  let saved = $state.raw<PlayerColour | null>(null);

  async function pick(colour: PlayerColour): Promise<void> {
    if (colour === current && failure === null) return;
    failure = null;
    saved = null;
    const why = await onchange(colour);
    failure = why;
    saved = why === null ? colour : null;
  }

  /** Radio keys (as `Segments`): the arrows move the choice and the focus round, Home and End jump. */
  function onkeydown(event: KeyboardEvent, at: number): void {
    const last = PLAYER_COLOUR_IDS.length - 1;
    let next: number | null = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = at === last ? 0 : at + 1;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = at === 0 ? last : at - 1;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = last;
    const colour = next === null ? undefined : PLAYER_COLOUR_IDS[next];
    if (next === null || colour === undefined) return;
    event.preventDefault();
    buttons[next]?.focus();
    void pick(colour);
  }
</script>

<!-- The colour of the player in matches (DEC-49, #906): the six of the set as helmets with their
     names; the chosen one is framed in ink and its name is ink (also `aria-checked`), never the
     colour alone. -->
<div class="colours" class:compact>
  <span class="cap" id="{uid}-label">{t('colour.label')}</span>
  <div class="swatches" role="radiogroup" aria-labelledby="{uid}-label">
    {#each PLAYER_COLOUR_IDS as colour, i (colour)}
      {@const on = colour === current}
      <button
        bind:this={buttons[i]}
        type="button"
        role="radio"
        aria-checked={on}
        tabindex={on ? 0 : -1}
        style:--own={colourVar(colour)}
        onclick={() => {
          void pick(colour);
        }}
        onkeydown={(event) => {
          onkeydown(event, i);
        }}
      >
        <HelmetIcon side="own" size={compact ? 20 : 26} engraved />
        <span class="nm">{t(`colour.${colour}`)}</span>
      </button>
    {/each}
  </div>
  {#if failure !== null}
    <p class="fail" role="alert">{t(failure)}</p>
  {:else if saved !== null}
    <p class="sr" role="status">{tf('colour.saved', { colour: t(`colour.${saved}`) })}</p>
  {/if}
</div>

<style>
  .colours {
    display: grid;
    gap: 8px;
    justify-items: start;
  }

  .cap {
    font: 500 11.5px / 1.3 var(--font-display);
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--ink-dim);
  }

  .swatches {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  /* A cut tablet per colour: the helmet in it, the name under it. */
  button {
    display: grid;
    justify-items: center;
    gap: 4px;
    min-width: 72px;
    padding: 8px 6px 6px;
    border: 1px solid var(--line);
    border-radius: 0;
    background: none;
    color: var(--ink-dim);
    cursor: pointer;
  }

  button:hover {
    border-color: var(--rule);
    color: var(--ink);
  }

  button:focus-visible {
    outline: 2px solid var(--ink);
    outline-offset: 2px;
  }

  /* The chosen one: an ink frame with an inner rule (the Double rule of the Lapis frames). */
  button[aria-checked='true'] {
    border-color: var(--ink);
    box-shadow:
      inset 0 0 0 2px var(--stone-bg),
      inset 0 0 0 3px rgb(236 228 209 / 40%);
    color: var(--ink);
  }

  .compact button {
    min-width: 62px;
    padding: 6px 4px 5px;
  }

  .nm {
    font: 500 10.5px / 1.2 var(--font-display);
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }

  button[aria-checked='true'] .nm {
    text-decoration: underline;
    text-underline-offset: 3px;
  }

  .fail {
    margin: 0;
    color: var(--warn);
  }

  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    overflow: hidden;
    clip-path: inset(50%);
  }
</style>
