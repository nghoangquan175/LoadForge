import type { INestApplication } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from './config/app-config.js';

/**
 * Behind the ALB the Watcher lives under /monitor/*, apart from the
 * Defenders' /api/* that load tests hit.
 */
export const ROUTE_PREFIX = 'monitor';

/** Shared by main.ts and the e2e tests. */
export function setupApp(app: INestApplication): AppConfig {
  const config = app.get<AppConfig>(APP_CONFIG);
  app.setGlobalPrefix(ROUTE_PREFIX);
  app.enableCors({ origin: config.corsOrigins });
  app.enableShutdownHooks();
  return config;
}
