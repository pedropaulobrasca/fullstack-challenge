import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Money } from "@crash/shared-kernel";
import { multiplierAt } from "@crash/contracts";

export const Route = createFileRoute("/")({
  component: HomeComponent,
});

function HomeComponent() {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setHydrated(true);
    (window as unknown as { __SPIKE_HYDRATED__: boolean }).__SPIKE_HYDRATED__ = true;
  }, []);

  const stake = Money.of(100000n).toString();
  const m = multiplierAt(1000, 0.06).toFixed(4);

  return (
    <div>
      <h1 id="spike-root">spike boot</h1>
      <p id="spike-hydrated">{hydrated ? "HYDRATED" : "PENDING"}</p>
      <p id="spike-money">{stake}</p>
      <p id="spike-multiplier">{m}</p>
    </div>
  );
}
