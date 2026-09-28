import { Controller, Get } from '@nestjs/common';
import { loadavg } from 'node:os';
import { SERVED_BY } from '../common/served-by.js';

/** Target for ALB health checks. Keep it cheap. */
@Controller('health')
export class HealthController {
  @Get()
  check() {
    return {
      status: 'ok',
      servedBy: SERVED_BY,
      uptimeSec: Math.round(process.uptime()),
      rssMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      loadavg: loadavg().map((n) => Math.round(n * 100) / 100),
    };
  }
}
