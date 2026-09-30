import './load-env.js';
import cluster from 'node:cluster';
import { createServer } from 'node:http';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { workerCount } from './config/workers.js';
import { setupApp } from './setup-app.js';

/** Longer than the ALB idle timeout (120 s), see bootstrap(). */
const KEEP_ALIVE_MS = 125_000;

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = setupApp(app);
  await app.listen(config.port, '0.0.0.0');
  // Node closes idle keep-alive connections after 5 s by default, while the
  // ALB keeps them for 120 s and may reuse one Node just closed: a 502.
  // The app must hold connections longer than the load balancer does.
  const server = app.getHttpServer();
  server.keepAliveTimeout = KEEP_ALIVE_MS;
  server.headersTimeout = KEEP_ALIVE_MS + 1_000;
  Logger.log(`LoadForge server listening on http://localhost:${config.port}/api (pid ${process.pid})`, 'Bootstrap');
}

/**
 * Health check answered by the primary, which never runs request work.
 * The workers block their event loop on CPU-heavy requests, so a check sent
 * to them waits in line and times out when the server is merely busy; the
 * ALB then calls it unhealthy and the ASG replaces it right when capacity is
 * needed. Here "healthy" means: at least one worker is up and listening.
 */
function serveHealth(port: number, listening: () => number, total: number) {
  createServer((_req, res) => {
    const up = listening();
    res.writeHead(up > 0 ? 200 : 503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: up > 0 ? 'ok' : 'down', workers: up, of: total, pid: process.pid }));
  }).listen(port, '0.0.0.0');
}

/**
 * Node runs JavaScript on one core. On a 2 vCPU instance one process tops out
 * near 50% CPU, so a CPU target of 60% would never scale out. One worker per
 * vCPU lets the server really reach 100%. Workers share the port; the primary
 * only supervises and answers health checks.
 */
function supervise(workers: number, healthPort?: number) {
  const log = new Logger('Cluster');
  let stopping = false;
  let alive = 0;
  const listening = new Set<number>();

  const fork = () => {
    cluster.fork();
    alive++;
  };

  log.log(`primary ${process.pid} starting ${workers} workers`);
  for (let i = 0; i < workers; i++) fork();

  cluster.on('listening', (worker) => listening.add(worker.id));
  cluster.on('exit', (worker, code, signal) => {
    alive--;
    listening.delete(worker.id);
    if (stopping) {
      if (alive === 0) process.exit(0);
      return;
    }
    log.warn(`worker ${worker.process.pid} died (${signal ?? code}), starting a new one`);
    fork();
  });

  if (healthPort) {
    serveHealth(healthPort, () => listening.size, workers);
    log.log(`health check on :${healthPort}`);
  }

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
const healthPort = Number(process.env.HEALTH_PORT) || undefined;
// A health port needs the primary, even with a single worker.
if (cluster.isPrimary && (workers > 1 || healthPort)) {
  supervise(workers, healthPort);
} else {
  await bootstrap();
}
