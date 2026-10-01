// Must run before any PixiJS renderer starts: replaces the `new Function` code generation of
// PixiJS with precompiled polyfills, so the CSP needs no 'unsafe-eval' (see csp.ts).
import 'pixi.js/unsafe-eval';
import { Assets } from 'pixi.js';
import { mount } from 'svelte';
import App from './App.svelte';
import ReplayScreen from './replay/ReplayScreen.svelte';
import './app.css';

// Texture decoding on the main thread: the CSP has worker-src 'none' (see csp.ts).
Assets.setPreferences({ preferWorkers: false });

const target = document.getElementById('app');
if (target === null) {
  throw new Error('#app element is missing in index.html');
}

// `/?replay=<match id>` opens the replay viewer (CLI-10); the result screen of CLI-09 links there
// (`replayUrl`). `?replay=dev` plays the bundled sample in a dev build.
const replayId = new URLSearchParams(window.location.search).get('replay');

export default replayId === null
  ? mount(App, { target })
  : mount(ReplayScreen, { target, props: { matchId: replayId } });
