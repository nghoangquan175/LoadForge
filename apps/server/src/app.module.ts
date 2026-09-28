import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module.js';
import { DashboardModule } from './dashboard/dashboard.module.js';
import { HealthController } from './health/health.controller.js';
import { LoadModule } from './load/load.module.js';

@Module({
  imports: [ConfigModule, DashboardModule, LoadModule],
  controllers: [HealthController],
})
export class AppModule {}
