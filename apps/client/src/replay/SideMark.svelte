<script lang="ts">
  import HelmetIcon from '../units/HelmetIcon.svelte';

  interface Props {
    /** The viewing side (blue, Rim facing right) or the other one (red, Cut facing left). */
    side: 'own' | 'enemy';
    /** Width in px. */
    size?: number;
  }

  let { side, size = 16 }: Props = $props();
</script>

<!-- The unit of the map (#784): the side is the colour plus the helmet's shape and facing, never colour alone. -->
<HelmetIcon {side} size={size + 2} engraved />
