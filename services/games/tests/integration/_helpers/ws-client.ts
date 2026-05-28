/* eslint-disable @typescript-eslint/no-explicit-any */
import { io as ioClient, type Socket } from "socket.io-client";

export type RecordedEvent = {
  name: string;
  payload: unknown;
  t: number;
};

export type EventRecorder = {
  events: RecordedEvent[];
  stop(): void;
};

export type WsClientOptions = {
  baseUrl: string;
  path: string;
  token?: string;
};

export type WsClient = {
  socket: Socket;
  connect(): Promise<void>;
  waitForEvent<T = unknown>(name: string, timeoutMs?: number): Promise<T>;
  recordEvents(names: string[]): EventRecorder;
  close(): Promise<void>;
};

export function createWsClient(opts: WsClientOptions): WsClient {
  const ioOptions: Record<string, unknown> = {
    path: opts.path,
    transports: ["websocket"],
    autoConnect: false,
    reconnection: false,
    forceNew: true,
  };
  if (opts.token !== undefined) {
    ioOptions.auth = { token: opts.token };
  }
  const socket: Socket = ioClient(opts.baseUrl, ioOptions as any);

  function connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("ws connect timeout"));
      }, 5000);
      const onConnect = (): void => {
        cleanup();
        resolve();
      };
      const onConnectError = (err: Error): void => {
        cleanup();
        reject(err);
      };
      const cleanup = (): void => {
        clearTimeout(timeout);
        socket.off("connect", onConnect);
        socket.off("connect_error", onConnectError);
      };
      socket.once("connect", onConnect);
      socket.once("connect_error", onConnectError);
      socket.connect();
    });
  }

  function waitForEvent<T>(name: string, timeoutMs = 2000): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.off(name, handler);
        reject(new Error(`timeout waiting for ${name} after ${timeoutMs}ms`));
      }, timeoutMs);
      const handler = (payload: T): void => {
        clearTimeout(timer);
        resolve(payload);
      };
      socket.once(name, handler);
    });
  }

  function recordEvents(names: string[]): EventRecorder {
    const events: RecordedEvent[] = [];
    const handlers: Array<{ name: string; fn: (payload: unknown) => void }> =
      [];
    for (const name of names) {
      const fn = (payload: unknown): void => {
        events.push({ name, payload, t: Date.now() });
      };
      socket.on(name, fn);
      handlers.push({ name, fn });
    }
    return {
      events,
      stop(): void {
        for (const { name, fn } of handlers) {
          socket.off(name, fn);
        }
      },
    };
  }

  async function close(): Promise<void> {
    if (socket.connected) {
      socket.disconnect();
    } else {
      socket.close();
    }
  }

  return { socket, connect, waitForEvent, recordEvents, close };
}
