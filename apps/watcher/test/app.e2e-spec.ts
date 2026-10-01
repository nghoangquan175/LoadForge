import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from './../src/app.module.js';
import { setupApp } from './../src/setup-app.js';

describe('LoadForge Watcher (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    process.env.DATA_SOURCE = 'mock';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /monitor/health', async () => {
    const res = await request(app.getHttpServer()).get('/monitor/health').expect(200);
    expect(res.body.status).toBe('ok');
  });

  it('GET /monitor/snapshot returns mock data', async () => {
    const res = await request(app.getHttpServer()).get('/monitor/snapshot').expect(200);
    expect(res.body.source).toBe('mock');
    expect(res.body.asg.desired).toBeGreaterThanOrEqual(res.body.asg.min);
    expect(res.body.metrics.cpu.length).toBeGreaterThan(10);
  });

  it.each(['instances', 'metrics', 'activities'])('GET /monitor/%s', async (path) => {
    const res = await request(app.getHttpServer()).get(`/monitor/${path}`).expect(200);
    expect(res.body.source).toBe('mock');
  });

  it('does not serve load routes', async () => {
    await request(app.getHttpServer()).get('/monitor/load/cpu').expect(404);
  });

  it('GET /monitor/stream sends a snapshot event', async () => {
    await app.listen(0);
    const port = (app.getHttpServer().address() as { port: number }).port;
    const ctrl = new AbortController();
    const res = await fetch(`http://localhost:${port}/monitor/stream`, { signal: ctrl.signal });
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const reader = res.body!.getReader();
    let text = '';
    while (!text.includes('\n\n')) {
      const { value } = await reader.read();
      text += new TextDecoder().decode(value);
    }
    ctrl.abort();
    expect(text).toContain('event: snapshot');
    expect(JSON.parse(/data: (.*)/.exec(text)![1]).source).toBe('mock');
  });
});
