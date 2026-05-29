/**
 * Spike B — oidc-spa instance parity (Open Question 1 / Assumption A1)
 * Spike D — Kong CORS reachability from the :3000 origin (Pitfall 2)
 *
 * This file documents the spike findings. The OIDC parity question was resolved by
 * inspecting the INSTALLED oidc-spa@10.2.3 type surface (interactive PKCE login needs a
 * real browser redirect session and cannot run headless in this script); the CORS question
 * was resolved with live curl probes against the running Kong stack, captured below.
 *
 * Issuer/realm facts (verified against docker/keycloak/realm-export.json + live discovery):
 *   issuerUri = http://localhost:8080/realms/crash-game
 *   clientId  = crash-game-client  (publicClient, PKCE S256, accessTokenLifespan 3600)
 *   redirectUris / webOrigins allow ONLY http://localhost:3000 and http://localhost:8080
 *   discovery code_challenge_methods_supported = ['plain','S256']; authorization_code grant present
 */

export const OIDC_PARITY_FINDING = {
  // oidc-spa@10.2.3 actual API (DIFFERS from RESEARCH Pattern 7's assumed createReactOidc):
  // import { oidcSpa } from "oidc-spa/react-spa"
  // const { useOidc, getOidc, enforceLogin, bootstrapOidc, OidcInitializationGate } =
  //   oidcSpa.<builder>.createUtils({ ... })
  //
  // The SINGLE OidcSpaUtils object exposes BOTH:
  //   - useOidc  : React hook  (components)
  //   - getOidc  : Promise<Oidc> accessor with getAccessToken() + subscribeToAccessTokenRotation
  //                (NON-React code — the socket.io singleton)
  //   - enforceLogin : TanStack Router loader/route guard (replaces the assumed beforeLoadFn)
  // Both useOidc and getOidc are backed by ONE underlying core oidc instance.
  decision: "single-getOidc",
  reason:
    "react-spa createUtils already returns a non-React getOidc() bound to the same instance; " +
    "a second createOidc(core) is unnecessary and would be the wrong pattern. No dual-instance " +
    "token/session parity concern exists because there is only one instance.",
} as const;

export const CORS_FINDING = {
  // Live curl evidence (Kong :8000, 07-01 cors plugin loaded):
  simpleGet: "GET /games/rounds/current + Origin :3000 -> 200, ACAO=http://localhost:3000, ACAC=true (readable)",
  authedGet: "GET /wallets/me + Bearer + Origin :3000 -> 200, ACAO=http://localhost:3000, balance.amount=60000 CRD",
  preflightGap:
    "OPTIONS preflight 404s on EVERY route (wallets-me, games-bet, games-bets-me, games-current) " +
    "because each Kong route's methods: filter omits OPTIONS, so no route matches the preflight and " +
    "the cors plugin never answers it. Browsers preflight any request carrying Authorization (all authed " +
    "GETs) or a JSON POST (bet/cashout) -> those calls are BLOCKED in a real browser until OPTIONS is allowed.",
  decision: "fix-required",
} as const;
