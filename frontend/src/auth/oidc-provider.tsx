import { type ReactNode, useEffect, useState } from "react";
import { bootstrapAuth, OidcInitializationGate } from "@/auth/oidc";

export function OidcProvider({ children }: { children: ReactNode }) {
  const [isBootstrapped, setIsBootstrapped] = useState(false);

  useEffect(() => {
    let isMounted = true;
    void bootstrapAuth().then(() => {
      if (isMounted) {
        setIsBootstrapped(true);
      }
    });
    return () => {
      isMounted = false;
    };
  }, []);

  if (!isBootstrapped) {
    return null;
  }

  return <OidcInitializationGate>{children}</OidcInitializationGate>;
}
