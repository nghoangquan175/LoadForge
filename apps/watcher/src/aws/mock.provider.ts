import type { DashboardSnapshot, LivePoint } from '../common/types.js';
import { createSim, historyFor, liveFor, SIM_PERIOD_MS, stepSim, toSnapshot, type SimState } from './mock-simulator.js';
import type { SnapshotProvider } from './snapshot-provider.js';

/** After this long without being polled, start a fresh simulation. */
const STALE_MS = 60_000;

export class MockSnapshotProvider implements SnapshotProvider {
  readonly source = 'mock' as const;
  private sim: SimState | null = null;

  fetch(): Promise<DashboardSnapshot> {
    return Promise.resolve(toSnapshot(this.advance(Date.now())));
  }

  /** What every simulated server's /live route would say right now. */
  live(): Record<string, LivePoint[]> {
    const now = Date.now();
    return liveFor(this.advance(now), now);
  }

  /** What every simulated server's /live?step=15 would say right now. */
  history(): Record<string, LivePoint[]> {
    const now = Date.now();
    return historyFor(this.advance(now), now);
  }

  /** Steps the sim up to now; snapshots and /live both read it. */
  private advance(now: number): SimState {
    // Polling pauses when nobody watches; a big gap would tear the charts.
    if (!this.sim || now - this.sim.now > STALE_MS) {
      this.sim = createSim(now);
    }
    while (this.sim.now + SIM_PERIOD_MS <= now) stepSim(this.sim, this.sim.now + SIM_PERIOD_MS);
    return this.sim;
  }
}
