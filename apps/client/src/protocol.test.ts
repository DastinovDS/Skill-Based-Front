// @vitest-environment node
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import type { ClientMsg, ServerMsg } from './protocol.gen.ts';

// The fixtures of PRO-01 (#44), which the Python tests validate against the Pydantic models, must
// also type-check against the generated types: each one is compiled as
// `export const msg = <fixture> satisfies ClientMsg` (or `ServerMsg`). A JSON import would not do:
// TypeScript widens its strings, so `"type": "hello"` would be `string` and never match a union.
const clientFixtures = import.meta.glob<string>(
  '../../../packages/protocol/fixtures/client/*.json',
  {
    eager: true,
    import: 'default',
    query: '?raw',
  },
);
const serverFixtures = import.meta.glob<string>(
  '../../../packages/protocol/fixtures/server/*.json',
  {
    eager: true,
    import: 'default',
    query: '?raw',
  },
);

const SRC_DIR = decodeURIComponent(new URL('.', import.meta.url).pathname);

const COMPILER_OPTIONS: ts.CompilerOptions = {
  strict: true,
  noEmit: true,
  target: ts.ScriptTarget.ES2023,
  lib: ['lib.es2023.d.ts'],
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  allowImportingTsExtensions: true,
  types: [],
};

type Root = 'ClientMsg' | 'ServerMsg';

/**
 * Type errors of each JSON text checked against `root`, by name; an empty list: it type-checks.
 * A syntax error means a broken harness, not a broken message, and fails the test at once.
 */
function typeErrors(root: Root, sources: Record<string, string>): Record<string, string[]> {
  const files = new Map(
    Object.entries(sources).map(([name, json], i) => [
      `${SRC_DIR}__fixture_${String(i)}.ts`,
      {
        name,
        text: `import type { ${root} } from './protocol.gen.ts';\nexport const msg = ${json.trim()} satisfies ${root};\n`,
      },
    ]),
  );
  const base = ts.createCompilerHost(COMPILER_OPTIONS);
  const host: ts.CompilerHost = {
    ...base,
    fileExists: (path) => files.has(path) || base.fileExists(path),
    readFile: (path) => files.get(path)?.text ?? base.readFile(path),
    getSourceFile: (path, languageVersion, ...rest) => {
      const file = files.get(path);
      return file === undefined
        ? base.getSourceFile(path, languageVersion, ...rest)
        : ts.createSourceFile(path, file.text, languageVersion);
    },
  };
  const program = ts.createProgram([...files.keys()], COMPILER_OPTIONS, host);
  const errors: Record<string, string[]> = {};
  const text = (d: ts.Diagnostic): string => ts.flattenDiagnosticMessageText(d.messageText, ' ');
  for (const [path, { name }] of files) {
    const source = program.getSourceFile(path);
    expect(program.getSyntacticDiagnostics(source).map(text), name).toEqual([]);
    errors[name] = ts.getPreEmitDiagnostics(program, source).map(text);
  }
  return errors;
}

function noErrors(sources: Record<string, string>): Record<string, string[]> {
  return Object.fromEntries(Object.keys(sources).map((name) => [name, []]));
}

describe('generated protocol types', () => {
  it('accept every client fixture', () => {
    expect(Object.keys(clientFixtures).length).toBeGreaterThan(0);
    expect(typeErrors('ClientMsg', clientFixtures)).toEqual(noErrors(clientFixtures));
  });

  it('accept every server fixture', () => {
    expect(Object.keys(serverFixtures).length).toBeGreaterThan(0);
    expect(typeErrors('ServerMsg', serverFixtures)).toEqual(noErrors(serverFixtures));
  });

  it('reject a message that breaks the schema', () => {
    const errors = typeErrors('ServerMsg', {
      unknownType: '{"type": "pongg", "id": 1}',
      missingField: '{"type": "pong"}',
      extraField: '{"type": "pong", "id": 1, "extra": 2}',
      stringForNumber: '{"type": "pong", "id": "1"}',
      fieldOfAnotherType: '{"type": "pong", "id": 1, "tick": 5}',
    });
    for (const [name, messages] of Object.entries(errors)) {
      expect(messages, name).not.toEqual([]);
    }
  });
});

// Narrowing by `type` is checked by the compiler (`pnpm check`), the calls only run the code.
function tickOf(msg: ServerMsg): unknown {
  // @ts-expect-error: `tick` is not on every server message, only after narrowing by `type`.
  return msg.tick;
}

function describeServerMsg(msg: ServerMsg): string {
  switch (msg.type) {
    case 'welcome':
      return `welcome player ${String(msg.player)} on ${msg.map_id}`;
    case 'snapshot':
      return `snapshot ${String(msg.tick)}, cp ${String(msg.view.me.cp)}`;
    case 'ack':
      return msg.reject_code ?? `ack ${String(msg.seq)}`;
    case 'event':
      return `event ${msg.kind}`;
    case 'match_end':
      return `match_end ${msg.reason}`;
    case 'error':
      return `error ${msg.code}`;
    case 'pong':
      return `pong ${String(msg.id)}`;
    case 'paused':
      return `paused ${String(msg.paused)}`;
    default:
      return unreachable(msg);
  }
}

function describeClientMsg(msg: ClientMsg): string {
  switch (msg.type) {
    case 'hello':
      return `hello v${String(msg.protocol_version)}`;
    case 'command':
      // The command inside narrows by its own `type`.
      return msg.cmd.type === 'move' ? `move to ${String(msg.cmd.dest)}` : msg.cmd.type;
    case 'ping':
      return `ping ${String(msg.id)}`;
    case 'resync':
      return 'resync';
    case 'pause':
    case 'resume':
      return msg.type;
    default:
      return unreachable(msg);
  }
}

function unreachable(msg: never): never {
  throw new Error(`unhandled message ${JSON.stringify(msg)}`);
}

describe('protocol unions', () => {
  it('narrow by type', () => {
    expect(describeServerMsg({ type: 'pong', id: 7 })).toBe('pong 7');
    expect(tickOf({ type: 'pong', id: 7 })).toBeUndefined();
    expect(describeClientMsg({ type: 'command', seq: 1, cmd: { type: 'forfeit' } })).toBe(
      'forfeit',
    );
  });
});
