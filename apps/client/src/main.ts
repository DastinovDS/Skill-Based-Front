// Must run before any PixiJS renderer starts: replaces the `new Function` code generation of
// PixiJS with precompiled polyfills, so the CSP needs no 'unsafe-eval' (see csp.ts).
import 'pixi.js/unsafe-eval';
import { Assets } from 'pixi.js';
import { mount } from 'svelte';
import RootApp from './app/RootApp.svelte';
import LegalPage from './legal/LegalPage.svelte';
import LegalFooter from './legal/LegalFooter.svelte';
import { loadGuest } from './api/guestStore.ts';
import ReplayScreen from './replay/ReplayScreen.svelte';
import { installErrorLog } from './errorLog.ts';
import './app.css';

// What nothing else catches (an uncaught error, an unhandled rejection) is logged, without tokens.
installErrorLog(window);

// Texture decoding on the main thread: the CSP has worker-src 'none' (see csp.ts).
Assets.setPreferences({ preferWorkers: false });

const target = document.getElementById('app');
if (target === null) {
  throw new Error('#app element is missing in index.html');
}

// `/?replay=<match id>` opens the replay viewer (CLI-10); `?replay=dev` plays the bundled sample in
// a dev build. In a dev build `?scene=<id>` and `?dev` open the dev screen (a bundled map with
// protocol fixtures, the Playwright reference screenshots use it). Everything else is the
// application with its screens (CLI-09); an invite link is `/?m=<code>`.
const params = new URLSearchParams(window.location.search);
const replayId = params.get('replay');
const devScreen = import.meta.env.DEV && (params.has('scene') || params.has('dev'));
// `?menu=<id>`: a screen before a match with fixed data (dev build, `mise run shots`, #471).
const devMenus = import.meta.env.DEV && params.has('menu');

// `/impressum` and `/privacy` are the static legal pages (LEG-01); Caddy serves index.html for them.
const legalPage =
  window.location.pathname === '/impressum'
    ? 'impressum'
    : window.location.pathname === '/privacy'
      ? 'privacy'
      : null;

// Every screen of the game carries the links to the legal pages (the pages themselves do not).
if (legalPage === null && !devScreen) {
  mount(LegalFooter, { target: document.body });
}

// The dev screen is imported only in a dev build: its modules read protocol fixtures from
// `packages/protocol/fixtures`, which the production image build does not copy, so a static
// import would throw at load time and leave the production page blank (QA-01, #68).
async function start(target: HTMLElement) {
  if (legalPage !== null) return mount(LegalPage, { target, props: { page: legalPage } });
  if (replayId !== null) {
    // A direct link has no screen to go back to: "Back" opens the start page. The saved guest
    // opens the replay of their own private or bot match (those are for the players only).
    const token = loadGuest(() => window.localStorage)?.token ?? null;
    const onback = () => {
      window.location.assign('/');
    };
    return mount(ReplayScreen, { target, props: { matchId: replayId, token, onback } });
  }
  if (devMenus) {
    const { default: DevMenus } = await import('./dev/DevMenus.svelte');
    return mount(DevMenus, { target });
  }
  if (import.meta.env.DEV && devScreen) {
    const { default: DevScreen } = await import('./dev/DevScreen.svelte');
    return mount(DevScreen, { target });
  }
  return mount(RootApp, { target });
}

export default await start(target);
