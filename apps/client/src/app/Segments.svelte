<script lang="ts" generics="T extends string | number">
  interface Option {
    value: T;
    label: string;
  }

  interface Props {
    /** The name of the group for assistive technology (the visible label of its row). */
    label: string;
    options: readonly Option[];
    value: T;
    onchange: (value: T) => void;
  }

  let { label, options, value, onchange }: Props = $props();

  let buttons: HTMLButtonElement[] = $state([]);

  /** Radio keys: the arrows move the choice (and the focus) round the group, Home and End jump. */
  function onkeydown(event: KeyboardEvent, at: number): void {
    const last = options.length - 1;
    let next: number | null = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = at === last ? 0 : at + 1;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = at === 0 ? last : at - 1;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = last;
    const option = next === null ? undefined : options[next];
    if (next === null || option === undefined) return;
    event.preventDefault();
    onchange(option.value);
    buttons[next]?.focus();
  }
</script>

<!-- A row of cut segments (#871, the mockup's `.segs`): the chosen one an ivory tablet; the state is
     also `aria-checked` and the inverted text, never colour alone. -->
<div class="segs" role="radiogroup" aria-label={label}>
  {#each options as option, i (option.value)}
    {@const on = option.value === value}
    <button
      bind:this={buttons[i]}
      type="button"
      role="radio"
      aria-checked={on}
      tabindex={on ? 0 : -1}
      onclick={() => {
        onchange(option.value);
      }}
      onkeydown={(event) => {
        onkeydown(event, i);
      }}>{option.label}</button
    >
  {/each}
</div>

<style>
  .segs {
    display: inline-flex;
    justify-self: start;
  }

  button {
    margin-right: -1px;
    padding: 8px 14px 7px;
    border: 1px solid var(--line);
    border-radius: 0;
    background: none;
    color: var(--ink-dim);
    font: 500 11px / 1.3 var(--font-display);
    letter-spacing: 0.16em;
    text-transform: uppercase;
    white-space: nowrap;
    cursor: pointer;
  }

  button:hover {
    color: var(--ink);
  }

  button[aria-checked='true'] {
    position: relative;
    border-color: var(--ink);
    background: var(--ink);
    color: var(--stone-bg);
  }
</style>
