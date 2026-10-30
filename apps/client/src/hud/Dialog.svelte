<script lang="ts">
  import type { Snippet } from 'svelte';
  import './dialog.css';

  interface Props {
    /** The small line over the title. */
    eyebrow: string;
    title: string;
    /** Prefix of the element ids the dialog names itself with. */
    id: string;
    role?: 'dialog' | 'alertdialog';
    /** The id of the element that describes the dialog, if any. */
    describedby?: string;
    onkeydown?: (event: KeyboardEvent) => void;
    /** The body between the title and the buttons. */
    children: Snippet;
    /** The buttons, in a row at the bottom. */
    actions: Snippet;
  }

  let {
    eyebrow,
    title,
    id,
    role = 'dialog',
    describedby,
    onkeydown,
    children,
    actions,
  }: Props = $props();
</script>

<!-- The frame of the match dialogs (#597): a panel on a scrim, an eyebrow over the title. -->
<div class="dlg-backdrop">
  <div
    class="dlg"
    {role}
    aria-modal="true"
    aria-labelledby="{id}-title"
    aria-describedby={describedby}
    tabindex="-1"
    {onkeydown}
  >
    <p class="dlg-eyebrow">{eyebrow}</p>
    <h2 class="dlg-title" id="{id}-title">{title}</h2>
    {@render children()}
    <div class="dlg-acts">{@render actions()}</div>
  </div>
</div>
