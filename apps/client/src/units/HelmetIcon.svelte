<script lang="ts">
  import { HELMET_PATHS, clipBelow, helmetIcon } from './helmet.ts';

  interface Props {
    /** Whose helmet: the player's (blue, Rim, facing right) or the opponent's (red, Cut, facing left). */
    side: 'own' | 'enemy';
    /** Width in px. */
    size?: number;
    /** The share of the dome filled from the bottom: charged units (the level of the map, #784). */
    share?: number;
    /** A unit that fell: the dome dashed and faint, no fill. */
    dashed?: boolean;
    /**
     * The Engraved look of the match (#847, ui-style 57u): ink lines on a dark casing, the charge
     * solid in the side's colour, no charge the dark plate (hollow, never a lighter tone).
     */
    engraved?: boolean;
  }

  let { side, size = 40, share = 1, dashed = false, engraved = false }: Props = $props();

  // The same outlines as the map (`units/helmet.ts`), in their 100-unit box, with room for the casing.
  const PAD = 6;
  const icon = $derived(helmetIcon(side));
  const paths = $derived(HELMET_PATHS[side]);
  const box = $derived({
    x: icon.bounds.x - PAD,
    y: icon.bounds.y - PAD,
    width: icon.bounds.width + 2 * PAD,
    height: icon.bounds.height + 2 * PAD,
  });
  // The charge: the part of the dome under the level, a straight edge (no dividers).
  const fill = $derived.by(() => {
    const k = Math.max(0, Math.min(1, share));
    if (k <= 0) return '';
    const y = icon.domeBottom - k * (icon.domeBottom - icon.domeTop);
    return clipBelow(icon.dome, y)
      .map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`)
      .join(' ');
  });
  // The opponent's faces left: the drawing is mirrored about the middle of its box.
  const flip = $derived(
    side === 'enemy' ? `translate(${String(2 * box.x + box.width)} 0) scale(-1 1)` : undefined,
  );
</script>

<svg
  class="helmet-icon {side}"
  class:dashed
  class:engraved
  width={size}
  height={(size * box.height) / box.width}
  viewBox={`${String(box.x)} ${String(box.y)} ${String(box.width)} ${String(box.height)}`}
  aria-hidden="true"
  focusable="false"
>
  <g transform={flip}>
    <path d={paths.strap} class="casing" />
    {#if paths.band !== null}<path d={paths.band} class="casing" />{/if}
    <path d={paths.dome} class="casing" />
    <path d={paths.strap} class="gear" />
    {#if paths.band !== null}<path d={paths.band} class="gear" />{/if}
    <path d={paths.dome} class="plate" />
    {#if fill !== '' && !dashed}<polygon points={fill} class="fill" />{/if}
    <path d={paths.dome} class="edge" />
  </g>
</svg>

<style>
  .helmet-icon {
    flex: none;
    overflow: visible;
    --tone: var(--you);
  }
  .helmet-icon.enemy {
    --tone: var(--enemy);
  }
  .casing {
    fill: none;
    stroke: var(--bg);
    stroke-width: 13;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .gear {
    fill: none;
    stroke: color-mix(in srgb, var(--tone) 50%, var(--paper));
    stroke-width: 6.5;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .plate {
    fill: #161b22;
  }
  .fill {
    fill: var(--tone);
  }
  .dashed .casing,
  .dashed .plate {
    opacity: 0.5;
  }
  .dashed .gear,
  .dashed .edge {
    stroke: var(--text-dim);
  }
  .dashed .edge {
    stroke-dasharray: 10 8;
  }
  .edge {
    fill: none;
    stroke: color-mix(in srgb, var(--tone) 50%, var(--paper));
    stroke-width: 4.5;
    stroke-linejoin: round;
  }
  /* Engraved (#847): the mockup's `helmet`, an ink edge and strap on a dark casing. */
  .engraved {
    --tone: var(--own);
  }
  .engraved.enemy {
    --tone: var(--enemy);
  }
  .engraved .casing {
    stroke: var(--casing);
    stroke-width: 11;
  }
  .engraved .gear {
    stroke: var(--ink);
    stroke-width: 4;
  }
  .engraved .plate {
    fill: var(--plate);
  }
  .engraved .edge {
    stroke: var(--ink);
    stroke-width: 4;
  }
  /* An empty seat outside the match (#919): the dashed dome in the dim ink. */
  .engraved.dashed .gear,
  .engraved.dashed .edge {
    stroke: var(--ink-dim);
  }
</style>
