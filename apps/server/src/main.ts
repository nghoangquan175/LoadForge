import './load-env.js';
import cluster from 'node:cluster';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { workerCount } from './config/workers.js';
import { setupApp } from './setup-app.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = setupApp(app);
  await app.listen(config.port, '0.0.0.0');
  Logger.log(`LoadForge server listening on http://localhost:${config.port}/api (pid ${process.pid})`, 'Bootstrap');
}

/**
 * Node runs JavaScript on one core. On a 2 vCPU instance one process tops out
 * near 50% CPU, so a CPU target of 60% would never scale out. One worker per
 * vCPU lets the server really reach 100%. Workers share the port; the primary
 * only supervises.
 */
function supervise(workers: number) {
  const log = new Logger('Cluster');
  let stopping = false;
  let alive = 0;

  const fork = () => {
    cluster.fork();
    alive++;
  };

  log.log(`primary ${process.pid} starting ${workers} workers`);
  for (let i = 0; i < workers; i++) fork();

  cluster.on('exit', (worker, code, signal) => {
    alive--;
    if (stopping) {
      if (alive === 0) process.exit(0);
      return;
    }
    log.warn(`worker ${worker.process.pid} died (${signal ?? code}), starting a new one`);
    fork();
  });

  // docker stop sends SIGTERM to the primary: pass it on so workers flush
  // their request metrics and close cleanly.
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      stopping = true;
      for (const w of Object.values(cluster.workers ?? {})) w?.process.kill(signal);
      setTimeout(() => process.exit(0), 10_000).unref();
    });
  }
}

const workers = workerCount(process.env.WEB_CONCURRENCY);
if (workers > 1 && cluster.isPrimary) {
  supervise(workers);
} else {
  await bootstrap();
}
