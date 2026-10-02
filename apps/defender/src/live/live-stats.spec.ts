import { LiveReporter, LiveStats, type LiveMessage } from './live-stats.js';

describe('LiveStats', () => {
  const s = 1000;
  const T = 1_000_000 * s;

  it('adds up worker counts per second and serves finished seconds only', () => {
    const stats = new LiveStats();
    stats.setCpu(T, 40);
    stats.setCpu(T + s, 60);
    stats.add({ type: 'loadforge:live', buckets: [[T, 2, 1, 300]] });
    stats.add({ type: 'loadforge:live', buckets: [[T, 1, 0, 30], [T + s, 1, 0, 10]] });

    // At T+2.5s, T+1s ended 1.5s ago but has not settled yet.
    expect(stats.points(T + 2.5 * s)).toEqual([{ t: T, cpu: 40, requests: 3, latencyMs: 110, errors5xx: 1 }]);
    expect(stats.points(T + 3 * s).map((p) => p.t)).toEqual([T, T + s]);
    expect(stats.points(T + 3 * s, T).map((p) => p.t)).toEqual([T + s]);
  });

  it('keeps a quiet second, and repeats CPU over a missed tick', () => {
    const stats = new LiveStats();
    stats.setCpu(T, 25);
    expect(stats.points(T + 4 * s)).toEqual([
      { t: T, cpu: 25, requests: 0, latencyMs: 0, errors5xx: 0 },
      { t: T + s, cpu: 25, requests: 0, latencyMs: 0, errors5xx: 0 },
      { t: T + 2 * s, cpu: 25, requests: 0, latencyMs: 0, errors5xx: 0 },
    ]);
  });
});

describe('LiveStats history', () => {
  const s = 1000;
  const T = 1_000_000 * 15 * s;

  it('adds seconds up into finished 15 s steps', () => {
    const stats = new LiveStats();
    for (let i = 0; i < 15; i++) stats.setCpu(T + i * s, i < 5 ? 10 : 40);
    stats.add({ type: 'loadforge:live', buckets: [[T, 3, 1, 90], [T + 14 * s, 1, 0, 10]] });
    stats.setCpu(T + 15 * s, 99);

    // The step T+15s is still running.
    expect(stats.history(T + 30 * s)).toEqual([{ t: T, cpu: 30, requests: 4, latencyMs: 25, errors5xx: 1 }]);
    expect(stats.history(T + 31 * s).map((p) => p.t)).toEqual([T, T + 15 * s]);
    expect(stats.history(T + 31 * s, T)).toHaveLength(1);
  });

  it('keeps one hour', () => {
    const stats = new LiveStats();
    stats.setCpu(T, 10);
    stats.setCpu(T + 61 * 60 * s, 10);
    expect(stats.history(T + 62 * 60 * s).map((p) => p.t)).toEqual([T + 61 * 60 * s]);
  });
});

describe('LiveReporter', () => {
  it('records nothing outside a cluster worker', () => {
    const r = new LiveReporter();
    r.record(10, 200);
    expect(r.active).toBe(false);
  });

  it('sends counts per second to the primary', () => {
    vi.useFakeTimers();
    const sent: LiveMessage[] = [];
    const r = new LiveReporter();
    r.start((m) => sent.push(m));
    r.record(10, 200, 5000);
    r.record(30, 503, 5400);
    r.record(20, 200, 6100);
    vi.advanceTimersByTime(250);
    expect(sent).toEqual([{ type: 'loadforge:live', buckets: [[5000, 2, 1, 40], [6000, 1, 0, 20]] }]);
    vi.advanceTimersByTime(250);
    expect(sent).toHaveLength(1);
    vi.useRealTimers();
  });
});
