import './load-env.js';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { ROUTE_PREFIX, setupApp } from './setup-app.js';

/** Longer than the ALB idle timeout (120 s), so the ALB never reuses a closed connection. */
const KEEP_ALIVE_MS = 125_000;

const app = await NestFactory.create(AppModule);
const config = setupApp(app);
await app.listen(config.port, '0.0.0.0');
const server = app.getHttpServer();
server.keepAliveTimeout = KEEP_ALIVE_MS;
server.headersTimeout = KEEP_ALIVE_MS + 1_000;
Logger.log(`LoadForge watcher listening on http://localhost:${config.port}/${ROUTE_PREFIX}`, 'Bootstrap');
