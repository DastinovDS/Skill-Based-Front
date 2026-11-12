<script lang="ts">
  import type { Snippet } from 'svelte';
  import { modal } from '../theme/modal.ts';
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
    /** Escape: the safe way out (the match HUD routes the other keys itself). */
    onclose?: () => void;
    /** The body between the title and the buttons, if the title and the buttons say enough. */
    children?: Snippet;
    /** The buttons, in a row at the bottom. */
    actions: Snippet;
  }

  let {
    eyebrow,
    title,
    id,
    role = 'dialog',
    describedby,
    onclose,
    children,
    actions,
  }: Props = $props();
</script>

<!-- The frame of the match dialogs (#597): a stone panel in the Double rule frame with the Stepped
     corner (#919) on the dimmed match, an eyebrow over the title. -->
<div class="dlg-backdrop">
  <div
    class="dlg rule-frame"
    {role}
    aria-modal="true"
    aria-labelledby="{id}-title"
    aria-describedby={describedby}
    tabindex="-1"
    use:modal={{ onclose, passKeys: true }}
  >
    <p class="dlg-eyebrow">{eyebrow}</p>
    <h2 class="dlg-title" id="{id}-title">{title}</h2>
    {@render children?.()}
    <div class="dlg-acts">{@render actions()}</div>
  </div>
</div>
