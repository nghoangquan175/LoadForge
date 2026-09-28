import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

/**
 * Deliberately expensive work for load testing. The CPU and memory routes run
 * synchronously and block the event loop on purpose: that is what makes a
 * single instance saturate and forces the ASG to scale out.
 */
@Injectable()
export class LoadService {
  /** Counts primes <= limit by trial division. */
  countPrimes(limit: number): number {
    if (limit < 2) return 0;
    let count = 1; // 2
    for (let n = 3; n <= limit; n += 2) {
      let prime = true;
      for (let d = 3; d * d <= n; d += 2) {
        if (n % d === 0) {
          prime = false;
          break;
        }
      }
      if (prime) count++;
    }
    return count;
  }

  /** Allocates `size` random numbers, sorts them and hashes the result. */
  crunchArray(size: number) {
    const values = Array.from({ length: size }, () => Math.random());
    values.sort((a, b) => a - b);
    const sha256 = createHash('sha256').update(Buffer.from(Float64Array.from(values).buffer)).digest('hex');
    return {
      min: values[0] ?? null,
      median: values[Math.floor(size / 2)] ?? null,
      max: values[size - 1] ?? null,
      sha256: sha256.slice(0, 16),
      heapUsedMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    };
  }

  /** Stands in for a slow database or third-party API call. */
  async slowDownstream(delayMs: number) {
    await sleep(delayMs);
    return { waitedMs: delayMs };
  }
}
