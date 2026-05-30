import { describe, expect, test } from "bun:test";

import { buildEnvelope } from "../../src/envelope/build-envelope";
import { envelopeToAmqpHeaders } from "../../src/envelope/envelope-headers";
import { IdempotentSubscribe } from "../../src/inbox/idempotent-subscribe.decorator";

type FakeTxEm = { __kind: "tx-em" };

interface FakeRootEm {
  __kind: "root-em";
  transactional<T>(cb: (txEm: FakeTxEm) => Promise<T>): Promise<T>;
}

function makeFakeRootEm(): FakeRootEm {
  return {
    __kind: "root-em",
    async transactional(cb) {
      return await cb({ __kind: "tx-em" });
    },
  };
}

function makeFakeCls() {
  return {
    async run<T>(cb: () => Promise<T> | T): Promise<T> {
      return await cb();
    },
    set() {},
    get() {
      return undefined;
    },
  };
}

function makeFakeInbox() {
  return {
    async tryClaim() {
      return true;
    },
    async markProcessed() {},
  };
}

function makeMessage(payload: unknown) {
  const envelope = buildEnvelope({
    type: "evt",
    payload,
    causationId: "origin-1",
  });
  const headers = envelopeToAmqpHeaders(envelope);
  return {
    rawPayload: envelope,
    msg: { properties: { headers: headers as Record<string, unknown> } },
  };
}

function applyDecorator(opts: {
  consumerName: string;
  exchange: string;
  routingKey: string | string[];
  queue: string;
}) {
  const handler = async function (this: unknown, ..._args: unknown[]) {};
  const target = { handle: handler };
  const descriptor: PropertyDescriptor = {
    value: handler,
    writable: true,
    enumerable: true,
    configurable: true,
  };
  const decorator = IdempotentSubscribe(opts);
  decorator(target, "handle", descriptor);
  return { descriptor, target };
}

describe("@IdempotentSubscribe — routingKey accepts string | string[]", () => {
  test("single-string routingKey continues to register and execute (backwards compat)", async () => {
    let observedPayload: unknown = null;
    const handler = async function (this: unknown, ...args: unknown[]) {
      observedPayload = (args[0] as { payload: unknown }).payload;
    };
    const target = { handle: handler };
    const descriptor: PropertyDescriptor = {
      value: handler,
      writable: true,
      enumerable: true,
      configurable: true,
    };
    IdempotentSubscribe({
      consumerName: "test.string",
      exchange: "game.events",
      routingKey: "bet.cashed_out",
      queue: "test.q",
    })(target, "handle", descriptor);

    const host = {
      em: makeFakeRootEm(),
      cls: makeFakeCls(),
      inbox: makeFakeInbox(),
    };
    const { rawPayload, msg } = makeMessage({ id: "p1" });
    const result = await descriptor.value.call(host, rawPayload, msg);

    expect(result).toBeUndefined();
    expect(observedPayload).toEqual({ id: "p1" });
  });

  test("array routingKey registers without throwing and executes the wrapped handler", async () => {
    let observedPayload: unknown = null;
    const handler = async function (this: unknown, ...args: unknown[]) {
      observedPayload = (args[0] as { payload: unknown }).payload;
    };
    const target = { handle: handler };
    const descriptor: PropertyDescriptor = {
      value: handler,
      writable: true,
      enumerable: true,
      configurable: true,
    };
    IdempotentSubscribe({
      consumerName: "test.array",
      exchange: "game.events",
      routingKey: ["bet.cashed_out", "bet.refunded", "bet.lost"],
      queue: "test.q",
    })(target, "handle", descriptor);

    const host = {
      em: makeFakeRootEm(),
      cls: makeFakeCls(),
      inbox: makeFakeInbox(),
    };
    const { rawPayload, msg } = makeMessage({ id: "p2" });
    const result = await descriptor.value.call(host, rawPayload, msg);

    expect(result).toBeUndefined();
    expect(observedPayload).toEqual({ id: "p2" });
  });

  test("array routingKey: inbox dedupe keys per-message regardless of routing key match", async () => {
    let invocations = 0;
    const handler = async function (this: unknown, ..._args: unknown[]) {
      invocations += 1;
    };
    const target = { handle: handler };
    const descriptor: PropertyDescriptor = {
      value: handler,
      writable: true,
      enumerable: true,
      configurable: true,
    };
    IdempotentSubscribe({
      consumerName: "test.dedupe",
      exchange: "game.events",
      routingKey: ["bet.cashed_out", "bet.lost"],
      queue: "test.q",
    })(target, "handle", descriptor);

    const tryClaimCalls: string[] = [];
    const host = {
      em: makeFakeRootEm(),
      cls: makeFakeCls(),
      inbox: {
        async tryClaim(_name: string, messageId: string) {
          tryClaimCalls.push(messageId);
          return true;
        },
        async markProcessed() {},
      },
    };
    const first = makeMessage({ id: "p3" });
    const second = makeMessage({ id: "p4" });

    await descriptor.value.call(host, first.rawPayload, first.msg);
    await descriptor.value.call(host, second.rawPayload, second.msg);

    expect(invocations).toBe(2);
    expect(tryClaimCalls.length).toBe(2);
    expect(tryClaimCalls[0]).not.toEqual(tryClaimCalls[1]);
  });
});
