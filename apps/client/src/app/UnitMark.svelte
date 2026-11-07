<script lang="ts">
  import HelmetIcon from '../units/HelmetIcon.svelte';

  interface Props {
    /** Whose unit: the player's (blue, Rim facing right) or the opponent's (red, Cut facing left). */
    side: 'own' | 'enemy';
    /** Width in px. */
    size?: number;
    /** The share filled from the bottom: charged units (ui-style 9.5, #784). */
    share?: number;
  }

  let { side, size = 40, share = 1 }: Props = $props();
</script>

<!-- The unit of the map (#784): a helmet, filled from the bottom by the share. -->
<HelmetIcon {side} size={size + 8} {share} />
