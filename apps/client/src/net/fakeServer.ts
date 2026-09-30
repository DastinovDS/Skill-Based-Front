/** Test double of the match server: a mock `WebSocket` and helpers to drive it (CLI-01, #57). */
import type { ClientMsg, ServerMsg } from '../protocol.gen.ts';

export class MockSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState: number = MockSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  /** Everything the client wrote, parsed. */
  readonly sent: ClientMsg[] = [];

  constructor(readonly url: string) {}

  send(data: string): void {
    this.sent.push(JSON.parse(data) as ClientMsg);
  }

  close(): void {
    this.readyState = MockSocket.CLOSED;
  }

  // Server side ------------------------------------------------------------------------------

  accept(): void {
    this.readyState = MockSocket.OPEN;
    this.onopen?.();
  }

  reply(msg: ServerMsg): void {
    this.replyRaw(JSON.stringify(msg));
  }

  replyRaw(frame: unknown): void {
    this.onmessage?.({ data: frame });
  }

  drop(code = 1006): void {
    this.readyState = MockSocket.CLOSED;
    this.onclose?.({ code });
  }
}

/** Installs `MockSocket` as the global `WebSocket` constants and records created sockets. */
export function createFakeServer(): {
  sockets: MockSocket[];
  create: (url: string) => WebSocket;
  last: () => MockSocket;
} {
  const sockets: MockSocket[] = [];
  return {
    sockets,
    create: (url) => {
      const socket = new MockSocket(url);
      sockets.push(socket);
      return socket as unknown as WebSocket;
    },
    last: () => {
      const socket = sockets.at(-1);
      if (socket === undefined) throw new Error('no socket was created');
      return socket;
    },
  };
}
