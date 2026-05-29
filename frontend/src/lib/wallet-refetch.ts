type WalletRefetch = () => void;

let registered: WalletRefetch | null = null;

export function registerWalletRefetch(refetch: WalletRefetch): () => void {
  registered = refetch;
  return () => {
    if (registered === refetch) {
      registered = null;
    }
  };
}

export function requestWalletRefetch(): void {
  registered?.();
}
