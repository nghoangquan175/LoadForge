import { Module } from '@nestjs/common';
import { SnapshotController } from './snapshot.controller.js';
import { SnapshotService } from './snapshot.service.js';

@Module({
  controllers: [SnapshotController],
  providers: [SnapshotService],
})
export class SnapshotModule {}
