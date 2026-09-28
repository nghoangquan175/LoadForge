import { loadConfig } from './app-config.js';

describe('loadConfig', () => {
  it('uses defaults', () => {
    expect(loadConfig({})).toMatchObject({ port: 4000, dataSource: 'auto', corsOrigins: ['http://localhost:3100'], targetCpu: 60 });
  });

  it('rejects an unknown data source', () => {
    expect(() => loadConfig({ DATA_SOURCE: 'gcp' })).toThrow(/DATA_SOURCE/);
  });
});
