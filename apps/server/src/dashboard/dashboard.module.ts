import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller.js';
import { SnapshotService } from './snapshot.service.js';

@Module({
  controllers: [DashboardController],
  providers: [SnapshotService],
})
export class DashboardModule {}
