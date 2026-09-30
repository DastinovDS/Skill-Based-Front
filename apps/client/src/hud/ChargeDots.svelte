<script lang="ts">
  import { tf } from '../i18n/index.ts';
  import { chargeDots } from './format.ts';

  interface Props {
    units: number;
    charged: number;
  }

  let { units, charged }: Props = $props();
</script>

<!-- Filled dot: a charged unit, empty dot: a discharged one. The text is for screen readers. -->
<span class="dots" role="img" aria-label={tf('sel.chargedOf', { charged, units })}
  >{chargeDots(units, charged)}</span
>

<style>
  .dots {
    letter-spacing: 1px;
  }
</style>
