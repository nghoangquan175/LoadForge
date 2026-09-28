import './load-env.js';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { setupApp } from './setup-app.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = setupApp(app);
  await app.listen(config.port, '0.0.0.0');
  Logger.log(`LoadForge server listening on http://localhost:${config.port}/api`, 'Bootstrap');
}
await bootstrap();
