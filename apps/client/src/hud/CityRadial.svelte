<script lang="ts">
  import { getLocale, t, tf } from '../i18n/index.ts';
  import type { CityChoice, OrderController } from '../match/orderController.ts';
  import type { MapAnchors } from '../render/anchors.ts';
  import { cityChoices } from './cityChoices.ts';
  import { formatCentis } from './format.ts';
  import type { NodeInfo } from './hudData.ts';
  import type { NodeNamer } from './nodeName.ts';
  import Radial from './Radial.svelte';
  import { halfFor, spreadAngles, type RadialItem } from './radial.ts';

  interface Props {
    orders: OrderController;
    /** What the city looks like on screen: the menu is centred on its circle and follows it. */
    anchors: MapAnchors;
    /** Units in the recruit queue of the city (DEC-25, from the snapshot); `null`: unknown. */
    queue: number | null;
    /** The selected city (barracks, warehouse and its build of any kind, DEC-26); `null`: none. */
    city?: NodeInfo | null;
    /** The name of a place by its id. */
    names: NodeNamer;
  }

  let { orders, anchors, queue, city = null, names }: Props = $props();

  const menu = $derived(orders.cityMenu.current);
  const cp = (centis: number): string => formatCentis(centis, getLocale());

  // DEC-26: with the city development the menu also builds the barracks and the warehouse.
  // A sector shows only its glyph and its price (the name is the accessible name); the reason a
  // sector is off is on the map and in the panel, never a line of text here.
  // A sector with nothing to do (no recruit without a barracks, the barracks is built, the
  // warehouse is at its top level) is not drawn; the others spread evenly around the ring.
  const v2 = $derived(orders.v2);
  const province = $derived(menu.target !== null && orders.isProvince(menu.target));
  // #762: no factory at the factory max, no "Fortify road" once every road of the node has its line.
  const choices = $derived(
    cityChoices(
      { enabled: true, warehouse_max_level: 0 }, // removed (#894): stage 2 deletes this
      city,
      v2,
      province,
      orders.hasBunker,
      orders.hasFort,
      orders.factoriesFull,
      menu.target === null || orders.fortifiable(menu.target),
    ),
  );
  const count = $derived(choices.length);
  const items = $derived.by<RadialItem[]>(() => {
    const angles = spreadAngles(count);
    const costs = orders.cityCosts;
    const queued = queue ?? 0;
    // Own CP now; `null` (not known yet): nothing is dimmed for it.
    const funds = orders.cpNow;
    const poor = (centis: number): boolean => funds !== null && funds < centis;
    // A build of the city (the barracks or the warehouse) holds the other back.
    const busy = city?.building != null;
    // The price as signs (ui-style 57u, #829): CP as the number and the CP mark, charges as one
    // lozenge each, filled for those the warehouse holds and hollow for those the groups standing
    // there pay (DEC-41, item 7). The words go to the accessible name.
    const charges = orders.chargeCosts;
    const stock = city?.warehouse ?? 0;
    const priced = (
      label: string,
      centis: number,
      n: number,
    ): Pick<RadialItem, 'price' | 'aria'> => {
      const cpPart = centis > 0 ? cp(centis) : null;
      const chargePart = v2 && n > 0 ? n : null;
      if (cpPart === null && chargePart === null) return { aria: label };
      const words =
        cpPart !== null && chargePart !== null
          ? tf('price.cpAndCharges', { cost: cpPart, charges: chargePart })
          : cpPart !== null
            ? tf('price.cp', { cost: cpPart })
            : tf('price.charges', { charges: chargePart ?? 0 });
      return {
        price: {
          ...(cpPart !== null ? { cp: cpPart } : {}),
          ...(chargePart !== null
            ? { charges: chargePart, have: Math.min(stock, chargePart) }
            : {}),
        },
        aria: tf('price.label', { label, price: words }),
      };
    };
    const sector = (choice: CityChoice): Omit<RadialItem, 'angle'> => {
      switch (choice) {
        case 'recruit':
          return {
            id: 'recruit',
            icon: 'recruit',
            label: t('city.recruit'),
            ...priced(t('city.recruit'), costs.recruit, 0),
            key: 'R',
            compact: true,
            disabled: poor(costs.recruit) || queued >= orders.recruitQueueMax,
          };
        case 'barracks':
          return {
            id: 'barracks',
            icon: 'barracks',
            label: t('city.barracks'),
            ...priced(t('city.barracks'), costs.barracks, charges.barracks),
            compact: true,
            // Only a city known to lack it builds it (a built one has no sector at all).
            disabled: city?.hasBarracks !== false || busy || poor(costs.barracks),
          };
        case 'warehouse':
          return {
            id: 'warehouse',
            icon: 'warehouse',
            label: t('city.warehouse'),
            ...priced(t('city.warehouse'), costs.warehouse, charges.warehouse),
            compact: true,
            disabled: busy || poor(costs.warehouse),
          };
        case 'factory':
          return {
            id: 'factory',
            icon: 'factory',
            label: t('city.factory'),
            ...priced(t('city.factory'), 0, charges.factory),
            compact: true,
            // One factory build at a time in a city; the cap of factories is the server's call.
            disabled: city?.factoryBuild != null,
          };
        case 'fortify':
          return {
            id: 'fortify',
            icon: 'fortify',
            label: t('city.fortify'),
            ...priced(t('city.fortify'), orders.fortCost, 0),
            key: 'B',
            compact: true,
            // The road is picked next: the sector is dimmed by the CP only (a fight does not stop it).
            disabled: poor(orders.fortCost),
          };
        case 'bunker':
          return {
            id: 'bunker',
            icon: 'bunker',
            label: t('city.bunker'),
            ...priced(t('city.bunker'), 0, charges.bunker),
            compact: true,
            // A province keeps its sector once the bunker stands: it is shown as built.
            ...(city?.fort === true ? { current: true } : {}),
            disabled: city?.fort === true || city?.fortBuild != null,
          };
      }
    };
    return choices.map((choice, i) => ({ ...sector(choice), angle: angles[i] ?? 0 }));
  });

  /** The ring is this wide, CSS px (a bit narrower than before: 64). */
  const RING_WIDTH = 54;

  /** The hole is as wide as the city circle, and the ring starts just outside it. */
  const ring = $derived.by(() => {
    const circle = menu.target === null ? null : anchors.node(menu.target);
    const inner = Math.max(24, Math.round((circle?.r ?? 20) + 10));
    return { inner, outer: inner + RING_WIDTH };
  });
</script>

<!-- A click on an own city (UI round 2): its actions around the circle. R does the same. -->
{#if menu.open && menu.target !== null && count > 0}
  {@const target = menu.target}
  <Radial
    {items}
    label={tf(province ? 'city.titleProvince' : 'city.title', { node: names(target) })}
    at={() => anchors.node(target)}
    {ring}
    half={halfFor(count)}
    clamp={false}
    hover={menu.hover}
    onhover={(id: string | null) => {
      orders.cityMenu.hover(id as CityChoice | null);
    }}
    onchoose={(id: string) => {
      orders.chooseCity(id as CityChoice);
    }}
    onclose={() => {
      orders.closeCityMenu();
    }}
    closeLabel={t('city.close')}
  />
{/if}
