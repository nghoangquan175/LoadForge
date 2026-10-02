import { Controller, Get, type MessageEvent, Sse } from '@nestjs/common';
import { map, merge, type Observable } from 'rxjs';
import { LiveService } from '../live/live.service.js';
import { SnapshotService } from './snapshot.service.js';

@Controller()
export class SnapshotController {
  constructor(
    private readonly snapshots: SnapshotService,
    private readonly live: LiveService,
  ) {}

  /**
   * Feed for the dashboard: a `snapshot` event per refresh (ASG, CloudWatch's
   * last hour) and a `live` event every second (each server's last seconds).
   */
  @Sse('stream')
  stream(): Observable<MessageEvent> {
    return merge(
      this.snapshots.snapshots$.pipe(map((data) => ({ type: 'snapshot', data }))),
      this.live.updates$.pipe(map((data) => ({ type: 'live', data }))),
    );
  }

  @Get('snapshot')
  snapshot() {
    return this.snapshots.current();
  }

  @Get('instances')
  async instances() {
    const { ts, source, asg, instances } = await this.snapshots.current();
    return { ts, source, asg, instances };
  }

  @Get('metrics')
  async metrics() {
    const { ts, source, targetCpu, metrics } = await this.snapshots.current();
    return { ts, source, targetCpu, ...metrics };
  }

  @Get('activities')
  async activities() {
    const { ts, source, activities } = await this.snapshots.current();
    return { ts, source, activities };
  }
}
