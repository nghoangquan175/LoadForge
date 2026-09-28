import type { DashboardSnapshot, DataSource } from '../common/types.js';

export interface SnapshotProvider {
  readonly source: DataSource;
  fetch(): Promise<DashboardSnapshot>;
}
