import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module.js';
import { DashboardModule } from './dashboard/dashboard.module.js';
import { HealthController } from './health/health.controller.js';
import { LoadModule } from './load/load.module.js';
import { RequestStatsService } from './request-stats/request-stats.service.js';

@Module({
  imports: [ConfigModule, DashboardModule, LoadModule],
  controllers: [HealthController],
  providers: [RequestStatsService],
})
export class AppModule {}
