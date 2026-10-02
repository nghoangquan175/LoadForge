import { loadConfig } from '../config/app-config.js';
import type { SnapshotService } from '../snapshot/snapshot.service.js';
import { LIVE_KEEP_MS, LiveService } from './live.service.js';

describe('LiveService seconds buffer', () => {
  const point = (t: number, requests: number) => ({ t, cpu: 50, requests, latencyMs: 20, errors5xx: 0 });
  const service = () => new LiveService(loadConfig({}), {} as SnapshotService);

  it('lets a newer read of a second replace the older one', () => {
    const live = service();
    live.storeSeconds({ a: [point(1000, 3), point(2000, 4)] }, 2000);
    live.storeSeconds({ a: [point(2000, 9), point(3000, 1)] }, 3000);
    expect(live.secondsSince(0).points.a.map((p) => [p.t, p.requests])).toEqual([
      [1000, 3],
      [2000, 9],
      [3000, 1],
    ]);
    expect(live.secondsSince(2000).points.a).toHaveLength(2);
  });

  it('drops points older than the buffer, and servers with none left', () => {
    const live = service();
    const now = 10 * LIVE_KEEP_MS;
    live.storeSeconds({ old: [point(now - LIVE_KEEP_MS - 1000, 1)], a: [point(now - 1000, 1)] }, now);
    expect(Object.keys(live.secondsSince(0).points)).toEqual(['a']);
  });
});
