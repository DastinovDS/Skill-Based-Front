<script lang="ts">
  import HelmetIcon from '../units/HelmetIcon.svelte';

  interface Props {
    /** Whose unit: the attacker (blue, Rim facing right) or the defender (red, Cut facing left). */
    side: 'own' | 'enemy';
    /** Charged: filled. Empty: outline only. Gone: dashed, the unit fell. */
    cell: 'charged' | 'empty' | 'gone';
  }

  let { side, cell }: Props = $props();
</script>

<!-- The unit of the map (#784): a helmet, full when charged, empty, or dashed when it fell. -->
<HelmetIcon {side} size={24} share={cell === 'charged' ? 1 : 0} dashed={cell === 'gone'} />
