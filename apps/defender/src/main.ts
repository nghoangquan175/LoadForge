import './load-env.js';
import cluster from 'node:cluster';
import { createServer } from 'node:http';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { loadConfig } from './config/app-config.js';
import { startCpuPublisher } from './cpu-metrics/cpu-publisher.js';
import { workerCount } from './config/workers.js';
import { isLiveMessage, liveReporter, LiveStats } from './live/live-stats.js';
import { setupApp } from './setup-app.js';

/** Longer than the ALB idle timeout (120 s), see bootstrap(). */
const KEEP_ALIVE_MS = 125_000;

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = setupApp(app);
  // In a cluster worker: tell the primary about every finished request, for /live.
  const send = process.send?.bind(process);
  if (cluster.isWorker && send) liveReporter.start((m) => send(m));
  await app.listen(config.port, '0.0.0.0');
  // Node closes idle keep-alive connections after 5 s by default, while the
  // ALB keeps them for 120 s and may reuse one Node just closed: a 502.
  // The app must hold connections longer than the load balancer does.
  const server = app.getHttpServer();
  server.keepAliveTimeout = KEEP_ALIVE_MS;
  server.headersTimeout = KEEP_ALIVE_MS + 1_000;
  Logger.log(`LoadForge defender listening on http://localhost:${config.port}/api (pid ${process.pid})`, 'Bootstrap');
}

/**
 * Health check answered by the primary, which never runs request work.
 * The workers block their event loop on CPU-heavy requests, so a check sent
 * to them waits in line and times out when the server is merely busy; the
 * ALB then calls it unhealthy and the ASG replaces it right when capacity is
 * needed. Here "healthy" means: at least one worker is up and listening.
 *
 * `GET /live?since=<epoch ms>` on the same port: this server's last 5 minutes
 * (or the seconds after `since`), one point per second. `step=15` instead
 * gives the last hour in 15 s steps. Both polled by the Watcher (src/live).
 * Answered here so they are never traffic: no worker sees them.
 */
function serveHealth(port: number, listening: () => number, total: number, live: LiveStats) {
  createServer((req, res) => {
    if (req.url?.startsWith('/live')) {
      const query = new URL(req.url, 'http://localhost').searchParams;
      const since = Number(query.get('since')) || undefined;
      const points = query.get('step') === '15' ? live.history(Date.now(), since) : live.points(Date.now(), since);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ instanceId: process.env.INSTANCE_ID ?? null, points }));
      return;
    }
    const up = listening();
    res.writeHead(up > 0 ? 200 : 503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: up > 0 ? 'ok' : 'down', workers: up, of: total, pid: process.pid }));
  }).listen(port, '0.0.0.0');
}

/**
 * Node runs JavaScript on one core. On a 2 vCPU instance one process tops out
 * near 50% CPU, so a CPU target of 60% would never scale out. One worker per
 * vCPU lets the server really reach 100%. Workers share the port; the primary
 * only supervises, answers health checks and serves /live.
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
  const live = new LiveStats();
  cluster.on('message', (_worker, message) => isLiveMessage(message) && live.add(message));
  const stopSampling = live.startCpuSampling();
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
    serveHealth(healthPort, () => listening.size, workers, live);
    log.log(`health check and /live on :${healthPort}`);
  }

  // Once per server, so here and not in the workers.
  const config = loadConfig();
  const stopCpu = config.publishMetrics && config.asgName ? startCpuPublisher(config.region, config.asgName) : undefined;

  // docker stop sends SIGTERM to the primary: pass it on so workers flush
  // their request metrics and close cleanly.
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      stopping = true;
      stopCpu?.();
      stopSampling();
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
