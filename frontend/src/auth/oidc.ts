import { oidcSpa } from "oidc-spa/react-spa";
import { getConfig } from "@/lib/config";

const { bootstrapOidc, useOidc, getOidc, OidcInitializationGate, enforceLogin } =
  oidcSpa.createUtils();

let bootstrapPromise: Promise<void> | undefined;

export function bootstrapAuth(): Promise<void> {
  if (bootstrapPromise === undefined) {
    const { keycloak } = getConfig();
    bootstrapPromise = bootstrapOidc({
      implementation: "real",
      issuerUri: keycloak.issuer,
      clientId: keycloak.clientId,
      scopes: ["profile", "email"],
    });
  }
  return bootstrapPromise;
}

export { useOidc, getOidc, OidcInitializationGate, enforceLogin };
