// Must run before any PixiJS renderer starts: replaces the `new Function` code generation of
// PixiJS with precompiled polyfills, so the CSP needs no 'unsafe-eval' (see csp.ts).
import 'pixi.js/unsafe-eval';
import { Assets } from 'pixi.js';
import { mount } from 'svelte';
import RootApp from './app/RootApp.svelte';
import LegalPage from './legal/LegalPage.svelte';
import LegalFooter from './legal/LegalFooter.svelte';
import DevScreen from './dev/DevScreen.svelte';
import ReplayScreen from './replay/ReplayScreen.svelte';
import './app.css';

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

export default legalPage !== null
  ? mount(LegalPage, { target, props: { page: legalPage } })
  : replayId !== null
    ? mount(ReplayScreen, { target, props: { matchId: replayId } })
    : devScreen
      ? mount(DevScreen, { target })
      : mount(RootApp, { target });
