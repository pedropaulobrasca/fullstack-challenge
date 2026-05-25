import { describe, expect, test } from "bun:test";
import { ClsService, ClsServiceManager } from "nestjs-cls";

import {
  CAUSATION_ID_KEY,
  CORRELATION_ID_KEY,
} from "../../src/context/correlation-tokens";
import { withMessagingContext } from "../../src/context/messaging-cls";

function freshCls(): ClsService {
  return ClsServiceManager.getClsService();
}

describe("withMessagingContext", () => {
  test("sets correlationId in the cls scope and resolves the callback value", async () => {
    const cls = freshCls();
    const result = await withMessagingContext(
      cls,
      { correlationId: "corr-1" },
      async () => cls.get(CORRELATION_ID_KEY) as string,
    );
    expect(result).toBe("corr-1");
  });

  test("sets causationId only when supplied", async () => {
    const cls = freshCls();
    const noCause = await withMessagingContext(
      cls,
      { correlationId: "corr-2" },
      async () => cls.get(CAUSATION_ID_KEY) as string | undefined,
    );
    expect(noCause).toBeUndefined();

    const withCause = await withMessagingContext(
      cls,
      { correlationId: "corr-3", causationId: "cause-3" },
      async () => cls.get(CAUSATION_ID_KEY) as string,
    );
    expect(withCause).toBe("cause-3");
  });

  test("nested calls inherit outer correlationId until overwritten", async () => {
    const cls = freshCls();
    const observed = await withMessagingContext(
      cls,
      { correlationId: "outer" },
      async () => {
        const outerSeen = cls.get(CORRELATION_ID_KEY) as string;
        const innerSeen = await withMessagingContext(
          cls,
          { correlationId: "inner" },
          async () => cls.get(CORRELATION_ID_KEY) as string,
        );
        const afterInner = cls.get(CORRELATION_ID_KEY) as string;
        return { outerSeen, innerSeen, afterInner };
      },
    );
    expect(observed.outerSeen).toBe("outer");
    expect(observed.innerSeen).toBe("inner");
    expect(observed.afterInner).toBe("outer");
  });

  test("context does not leak outside the cls scope", async () => {
    const cls = freshCls();
    await withMessagingContext(
      cls,
      { correlationId: "scoped" },
      async () => undefined,
    );
    const leak = cls.get(CORRELATION_ID_KEY) as string | undefined;
    expect(leak).toBeUndefined();
  });

  test("propagates errors thrown inside the callback", async () => {
    const cls = freshCls();
    const boom = new Error("boom");
    await expect(
      withMessagingContext(
        cls,
        { correlationId: "err" },
        async () => {
          throw boom;
        },
      ),
    ).rejects.toBe(boom);
  });
});
