<script lang="ts">
  import { t, tf } from '../i18n/index.ts';
  import { ACTION_KEYS, type StatusAction, type StatusView } from './matchStatus.ts';
  import StatusBar from './StatusBar.svelte';
  import StatusButton from './StatusButton.svelte';

  interface Props {
    view: StatusView;
    /** The map could not be drawn too: the bar stands above that notice. */
    lifted?: boolean;
    onaction: (action: StatusAction) => void;
  }

  let { view, lifted = false, onaction }: Props = $props();

  const LABELS = {
    retry: 'match.retry',
    reload: 'match.reload',
    menu: 'match.toMenu',
    resume: 'match.resume',
  } as const;

  // The hotkey shows on the button only where the key really does it (see `statusKeyAction`).
  function keyOf(action: StatusAction): 'Enter' | 'Escape' | null {
    if (view.tone === 'info') return action === 'resume' ? 'Enter' : null;
    return ACTION_KEYS[action];
  }

  const KEY_CAPS = { Enter: '↵', Escape: 'Esc' } as const;
</script>

<!-- Bottom centre: the alert stack and the toasts own the top of the map. -->
<div class="dock" class:lifted>
  <StatusBar
    tone={view.tone}
    icon={view.icon}
    title={t(view.title)}
    text={view.text === null ? null : tf(view.text, { seconds: view.seconds ?? 0 })}
    role={view.role}
  >
    {#snippet actions()}
      {#each view.actions as action, index (action)}
        {@const key = keyOf(action)}
        <StatusButton
          primary={action !== 'menu' && index === 0}
          keyHint={key === null ? null : KEY_CAPS[key]}
          shortcut={key}
          onclick={() => {
            onaction(action);
          }}>{t(LABELS[action])}</StatusButton
        >
      {/each}
    {/snippet}
  </StatusBar>
</div>

<style>
  .dock {
    position: absolute;
    left: 50%;
    bottom: 16px;
    transform: translateX(-50%);
    z-index: 20;
    display: flex;
    justify-content: center;
    width: max-content;
    max-width: calc(100% - 32px);
  }

  .dock.lifted {
    bottom: 88px;
  }
</style>
