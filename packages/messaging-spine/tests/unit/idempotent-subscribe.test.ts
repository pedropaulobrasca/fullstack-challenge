import { describe, expect, test } from "bun:test";

import { buildEnvelope } from "../../src/envelope/build-envelope";
import { envelopeToAmqpHeaders } from "../../src/envelope/envelope-headers";
import { IdempotentSubscribe } from "../../src/inbox/idempotent-subscribe.decorator";
import { CONSUMER_NAME_META } from "../../src/inbox/consumer-name.token";

type Capture = {
  args: unknown[] | null;
  callCount: number;
};

interface FakeClsService {
  run<T>(cb: () => Promise<T> | T): Promise<T> | T;
  set(key: string, value: unknown): void;
  get(key: string): unknown;
}

interface FakeInboxRepository {
  tryClaim(consumerName: string, messageId: string, type: string): Promise<boolean>;
  markProcessed(consumerName: string, messageId: string): Promise<void>;
}

function makeFakeCls(): FakeClsService {
  const store = new Map<string, unknown>();
  return {
    async run<T>(cb: () => Promise<T> | T): Promise<T> {
      return await cb();
    },
    set(key, value) {
      store.set(key, value);
    },
    get(key) {
      return store.get(key);
    },
  };
}

function makeFakeInbox(claim = true): FakeInboxRepository & { processedCalls: number } {
  const state = { processedCalls: 0 };
  return {
    async tryClaim() {
      return claim;
    },
    async markProcessed() {
      state.processedCalls += 1;
    },
    get processedCalls() {
      return state.processedCalls;
    },
  };
}

type FakeTxEm = { __kind: "tx-em"; transactionContext: object };

interface FakeRootEm {
  __kind: "root-em";
  transactional<T>(cb: (txEm: FakeTxEm) => Promise<T>): Promise<T>;
}

function makeFakeRootEm(): FakeRootEm {
  return {
    __kind: "root-em",
    async transactional(cb) {
      const txEm: FakeTxEm = {
        __kind: "tx-em",
        transactionContext: { txId: "tx-stub-1" },
      };
      return await cb(txEm);
    },
  };
}

function makeMessageWithEnvelope(payload: unknown): {
  rawPayload: unknown;
  msg: { properties: { headers: Record<string, unknown> } };
  envelopeMessageId: string;
} {
  const envelope = buildEnvelope({
    type: "test.evt",
    payload,
    causationId: "origin-1",
  });
  const headers = envelopeToAmqpHeaders(envelope);
  return {
    rawPayload: envelope,
    msg: { properties: { headers: headers as Record<string, unknown> } },
    envelopeMessageId: envelope.messageId,
  };
}

function decorateHandler<H extends (...args: unknown[]) => unknown>(
  consumerName: string,
  exchange: string,
  routingKey: string,
  queue: string,
  handler: H,
): { decoratedKey: string; descriptor: PropertyDescriptor; target: object } {
  const target = { [`handler_${consumerName}`]: handler };
  const propertyKey = `handler_${consumerName}`;
  const descriptor: PropertyDescriptor = {
    value: handler,
    writable: true,
    enumerable: true,
    configurable: true,
  };
  const decorator = IdempotentSubscribe({ consumerName, exchange, routingKey, queue });
  decorator(target, propertyKey, descriptor);
  return { decoratedKey: propertyKey, descriptor, target };
}

describe("@IdempotentSubscribe — assertHostShape", () => {
  test("host missing em/cls/inbox throws descriptive error naming each missing field", async () => {
    const capture: Capture = { args: null, callCount: 0 };
    const handler = async function (this: unknown, ...args: unknown[]) {
      capture.callCount += 1;
      capture.args = args;
    };
    const { descriptor } = decorateHandler(
      "test.shape",
      "wallet.events",
      "test.shape",
      "test.q",
      handler,
    );

    const host = {};
    const { msg } = makeMessageWithEnvelope({ x: 1 });

    await expect(descriptor.value.call(host, {}, msg)).rejects.toThrow(
      /missing required injected fields: em, cls, inbox/,
    );
  });
});

