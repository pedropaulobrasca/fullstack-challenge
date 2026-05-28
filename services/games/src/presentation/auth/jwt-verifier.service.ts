import { Injectable, UnauthorizedException } from "@nestjs/common";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { env } from "../../config/defaults";

export interface VerifiedClaims {
  playerId: string;
  tokenExp: number;
}

@Injectable()
export class JwtVerifierService {
  private readonly jwks: JWTVerifyGetKey;
  private readonly issuer: string;
  private readonly audience: string;

  constructor() {
    this.issuer = env.KEYCLOAK_ISSUER;
    this.audience = env.KEYCLOAK_AUDIENCE;
    this.jwks = createRemoteJWKSet(new URL(env.KEYCLOAK_JWKS_URI), {
      cacheMaxAge: 600_000,
      cooldownDuration: 30_000,
    });
  }

  async verify(token: string): Promise<VerifiedClaims> {
    try {
      const { payload } = await jwtVerify(token, this.jwks, {
        issuer: this.issuer,
        audience: this.audience,
      });
      const playerId = typeof payload.sub === "string" ? payload.sub : "";
      const tokenExp = typeof payload.exp === "number" ? payload.exp : 0;
      if (!playerId || tokenExp <= 0) {
        throw new UnauthorizedException("INVALID_TOKEN");
      }
      return { playerId, tokenExp };
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      throw new UnauthorizedException("INVALID_TOKEN");
    }
  }
}
