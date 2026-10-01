import type { INestApplication } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { SERVED_BY } from './common/served-by.js';
import { APP_CONFIG, type AppConfig } from './config/app-config.js';
import { RequestStatsService } from './request-stats/request-stats.service.js';

/** Not real traffic: ALB health checks. */
const UNCOUNTED = ['/api/health'];

/** Shared by main.ts and the e2e tests. */
export function setupApp(app: INestApplication): AppConfig {
  const config = app.get<AppConfig>(APP_CONFIG);
  const stats = app.get(RequestStatsService);
  app.setGlobalPrefix('api');
  app.enableCors({ origin: config.corsOrigins });
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Served-By', SERVED_BY);
    if (!UNCOUNTED.some((p) => req.path.startsWith(p))) {
      const started = performance.now();
      res.on('finish', () => stats.record(performance.now() - started, res.statusCode));
    }
    next();
  });
  app.enableShutdownHooks();
  return config;
}
