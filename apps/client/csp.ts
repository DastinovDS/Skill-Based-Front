/**
 * Target Content-Security-Policy of the production client.
 *
 * Single source of truth: `vite preview` sends it (see vite.config.ts), and the Caddy image
 * generates its `header Content-Security-Policy` directive from it at build time
 * (deploy/caddy.Dockerfile, OPS-02 #81); deploy/check-caddy.sh compares the served header with it.
 * Print it with `node --input-type=module -e "import { CSP } from './csp.ts'; console.log(CSP)"`
 * in apps/client.
 *
 * Decisions (INF-03, #4):
 * - script-src 'self': no 'unsafe-eval'. PixiJS 8 generates shader/uniform sync code with
 *   `new Function` unless `pixi.js/unsafe-eval` is imported, which main.ts does first.
 * - worker-src 'none': the PixiJS texture loader would start workers from blob: URLs. main.ts
 *   turns them off with `Assets.setPreferences({ preferWorkers: false })`, textures decode on
 *   the main thread through fetch + createImageBitmap (covered by connect-src 'self').
 * - style-src 'self': in production vite-plugin-svelte emits component styles into a CSS file,
 *   no <style> injection. Setting styles from JS (`el.style.x = ...`, Svelte `style:` directives,
 *   PixiJS canvas sizing) goes through CSSOM and is not restricted by CSP. Static `style="..."`
 *   attributes in Svelte markup ARE blocked (the template is parsed from HTML), so do not use them.
 *   The dev server injects <style> tags and is not served under this policy.
 * - img-src data:: PixiJS format detection (avif/webp) probes with data: URI images.
 * - connect-src 'self': HTTP API and the match WebSocket are same-origin behind Caddy; CSP Level 3
 *   matches ws:/wss: of the same host with 'self'.
 */
export const CSP_DIRECTIVES: Readonly<Record<string, readonly string[]>> = {
  'default-src': ["'self'"],
  'script-src': ["'self'"],
  'style-src': ["'self'"],
  'img-src': ["'self'", 'data:'],
  'font-src': ["'self'"],
  'connect-src': ["'self'"],
  'worker-src': ["'none'"],
  'object-src': ["'none'"],
  'base-uri': ["'none'"],
  'form-action': ["'self'"],
  'frame-ancestors': ["'none'"],
};

export const CSP = Object.entries(CSP_DIRECTIVES)
  .map(([name, sources]) => `${name} ${sources.join(' ')}`)
  .join('; ');
