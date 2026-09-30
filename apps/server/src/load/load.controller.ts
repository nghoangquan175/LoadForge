import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { SERVED_BY } from '../common/served-by.js';
import { LoadService } from './load.service.js';

function boundedInt(raw: string | undefined, name: string, fallback: number, min: number, max: number): number {
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new BadRequestException(`${name} must be an integer between ${min} and ${max}`);
  }
  return n;
}

async function timed<T extends object>(route: string, input: Record<string, number>, work: () => T | Promise<T>) {
  const started = performance.now();
  const result = await work();
  return {
    route,
    input,
    result,
    durationMs: Math.round((performance.now() - started) * 10) / 10,
    servedBy: SERVED_BY,
    // Which Node worker on that server (WEB_CONCURRENCY > 1).
    worker: process.pid,
  };
}

/** Targets for k6. Each one stresses a different resource. */
@Controller('load')
export class LoadController {
  constructor(private readonly load: LoadService) {}

  @Get('cpu')
  cpu(@Query('limit') limitRaw?: string) {
    const limit = boundedInt(limitRaw, 'limit', 300_000, 1, 5_000_000);
    return timed('cpu', { limit }, () => ({ primes: this.load.countPrimes(limit) }));
  }

  @Get('memory')
  memory(@Query('size') sizeRaw?: string) {
    const size = boundedInt(sizeRaw, 'size', 500_000, 1, 5_000_000);
    return timed('memory', { size }, () => this.load.crunchArray(size));
  }

  @Get('io')
  io(@Query('delay') delayRaw?: string) {
    const delay = boundedInt(delayRaw, 'delay', 300, 0, 10_000);
    return timed('io', { delay }, () => this.load.slowDownstream(delay));
  }
}
