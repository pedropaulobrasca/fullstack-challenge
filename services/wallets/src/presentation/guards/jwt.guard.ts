import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Optional,
  UnauthorizedException,
} from "@nestjs/common";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

export interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  user?: { playerId: string; tokenExp: number };
}

export interface JwtGuardOptions {
  jwksUri: string;
  issuer: string;
  audience: string;
}

function loadEnvOptions(): JwtGuardOptions {
  const { env } = require("../../config/defaults") as typeof import("../../config/defaults");
  return {
    jwksUri: env.KEYCLOAK_JWKS_URI,
    issuer: env.KEYCLOAK_ISSUER,
    audience: env.KEYCLOAK_AUDIENCE,
  };
}

@Injectable()
export class JwtGuard implements CanActivate {
  private readonly issuer: string;
  private readonly audience: string;
  private readonly jwks: JWTVerifyGetKey;

  constructor(@Optional() options?: JwtGuardOptions) {
    const resolved = options ?? loadEnvOptions();
    this.issuer = resolved.issuer;
    this.audience = resolved.audience;
    this.jwks = createRemoteJWKSet(new URL(resolved.jwksUri), {
      cacheMaxAge: 600_000,
      cooldownDuration: 30_000,
    });
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    const rawHeader = req.headers["authorization"];
    const header = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;

    if (!header || !header.startsWith("Bearer ")) {
      throw new UnauthorizedException("MISSING_BEARER_TOKEN");
    }

    const token = header.slice(7).trim();
    if (!token) {
      throw new UnauthorizedException("MISSING_BEARER_TOKEN");
    }

    try {
      const { payload } = await jwtVerify(token, this.jwks, {
        issuer: this.issuer,
        audience: this.audience,
      });
      const playerId = typeof payload.sub === "string" ? payload.sub : "";
      const tokenExp = typeof payload.exp === "number" ? payload.exp : 0;
      if (!playerId || !tokenExp) {
        throw new UnauthorizedException("INVALID_TOKEN");
      }
      req.user = { playerId, tokenExp };
      return true;
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      throw new UnauthorizedException("INVALID_TOKEN");
    }
  }
}
