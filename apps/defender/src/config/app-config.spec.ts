import { loadConfig } from './app-config.js';

describe('loadConfig', () => {
  it('uses defaults', () => {
    expect(loadConfig({})).toMatchObject({ port: 4000, corsOrigins: ['http://localhost:3100'], publishMetrics: false });
  });

  it('publishes metrics only when asked', () => {
    expect(loadConfig({ PUBLISH_METRICS: 'true', INSTANCE_ID: 'i-1' })).toMatchObject({ publishMetrics: true, instanceId: 'i-1' });
  });
});
