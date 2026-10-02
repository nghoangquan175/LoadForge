import type { CpuInfo } from 'node:os';
import { cpuDatum, cpuPercent, cpuTimes } from './cpu-publisher.js';

describe('CPU publisher', () => {
  const core = (user: number, idle: number): CpuInfo => ({
    model: 'x',
    speed: 0,
    times: { user, nice: 0, sys: 0, idle, irq: 0 },
  });

  it('adds up every core', () => {
    expect(cpuTimes([core(10, 90), core(30, 70)])).toEqual({ idle: 160, total: 200 });
  });

  it('measures busy time between two readings', () => {
    const prev = cpuTimes([core(0, 0), core(0, 0)]);
    const next = cpuTimes([core(100, 0), core(80, 20)]);
    expect(cpuPercent(prev, next)).toBe(90);
  });

  it('is 0 when no time passed', () => {
    const t = { idle: 5, total: 10 };
    expect(cpuPercent(t, t)).toBe(0);
  });

  it('writes one high-resolution point for the whole group', () => {
    expect(cpuDatum('loadforge-asg', 91.234)).toMatchObject({
      MetricName: 'CPUUtilization',
      Dimensions: [{ Name: 'AutoScalingGroupName', Value: 'loadforge-asg' }],
      Value: 91.2,
      Unit: 'Percent',
      StorageResolution: 1,
    });
  });
});
