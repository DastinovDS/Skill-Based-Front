// Appends the runtime constants of the schema (`x-constants`, see gow_protocol.schema) to the
// generated TypeScript types. Part of `pnpm gen:protocol`, runs before prettier.
import { appendFileSync, readFileSync } from 'node:fs';

const schemaPath = new URL('../../../packages/protocol/protocol.schema.json', import.meta.url);
const outPath = new URL('../src/protocol.gen.ts', import.meta.url);

const constants = JSON.parse(readFileSync(schemaPath, 'utf8'))['x-constants'];
if (constants === null || typeof constants !== 'object') {
  throw new Error('protocol.schema.json has no x-constants');
}
const lines = Object.entries(constants).map(([name, value]) => {
  if (!Number.isInteger(value)) {
    throw new Error(`x-constants.${name} must be an integer`);
  }
  return `export const ${name} = ${String(value)};`;
});
appendFileSync(outPath, `\n${lines.join('\n')}\n`);
