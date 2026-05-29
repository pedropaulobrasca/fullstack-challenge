import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/features/bet/use-cashout", () => ({
  useCashout: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { CashoutButton } from "@/components/cashout-button";
import { useRoundStore } from "@/stores/round.store";
import { useMultiplierStore } from "@/stores/multiplier.store";
import { useBetStore } from "@/stores/bet.store";

const moneySnap = (amount: string) => ({ amount, currency: "CRD", scale: 2 });

beforeEach(() => {
  useRoundStore.setState({
    roundId: null,
    status: "IDLE",
    bettingEndsAt: null,
    roundStartedAt: null,
    crashValue: null,
  });
  useMultiplierStore.getState().reset();
  useBetStore.setState({ myBet: null, pending: false, celebrate: false });
});

describe("CashoutButton", () => {
  it("renders an enabled button with the live Money payout when RUNNING and bet ACTIVE", () => {
    useRoundStore.setState({ status: "RUNNING" });
    useMultiplierStore.setState({ renderedMultiplier: 2.41 });
    useBetStore.setState({
      myBet: {
        betId: "bet-1",
        roundId: "round-1",
        amount: moneySnap("1000"),
        status: "ACTIVE",
        cashoutMultiplier: null,
      },
    });

    render(<CashoutButton />);

    const button = screen.getByRole("button");
    expect(button).toBeEnabled();
    expect(button).toHaveTextContent("Cash Out 2.41x");
    expect(button).toHaveTextContent("24.10 CRD");
  });

  it("does not render an enabled cashout during BETTING", () => {
    useRoundStore.setState({ status: "BETTING" });
    useBetStore.setState({
      myBet: {
        betId: "bet-1",
        roundId: "round-1",
        amount: moneySnap("1000"),
        status: "ACTIVE",
        cashoutMultiplier: null,
      },
    });

    render(<CashoutButton />);

    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders the payout as a Money toString carrying the currency code, never a bare number", () => {
    useRoundStore.setState({ status: "RUNNING" });
    useMultiplierStore.setState({ renderedMultiplier: 2.41 });
    useBetStore.setState({
      myBet: {
        betId: "bet-1",
        roundId: "round-1",
        amount: moneySnap("1000"),
        status: "ACTIVE",
        cashoutMultiplier: null,
      },
    });

    render(<CashoutButton />);

    expect(screen.getByRole("button")).toHaveTextContent(/\d+\.\d{2} CRD/);
  });
});
