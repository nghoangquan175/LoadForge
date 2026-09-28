import type { DashboardSnapshot } from '../common/types.js';
import { createSim, stepSim, toSnapshot, type SimState } from './mock-simulator.js';
import type { SnapshotProvider } from './snapshot-provider.js';

export class MockSnapshotProvider implements SnapshotProvider {
  readonly source = 'mock' as const;
  private sim: SimState | null = null;

  fetch(): Promise<DashboardSnapshot> {
    const now = Date.now();
    if (!this.sim) {
      this.sim = createSim(now);
    } else {
      stepSim(this.sim, now);
    }
    return Promise.resolve(toSnapshot(this.sim));
  }
}
