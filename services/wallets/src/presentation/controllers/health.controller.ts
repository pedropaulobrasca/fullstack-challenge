import { Controller, Get } from "@nestjs/common";
import type { HealthCheckResponseDto } from "../dtos/health-check-response.dto";

@Controller("health")
export class HealthController {
  @Get()
  check(): HealthCheckResponseDto {
    return { status: "ok", service: "wallets", version: "0.0.1" };
  }
}
