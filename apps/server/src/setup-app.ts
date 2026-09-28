import type { INestApplication } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { SERVED_BY } from './common/served-by.js';
import { APP_CONFIG, type AppConfig } from './config/app-config.js';

/** Shared by main.ts and the e2e tests. */
export function setupApp(app: INestApplication): AppConfig {
  const config = app.get<AppConfig>(APP_CONFIG);
  app.setGlobalPrefix('api');
  app.enableCors({ origin: config.corsOrigins });
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Served-By', SERVED_BY);
    next();
  });
  app.enableShutdownHooks();
  return config;
}
