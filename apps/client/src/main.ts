// Must run before any PixiJS renderer starts: replaces the `new Function` code generation of
// PixiJS with precompiled polyfills, so the CSP needs no 'unsafe-eval' (see csp.ts).
import 'pixi.js/unsafe-eval';
import { Assets } from 'pixi.js';
import { mount } from 'svelte';
import App from './App.svelte';
import './app.css';

// Texture decoding on the main thread: the CSP has worker-src 'none' (see csp.ts).
Assets.setPreferences({ preferWorkers: false });

const target = document.getElementById('app');
if (target === null) {
  throw new Error('#app element is missing in index.html');
}

export default mount(App, { target });
