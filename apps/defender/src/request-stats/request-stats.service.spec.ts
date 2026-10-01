import { loadConfig } from '../config/app-config.js';
import { RequestStatsService } from './request-stats.service.js';

describe('RequestStatsService', () => {
  const minute = 60_000;
  const stats = () => new RequestStatsService(loadConfig({ INSTANCE_ID: 'i-0abc' }));

  it('groups requests per minute and only sends finished minutes', () => {
    const s = stats();
    s.record(10, 200, 5 * minute + 1_000);
    s.record(30, 500, 5 * minute + 59_000);
    s.record(20, 200, 6 * minute + 1_000);

    const sent = s.pending(false, 6 * minute + 30_000);
    expect(sent).toHaveLength(1);
    const [count, errors, latency] = sent[0].data;
    expect(sent[0].minute).toBe(5 * minute);
    expect(count).toMatchObject({ MetricName: 'RequestCount', Value: 2, Dimensions: [{ Name: 'InstanceId', Value: 'i-0abc' }] });
    expect(errors).toMatchObject({ MetricName: 'Http5xxCount', Value: 1 });
    expect(latency.StatisticValues).toEqual({ SampleCount: 2, Sum: 40, Minimum: 10, Maximum: 30 });
  });

  it('sends the current minute too on shutdown', () => {
    const s = stats();
    s.record(10, 200, 5 * minute);
    expect(s.pending(true, 5 * minute + 1)).toHaveLength(1);
  });
});
