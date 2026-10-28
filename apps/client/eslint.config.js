import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import svelte from 'eslint-plugin-svelte';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import ts from 'typescript-eslint';
import svelteConfig from './svelte.config.js';

export default defineConfig(
  { ignores: ['dist/', 'node_modules/'] },
  js.configs.recommended,
  ts.configs.strictTypeChecked,
  svelte.configs.recommended,
  prettier,
  svelte.configs.prettier,
  {
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: {
        projectService: true,
        extraFileExtensions: ['.svelte'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['**/*.svelte', '**/*.svelte.ts'],
    languageOptions: {
      parserOptions: {
        parser: ts.parser,
        svelteConfig,
      },
    },
  },
  {
    // AGENTS.md, section 7.2: PixiJS draws only the map. It is imported under src/render/ and in
    // src/main.ts (pixi.js/unsafe-eval and Assets preferences, before anything else loads);
    // the HUD and the rest of the client never touch it.
    files: ['**/*.ts', '**/*.js', '**/*.svelte'],
    ignores: ['src/render/**', 'src/main.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['pixi.js', 'pixi.js/*', '@pixi/*'],
              message: 'PixiJS is imported only under src/render/ and in src/main.ts.',
            },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ImportExpression[source.value=/^(pixi\\.js|@pixi\\/)/]',
          message: 'PixiJS is imported only under src/render/ and in src/main.ts.',
        },
      ],
    },
  },
  {
    files: ['*.js', '*.ts'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    // Plain JS config files are outside the TypeScript projects.
    files: ['**/*.js'],
    extends: [ts.configs.disableTypeChecked],
  },
);
