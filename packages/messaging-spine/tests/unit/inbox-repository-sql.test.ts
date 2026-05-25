import { describe, test, expect, mock } from "bun:test";
import type { EntityManager } from "@mikro-orm/postgresql";

import { InboxRepository } from "../../src/index";

interface ExecuteRecorder {
  execute: ReturnType<typeof mock>;
  em: EntityManager;
}

function makeFakeEm(returnRows: unknown[]): ExecuteRecorder {
  const execute = mock(async () => returnRows);
  const em = {
    getConnection: () => ({ execute }),
  } as unknown as EntityManager;
  return { execute, em };
}

describe("InboxRepository.tryClaim SQL contract", () => {
  test("returns true when execute returns one row", async () => {
    const { execute, em } = makeFakeEm([{ message_id: "mid-1" }]);
    const repo = new InboxRepository(em);

    const result = await repo.tryClaim("wallet.commands", "mid-1", "wallet.debit");

    expect(result).toBe(true);
    expect(execute.mock.calls.length).toBe(1);

    const sql = execute.mock.calls[0]?.[0] as string;
    expect(sql).toContain("INSERT INTO inbox");
    expect(sql).toContain(
      "ON CONFLICT (consumer_name, message_id) DO NOTHING",
    );
    expect(sql).toContain("RETURNING message_id");

    const params = execute.mock.calls[0]?.[1] as unknown[];
    expect(params).toEqual(["wallet.commands", "mid-1", "wallet.debit"]);
  });

  test("returns false when execute returns zero rows (duplicate claim)", async () => {
    const { em } = makeFakeEm([]);
    const repo = new InboxRepository(em);

    const result = await repo.tryClaim("c", "mid", "mt");

    expect(result).toBe(false);
  });

  test("emits the canonical INSERT statement with placeholders for received_at via now()", async () => {
    const { execute, em } = makeFakeEm([{ message_id: "x" }]);
    const repo = new InboxRepository(em);

    await repo.tryClaim("c", "m", "t");

    const sql = execute.mock.calls[0]?.[0] as string;
    expect(sql).toContain("VALUES (?, ?, ?, now())");
  });
});

describe("InboxRepository.markProcessed SQL contract", () => {
  test("emits UPDATE inbox SET processed_at = now() with correct params", async () => {
    const { execute, em } = makeFakeEm([]);
    const repo = new InboxRepository(em);

    await repo.markProcessed("wallet.commands", "mid-99");

    expect(execute.mock.calls.length).toBe(1);

    const sql = execute.mock.calls[0]?.[0] as string;
    expect(sql).toContain("UPDATE inbox SET processed_at = now()");
    expect(sql).toContain(
      "WHERE consumer_name = ? AND message_id = ?",
    );

    const params = execute.mock.calls[0]?.[1] as unknown[];
    expect(params).toEqual(["wallet.commands", "mid-99"]);
  });
});
