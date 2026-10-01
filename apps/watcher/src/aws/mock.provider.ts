import type { DashboardSnapshot } from '../common/types.js';
import { createSim, stepSim, toSnapshot, type SimState } from './mock-simulator.js';
import type { SnapshotProvider } from './snapshot-provider.js';

/** After this long without being polled, start a fresh simulation. */
const STALE_MS = 60_000;

export class MockSnapshotProvider implements SnapshotProvider {
  readonly source = 'mock' as const;
  private sim: SimState | null = null;

  fetch(): Promise<DashboardSnapshot> {
    const now = Date.now();
    // Polling pauses when nobody watches; a big gap would tear the charts.
    if (!this.sim || now - this.sim.now > STALE_MS) {
      this.sim = createSim(now);
    } else {
      stepSim(this.sim, now);
    }
    return Promise.resolve(toSnapshot(this.sim));
  }
}
