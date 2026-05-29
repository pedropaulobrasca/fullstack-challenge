import { describe, expect, it, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

import { LiveFeed } from "@/components/live-feed";
import { useFeedStore, type FeedEntry } from "@/stores/feed.store";
import { useBetStore } from "@/stores/bet.store";

const moneySnap = (amount: string) => ({
  amount,
  currency: "CRD",
  scale: 2,
});

const ownCashout: FeedEntry = {
  id: "own-1",
  roundId: "r1",
  betId: "mine",
  playerIdMasked: "you",
  kind: "cashed_out",
  amount: moneySnap("1000"),
  multiplier: 2.5,
  isOwn: true,
};

const foreignPlaced: FeedEntry = {
  id: "other-1",
  roundId: "r1",
  betId: "theirs",
  playerIdMasked: "0a1b2c3d",
  kind: "placed",
  amount: moneySnap("500"),
  isOwn: false,
};

beforeEach(() => {
  useFeedStore.setState({ entries: [] });
  useBetStore.setState({ myBet: null, pending: false, celebrate: false });
});

describe("LiveFeed", () => {
  it("highlights the player's own row and leaves foreign rows neutral", () => {
    useFeedStore.setState({ entries: [ownCashout, foreignPlaced] });

    render(<LiveFeed />);

    const ownRow = screen.getByTestId("feed-row-own-1");
    const foreignRow = screen.getByTestId("feed-row-other-1");
    expect(ownRow).toHaveAttribute("data-own", "true");
    expect(foreignRow).toHaveAttribute("data-own", "false");
  });

  it("renders cashed-out money via Money toString with the currency code, never a bare number", () => {
    useFeedStore.setState({ entries: [ownCashout] });

    render(<LiveFeed />);

    const ownRow = screen.getByTestId("feed-row-own-1");
    expect(ownRow).toHaveTextContent(/\d+\.\d{2} CRD/);
    expect(ownRow).toHaveTextContent("2.50x");
  });

  it("renders the empty state when there are no entries", () => {
    useFeedStore.setState({ entries: [] });

    render(<LiveFeed />);

    expect(screen.getByText("No bets yet this round")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Place a bet during the betting window to see the action here.",
      ),
    ).toBeInTheDocument();
  });

  it("shows the player's real bet amount on their own placed row, not the masked zero", () => {
    const ownPlacedMasked: FeedEntry = {
      id: "mine:placed",
      roundId: "r1",
      betId: "mine",
      playerIdMasked: "you",
      kind: "placed",
      amount: moneySnap("0"),
      isOwn: true,
    };
    useBetStore.setState({
      myBet: {
        betId: "mine",
        roundId: "r1",
        amount: moneySnap("2500"),
        status: "ACTIVE",
        cashoutMultiplier: null,
      },
      pending: false,
      celebrate: false,
    });
    useFeedStore.setState({ entries: [ownPlacedMasked] });

    render(<LiveFeed />);

    const ownRow = screen.getByTestId("feed-row-mine:placed");
    expect(ownRow).toHaveTextContent("25.00 CRD");
    expect(ownRow).not.toHaveTextContent("0.00 CRD");
  });

  it("leaves a foreign placed row showing the masked payload amount", () => {
    useBetStore.setState({
      myBet: {
        betId: "mine",
        roundId: "r1",
        amount: moneySnap("2500"),
        status: "ACTIVE",
        cashoutMultiplier: null,
      },
      pending: false,
      celebrate: false,
    });
    useFeedStore.setState({ entries: [foreignPlaced] });

    render(<LiveFeed />);

    const foreignRow = screen.getByTestId("feed-row-other-1");
    expect(foreignRow).toHaveTextContent("5.00 CRD");
  });

  it("renders rows newest-first matching store order", () => {
    useFeedStore.setState({ entries: [ownCashout, foreignPlaced] });

    render(<LiveFeed />);

    const rows = screen.getAllByTestId(/^feed-row-/);
    expect(rows[0]).toHaveAttribute("data-testid", "feed-row-own-1");
    expect(rows[1]).toHaveAttribute("data-testid", "feed-row-other-1");
  });
});
