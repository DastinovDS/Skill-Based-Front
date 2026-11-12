// The one place PixiJS is set up for the CSP (see csp.ts). The renderer is loaded lazily, with the
// match, the replay and the dev scenes (ARC-C05, #482), so the entry chunk carries no PixiJS; every
// module that starts a renderer imports this file before `pixi.js`.

// Must run before any PixiJS renderer starts: replaces the `new Function` code generation of
// PixiJS with precompiled polyfills, so the CSP needs no 'unsafe-eval'.
import 'pixi.js/unsafe-eval';
import { Assets } from 'pixi.js';

// Texture decoding on the main thread: the CSP has worker-src 'none'.
Assets.setPreferences({ preferWorkers: false });
