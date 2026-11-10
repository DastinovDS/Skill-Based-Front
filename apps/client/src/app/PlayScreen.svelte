<script lang="ts">
  import type { QueueStatus } from '../api/http.ts';
  import { t, type MessageKey } from '../i18n/index.ts';
  import FrontTop from './FrontTop.svelte';
  import IdlePlinth from './IdlePlinth.svelte';
  import InvitePlinth from './InvitePlinth.svelte';
  import MenuBackdrop from './MenuBackdrop.svelte';
  import NewHereDialog from './NewHereDialog.svelte';
  import type { BackdropState, PlayContext, PlayState } from './play.ts';
  import './plinth.css';
  import QueuePlinth from './QueuePlinth.svelte';

  interface Props {
    ctx: PlayContext;
    view: PlayState;
    /** Why the last action failed, from the app. */
    notice?: MessageKey | null;
    /** The main-screen motion plays on this entry (not when coming back from a page). */
    entrance?: boolean;
    /** "New here?" shows (#919, item 6; `showNewHere` of play.ts decides). */
    newHere?: boolean;
    onnewhere?: (learn: boolean, never: boolean) => void;
    /** A fixed queue status and no server (the dev scenes). */
    queueFixed?: QueueStatus | null;
  }

  let {
    ctx,
    view,
    notice = null,
    entrance = false,
    newHere = false,
    onnewhere = () => undefined,
    queueFixed = null,
  }: Props = $props();

  let backdrop = $state<BackdropState>({ phase: 'idle', opponent: null, waited: 0 });
  const setBackdrop = (next: BackdropState): void => {
    backdrop = next;
  };

  /** The queue and the waiting room hold the player: the bar opens nothing while they run. */
  const locked = $derived(view.name !== 'menu');
  /** The sketch's width on the plinth; CSS sets the real one per window size (`--grw`). */
  const DRAW_W = 120;
</script>

<!-- The main screen (#919, direction III Plinth; docs/design/mockups/out-of-game-rework-r2.html):
     the menu map fills the screen, the bar on top (brand, "?", the player), and at the foot a stone
     plinth with the three ways, the status and one main button. Play a bot raises its options as a
     drawer above the plinth. -->
<main class="front play">
  <MenuBackdrop
    map={ctx.map}
    phase={backdrop.phase}
    opponent={backdrop.opponent}
    waited={backdrop.waited}
  />
  <div class="shade"></div>
  <FrontTop
    player={{ nick: ctx.nick, guest: !ctx.hasPassword, onprofile: ctx.onprofile }}
    onhelp={ctx.onhelp}
    {locked}
  />
  <section class="foot" aria-label={t('menu.nav')}>
    {#if view.name === 'queue'}
      <QueuePlinth
        api={ctx.api}
        token={ctx.token}
        nick={ctx.nick}
        fixed={queueFixed}
        onstart={ctx.onstart}
        onbot={ctx.onofferbot}
        onbanned={ctx.onbanned}
        onleave={(why: MessageKey | null) => {
          ctx.onleave(why, 'match');
        }}
        onbackdrop={setBackdrop}
      />
    {:else if view.name === 'invite'}
      {#key view.code}
        <InvitePlinth
          api={ctx.api}
          token={ctx.token}
          nick={ctx.nick}
          code={view.code}
          drawWidth={DRAW_W}
          onstart={ctx.onstart}
          onleave={(why: MessageKey | null) => {
            ctx.onleave(why, 'friend');
          }}
          onbackdrop={setBackdrop}
        />
      {/key}
    {:else}
      {#key view.start}
        <IdlePlinth
          {ctx}
          way={view.way ?? 'match'}
          start={view.start}
          {notice}
          {entrance}
          drawWidth={DRAW_W}
          onbackdrop={setBackdrop}
        />
      {/key}
    {/if}
  </section>
  {#if newHere}
    <NewHereDialog onclose={onnewhere} />
  {/if}
</main>
