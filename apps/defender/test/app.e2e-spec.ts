import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from './../src/app.module.js';
import { setupApp } from './../src/setup-app.js';

describe('LoadForge Defender (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
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

  // Dashboard data moved to the Watcher.
  it.each(['stream', 'snapshot', 'instances', 'metrics', 'activities'])('no longer serves /api/%s', async (path) => {
    await request(app.getHttpServer()).get(`/api/${path}`).expect(404);
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
});
