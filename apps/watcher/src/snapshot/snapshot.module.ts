import { Module } from '@nestjs/common';
import { SnapshotController } from './snapshot.controller.js';
import { LiveService } from '../live/live.service.js';
import { SnapshotService } from './snapshot.service.js';

@Module({
  controllers: [SnapshotController],
  providers: [SnapshotService, LiveService],
})
export class SnapshotModule {}
