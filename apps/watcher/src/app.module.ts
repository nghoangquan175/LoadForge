import { Module } from '@nestjs/common';
import { AttackModule } from './attack/attack.module.js';
import { ConfigModule } from './config/config.module.js';
import { HealthController } from './health/health.controller.js';
import { SnapshotModule } from './snapshot/snapshot.module.js';

@Module({
  imports: [ConfigModule, SnapshotModule, AttackModule],
  controllers: [HealthController],
})
export class AppModule {}
