import { Controller, Get, type MessageEvent, Sse } from '@nestjs/common';
import { map, type Observable } from 'rxjs';
import { SnapshotService } from './snapshot.service.js';

@Controller()
export class SnapshotController {
  constructor(private readonly snapshots: SnapshotService) {}

  /** Real-time feed for the dashboard: one `snapshot` event per refresh. */
  @Sse('stream')
  stream(): Observable<MessageEvent> {
    return this.snapshots.snapshots$.pipe(map((data) => ({ type: 'snapshot', data })));
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
