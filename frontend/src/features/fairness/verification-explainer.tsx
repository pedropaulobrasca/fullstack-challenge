import { Info } from "lucide-react";

const EXPLAINER_BODY =
  "Before each round, the server publishes a SHA-256 hash of a secret seed. That hash is the commitment. After the round settles, the server reveals the seed itself — and your browser hashes it locally to confirm it matches what was published earlier. Because the hash function is one-way and the commitment was visible before any bet was accepted, the server cannot change the outcome after the fact. Anyone can verify this with a single command line.";

export function VerificationExplainer() {
  return (
    <div
      data-slot="verification-explainer"
      className="rounded-md border border-border bg-popover p-4 text-sm text-muted-foreground"
    >
      <div className="mb-2 flex items-center gap-2 text-foreground">
        <Info aria-hidden="true" className="size-4" />
        <span className="font-medium">How verification works</span>
      </div>
      <p className="leading-relaxed">{EXPLAINER_BODY}</p>
    </div>
  );
}
