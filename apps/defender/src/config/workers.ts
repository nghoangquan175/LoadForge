import { availableParallelism } from 'node:os';

/** WEB_CONCURRENCY: a number, or "auto" for one worker per vCPU. Default 1. */
export function workerCount(raw: string | undefined, cpus = availableParallelism()): number {
  if (raw === 'auto') return cpus;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : 1;
}
