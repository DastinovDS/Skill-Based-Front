/** @type {import("@sveltejs/vite-plugin-svelte").SvelteConfig} */
export default {
  compilerOptions: {
    // Svelte 5 runes only: no `export let`, `$:` or stores for component state (AGENTS.md §13).
    runes: true,
  },
};
