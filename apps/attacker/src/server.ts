import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AttackerConfig } from './config.js';
import { K6Runner } from './k6-runner.js';
import { checkPlan } from './plan.js';

const MAX_BODY = 4096;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > MAX_BODY) reject(new Error('body too large'));
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

/** The control + health HTTP API. k6 does the load; this just drives it. */
export function createControlServer(config: AttackerConfig, runner = new K6Runner(config)) {
  const allowOrigin = (origin: string | undefined) =>
    origin && config.corsOrigins.includes(origin) ? origin : config.corsOrigins[0] ?? '';

  const authorized = (req: IncomingMessage) => {
    if (!config.controlToken) return true;
    return req.headers.authorization === `Bearer ${config.controlToken}`;
  };

  return createServer((req, res) => {
    void handle(req, res).catch((err: unknown) => {
      send(res, 500, { error: err instanceof Error ? err.message : String(err) });
    });
  });

  function send(res: ServerResponse, status: number, body: unknown) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  }

  async function handle(req: IncomingMessage, res: ServerResponse) {
    res.setHeader('Access-Control-Allow-Origin', allowOrigin(req.headers.origin));
    res.setHeader('Vary', 'Origin');
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.writeHead(204).end();
      return;
    }

    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;

    if (req.method === 'GET' && path === '/health') {
      return send(res, 200, { status: 'ok', uptimeSec: Math.round(process.uptime()) });
    }

    if (!path.startsWith('/control/')) return send(res, 404, { error: 'not found' });
    if (!authorized(req)) return send(res, 401, { error: 'missing or wrong control token' });

    if (req.method === 'GET' && path === '/control/status') {
      return send(res, 200, runner.status());
    }

    if (req.method === 'POST' && path === '/control/stop') {
      return send(res, 200, runner.stop());
    }

    if (req.method === 'POST' && (path === '/control/start' || path === '/control/update')) {
      const raw = await readBody(req);
      let body: unknown;
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch {
        return send(res, 400, { error: 'body must be valid JSON' });
      }
      const checked = checkPlan(body, config);
      if ('error' in checked) return send(res, 400, checked);
      const status = path === '/control/start' ? runner.start(checked.plan) : runner.update(checked.plan);
      return send(res, 200, status);
    }

    return send(res, 404, { error: 'not found' });
  }
}
