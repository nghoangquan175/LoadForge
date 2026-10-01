import { Controller, Get } from '@nestjs/common';

/** Target for ALB health checks. Keep it cheap. */
@Controller('health')
export class HealthController {
  @Get()
  check() {
    return { status: 'ok', uptimeSec: Math.round(process.uptime()) };
  }
}
