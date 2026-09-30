import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from './../src/app.module.js';
import { setupApp } from './../src/setup-app.js';

describe('LoadForge API (e2e)', () => {
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

  it('GET /api/health', async () => {
    const res = await request(app.getHttpServer()).get('/api/health').expect(200);
    expect(res.body.status).toBe('ok');
    expect(res.headers['x-served-by']).toBeTruthy();
  });

  it('GET /api/snapshot returns mock data', async () => {
    const res = await request(app.getHttpServer()).get('/api/snapshot').expect(200);
    expect(res.body.source).toBe('mock');
    expect(res.body.asg.desired).toBeGreaterThanOrEqual(res.body.asg.min);
    expect(res.body.metrics.cpu.length).toBeGreaterThan(10);
  });

  it.each(['instances', 'metrics', 'activities'])('GET /api/%s', async (path) => {
    const res = await request(app.getHttpServer()).get(`/api/${path}`).expect(200);
    expect(res.body.source).toBe('mock');
  });

  it('GET /api/load/cpu', async () => {
    const res = await request(app.getHttpServer()).get('/api/load/cpu?limit=1000').expect(200);
    expect(res.body).toMatchObject({ route: 'cpu', input: { limit: 1000 }, result: { primes: 168 } });
  });

  it.each(['cpu?limit=abc', 'cpu?limit=99999999', 'cpu?limit=0', 'cpu?limit=1.5'])('rejects bad input /api/load/%s', async (q) => {
    await request(app.getHttpServer()).get(`/api/load/${q}`).expect(400);
  });

  it.each(['memory', 'io'])('no longer serves /api/load/%s', async (route) => {
    await request(app.getHttpServer()).get(`/api/load/${route}`).expect(404);
  });

  it('GET /api/stream sends a snapshot event', async () => {
    await app.listen(0);
    const port = (app.getHttpServer().address() as { port: number }).port;
    const ctrl = new AbortController();
    const res = await fetch(`http://localhost:${port}/api/stream`, { signal: ctrl.signal });
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
