import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtVerifierService } from "../auth/jwt-verifier.service";

export interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  user?: { playerId: string; tokenExp: number };
}

export interface JwtGuardOptions {
  jwksUri: string;
  issuer: string;
  audience: string;
}

@Injectable()
export class JwtGuard implements CanActivate {
  constructor(private readonly verifier: JwtVerifierService) {}

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

    const { playerId, tokenExp } = await this.verifier.verify(token);
    req.user = { playerId, tokenExp };
    return true;
  }
}
