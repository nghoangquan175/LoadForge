import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module.js';
import { HealthController } from './health/health.controller.js';
import { SnapshotModule } from './snapshot/snapshot.module.js';

@Module({
  imports: [ConfigModule, SnapshotModule],
  controllers: [HealthController],
})
export class AppModule {}