describe("@IdempotentSubscribe — OI-1 envelope unwrap", () => {
  test("handler receives envelope.payload as the original publisher payload (one hop)", async () => {
    const capture: Capture = { args: null, callCount: 0 };
    const handler = async function (this: unknown, ...args: unknown[]) {
      capture.callCount += 1;
      capture.args = args;
    };
    const { descriptor } = decorateHandler(
      "test.unwrap",
      "wallet.events",
      "test.unwrap",
      "test.q",
      handler,
    );

    const inbox = makeFakeInbox(true);
    const host = {
      em: makeFakeRootEm(),
      cls: makeFakeCls(),
      inbox,
    };

    const { rawPayload, msg } = makeMessageWithEnvelope({ walletId: "abc" });

    await descriptor.value.call(host, rawPayload, msg);

    expect(capture.callCount).toBe(1);
    const passedEnvelope = capture.args?.[0] as { payload: { walletId?: string } };
    expect(passedEnvelope.payload).toEqual({ walletId: "abc" });
    expect(passedEnvelope.payload.walletId).toBe("abc");
  });
});

describe("@IdempotentSubscribe — OI-3 txEm propagation", () => {
  test("handler receives the transactional EntityManager as a third argument distinct from host.em", async () => {
    const capture: Capture = { args: null, callCount: 0 };
    const handler = async function (this: unknown, ...args: unknown[]) {
      capture.callCount += 1;
      capture.args = args;
    };
    const { descriptor } = decorateHandler(
      "test.txem",
      "wallet.events",
      "test.txem",
      "test.q",
      handler,
    );

    const rootEm = makeFakeRootEm();
    const inbox = makeFakeInbox(true);
    const host = {
      em: rootEm,
      cls: makeFakeCls(),
      inbox,
    };

    const { rawPayload, msg } = makeMessageWithEnvelope({ walletId: "abc" });

    await descriptor.value.call(host, rawPayload, msg);

    expect(capture.callCount).toBe(1);
    const args = capture.args ?? [];
    expect(args.length).toBeGreaterThanOrEqual(3);
    const txEm = args[2] as { __kind?: string };
    expect(txEm).toBeDefined();
    expect(txEm).not.toBe(rootEm);
    expect(txEm.__kind).toBe("tx-em");
  });
});

describe("@IdempotentSubscribe — signature stability for 2-arg handlers", () => {
  test("existing handler signatures that ignore the third arg still work without regression", async () => {
    let observedPayload: unknown = null;
    const handler = async function (
      this: unknown,
      envelope: { payload: unknown },
      _msg: unknown,
    ) {
      observedPayload = envelope.payload;
    };
    const { descriptor } = decorateHandler(
      "test.2arg",
      "wallet.events",
      "test.2arg",
      "test.q",
      handler,
    );

    const host = {
      em: makeFakeRootEm(),
      cls: makeFakeCls(),
      inbox: makeFakeInbox(true),
    };

    const { rawPayload, msg } = makeMessageWithEnvelope({ probeId: "p-1" });

    const result = await descriptor.value.call(host, rawPayload, msg);

    expect(result).toBeUndefined();
    expect(observedPayload).toEqual({ probeId: "p-1" });
  });
});

describe("@IdempotentSubscribe — metadata", () => {
  test("decorator records the consumer name on the target via Reflect metadata", () => {
    const handler = async function () {};
    const { target, decoratedKey } = decorateHandler(
      "test.meta",
      "wallet.events",
      "test.meta",
      "test.q",
      handler,
    );
    const recorded = Reflect.getMetadata(CONSUMER_NAME_META, target, decoratedKey);
    expect(recorded).toBe("test.meta");
  });
});
