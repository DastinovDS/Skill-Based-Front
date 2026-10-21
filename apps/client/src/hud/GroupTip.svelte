<script lang="ts">
  import type { GroupInfo } from './hudData.ts';
  import ChargeTip from './ChargeTip.svelte';
  import MapTip from './MapTip.svelte';

  interface Props {
    /** The group under the pointer; `null`: none. */
    group: GroupInfo | null;
  }

  let { group }: Props = $props();
</script>

<!-- The charges of the group under the pointer. The same group while its id is: the numbers
change under it every snapshot. -->
<MapTip identity={group === null ? null : group.id}>
  {#if group !== null}
    <ChargeTip units={group.units} charged={group.charged} />
  {/if}
</MapTip>
