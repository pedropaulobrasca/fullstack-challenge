import { getConfig } from "@/lib/config";
import { getOidc } from "@/auth/oidc";

function buildUrl(path: string): string {
  const { rest } = getConfig();
  const base = rest.base.replace(/\/+$/, "");
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${base}${suffix}`;
}

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(buildUrl(path), init);
}

export async function protectedFetch(path: string, init?: RequestInit): Promise<Response> {
  const oidc = await getOidc();
  if (!oidc.isUserLoggedIn) {
    throw new Error("Cannot perform a protected request while not logged in");
  }
  const accessToken = await oidc.getAccessToken();
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${accessToken}`);
  return fetch(buildUrl(path), { ...init, headers });
}
